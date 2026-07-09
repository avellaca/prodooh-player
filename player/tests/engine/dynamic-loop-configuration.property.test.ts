/**
 * Property-based test: Dynamic Loop Configuration
 *
 * Generates random valid LoopConfigs (varying slot counts, durations, and source
 * assignments) and verifies the engine accepts them via updateConfig() and
 * continues executing without errors or source modifications.
 *
 * **Validates: Requirements 7.5**
 *
 * Requirement 7.5: Allow modifying the number of slots, duration per slot, and
 *                  source assignment per slot without requiring changes to any
 *                  source's internal logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { LoopEngine } from '../../src/engine/LoopEngine';
import type { ContentSource, PreparedContent, SourceType } from '../../src/sources/types';
import type { FallbackBuffer } from '../../src/sources/FallbackBuffer';
import type { LoopConfig, SlotConfig } from '../../src/storage/types';

// --- Helpers ---

function makePreparedContent(id: string, source: SourceType = 'playlist', duration = 1): PreparedContent {
  return {
    id,
    type: 'image',
    source,
    mediaUrl: `/media/${id}.jpg`,
    duration,
    metadata: {},
  };
}

function createMockSource(sourceId: SourceType): ContentSource {
  return {
    id: sourceId,
    prefetch: vi.fn(async () => makePreparedContent(`${sourceId}-content`, sourceId, 1)),
    confirmPlay: vi.fn(async () => {}),
    reportFailure: vi.fn(async () => {}),
    isAvailable: vi.fn(() => true),
  };
}

function createMockFallbackBuffer(): FallbackBuffer {
  let callCount = 0;
  return {
    getNext: vi.fn(() => {
      callCount++;
      return makePreparedContent(`fallback-${callCount}`, 'playlist', 1);
    }),
    hasContent: vi.fn(() => true),
    getSize: vi.fn(() => 1),
    replenish: vi.fn(async () => {}),
  } as unknown as FallbackBuffer;
}

function makeLoopConfig(slots: SlotConfig[]): LoopConfig {
  const totalDuration = slots.reduce((sum, s) => sum + s.duration, 0);
  return {
    slots,
    total_duration: totalDuration,
    version: `v-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
}

// --- Arbitraries ---

const sourceTypes: SourceType[] = ['prodooh', 'gam', 'url', 'playlist'];

const sourceTypeArb: fc.Arbitrary<SourceType> = fc.constantFrom(...sourceTypes);

/** Generate a valid SlotConfig with random source and duration */
const slotConfigArb: fc.Arbitrary<SlotConfig> = fc.record({
  position: fc.nat({ max: 99 }),
  source: sourceTypeArb,
  duration: fc.integer({ min: 1, max: 30 }), // 1-30 seconds
});

/** Generate a valid LoopConfig with 1-10 slots, fixing positions to be sequential */
const loopConfigArb: fc.Arbitrary<LoopConfig> = fc
  .array(slotConfigArb, { minLength: 1, maxLength: 10 })
  .map((slots) => {
    // Fix positions to be sequential (0, 1, 2, ...)
    const fixedSlots = slots.map((s, i) => ({ ...s, position: i }));
    return makeLoopConfig(fixedSlots);
  });

/** Generate a sequence of valid LoopConfigs to apply as hot updates */
const configSequenceArb: fc.Arbitrary<LoopConfig[]> = fc.array(loopConfigArb, {
  minLength: 1,
  maxLength: 5,
});

describe('Property 11: Dynamic Loop Configuration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('engine accepts any valid LoopConfig via updateConfig() without throwing', async () => {
    await fc.assert(
      fc.asyncProperty(loopConfigArb, configSequenceArb, async (initialConfig, updates) => {
        const sources = new Map<SourceType, ContentSource>(
          sourceTypes.map(s => [s, createMockSource(s)])
        );
        const fallbackBuffer = createMockFallbackBuffer();

        const engine = new LoopEngine({
          config: initialConfig,
          sources,
          fallbackBuffer,
        });

        const runPromise = engine.run();
        await vi.advanceTimersByTimeAsync(0);

        // Apply each config update while the engine is running
        for (const newConfig of updates) {
          // Let the current slot run a bit before updating
          await vi.advanceTimersByTimeAsync(500);

          // updateConfig should never throw for any valid LoopConfig
          expect(() => engine.updateConfig(newConfig)).not.toThrow();

          // Engine should still be running after config update
          expect(engine.isRunning()).toBe(true);

          // Advance past the current slot to let the engine process the new config
          await vi.advanceTimersByTimeAsync(1000);
          await vi.advanceTimersByTimeAsync(0);
        }

        engine.stop();
        await runPromise;
      }),
      { numRuns: 100 }
    );
  });

  it('engine continues executing with new config without requiring source modifications', async () => {
    await fc.assert(
      fc.asyncProperty(loopConfigArb, loopConfigArb, async (initialConfig, newConfig) => {
        const sources = new Map<SourceType, ContentSource>(
          sourceTypes.map(s => [s, createMockSource(s)])
        );
        const fallbackBuffer = createMockFallbackBuffer();

        const playedContents: PreparedContent[] = [];

        const engine = new LoopEngine({
          config: initialConfig,
          sources,
          fallbackBuffer,
          onPlay: (content) => { playedContents.push(content); },
        });

        const runPromise = engine.run();
        await vi.advanceTimersByTimeAsync(0);

        // Let initial config execute at least one full slot
        await vi.advanceTimersByTimeAsync(initialConfig.slots[0]!.duration * 1000);
        await vi.advanceTimersByTimeAsync(0);

        const playedBeforeUpdate = playedContents.length;

        // Apply new config — sources should NOT be reconstructed or reconfigured
        // Their isAvailable/prefetch/confirmPlay interface stays unchanged
        engine.updateConfig(newConfig);

        // Advance through at least 2 slots of the new config to verify execution
        for (let i = 0; i < 2; i++) {
          await vi.advanceTimersByTimeAsync(newConfig.slots[i % newConfig.slots.length]!.duration * 1000);
          await vi.advanceTimersByTimeAsync(0);
        }

        // Engine played content both before and after config update
        expect(playedContents.length).toBeGreaterThan(playedBeforeUpdate);

        // Sources were NOT re-created — same mock instances still work
        // Verify at least one source was called (prefetch) after the update
        const allPrefetchCalls = sourceTypes.reduce((sum, s) => {
          const source = sources.get(s) as ContentSource;
          return sum + (source.prefetch as ReturnType<typeof vi.fn>).mock.calls.length;
        }, 0);
        expect(allPrefetchCalls).toBeGreaterThan(0);

        engine.stop();
        await runPromise;
      }),
      { numRuns: 100 }
    );
  });

  it('currentIndex is reset correctly when new config has fewer slots', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Initial config with at least 3 slots
        fc.array(slotConfigArb, { minLength: 3, maxLength: 10 }).map((slots) => {
          const fixedSlots = slots.map((s, i) => ({ ...s, position: i }));
          return makeLoopConfig(fixedSlots);
        }),
        // New config with fewer slots (1-2)
        fc.array(slotConfigArb, { minLength: 1, maxLength: 2 }).map((slots) => {
          const fixedSlots = slots.map((s, i) => ({ ...s, position: i }));
          return makeLoopConfig(fixedSlots);
        }),
        async (largeConfig, smallConfig) => {
          const sources = new Map<SourceType, ContentSource>(
            sourceTypes.map(s => [s, createMockSource(s)])
          );
          const fallbackBuffer = createMockFallbackBuffer();

          const engine = new LoopEngine({
            config: largeConfig,
            sources,
            fallbackBuffer,
          });

          const runPromise = engine.run();
          await vi.advanceTimersByTimeAsync(0);

          // Advance enough to get past the first slot so currentIndex > 0
          await vi.advanceTimersByTimeAsync(largeConfig.slots[0]!.duration * 1000);
          await vi.advanceTimersByTimeAsync(0);
          await vi.advanceTimersByTimeAsync(largeConfig.slots[1 % largeConfig.slots.length]!.duration * 1000);
          await vi.advanceTimersByTimeAsync(0);

          // Apply smaller config
          engine.updateConfig(smallConfig);

          // currentIndex should be within bounds of new config
          expect(engine.getCurrentSlotIndex()).toBeLessThan(smallConfig.slots.length);

          // Engine should continue running without errors
          await vi.advanceTimersByTimeAsync(smallConfig.slots[0]!.duration * 1000);
          await vi.advanceTimersByTimeAsync(0);

          expect(engine.isRunning()).toBe(true);

          engine.stop();
          await runPromise;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('source internal logic (isAvailable, prefetch, confirmPlay) is never modified by config changes', async () => {
    await fc.assert(
      fc.asyncProperty(configSequenceArb, async (configs) => {
        // Ensure at least 2 configs to apply
        if (configs.length < 2) return;

        const sources = new Map<SourceType, ContentSource>(
          sourceTypes.map(s => [s, createMockSource(s)])
        );
        const fallbackBuffer = createMockFallbackBuffer();

        // Store references to original source methods
        const originalMethods = new Map<SourceType, {
          prefetch: unknown;
          confirmPlay: unknown;
          reportFailure: unknown;
          isAvailable: unknown;
        }>();
        for (const [type, source] of sources) {
          originalMethods.set(type, {
            prefetch: source.prefetch,
            confirmPlay: source.confirmPlay,
            reportFailure: source.reportFailure,
            isAvailable: source.isAvailable,
          });
        }

        const engine = new LoopEngine({
          config: configs[0]!,
          sources,
          fallbackBuffer,
        });

        const runPromise = engine.run();
        await vi.advanceTimersByTimeAsync(0);

        // Apply all config updates
        for (let i = 1; i < configs.length; i++) {
          engine.updateConfig(configs[i]!);
          await vi.advanceTimersByTimeAsync(1000);
          await vi.advanceTimersByTimeAsync(0);
        }

        // Verify that NO source's methods were replaced or modified
        for (const [type, source] of sources) {
          const original = originalMethods.get(type)!;
          expect(source.prefetch).toBe(original.prefetch);
          expect(source.confirmPlay).toBe(original.confirmPlay);
          expect(source.reportFailure).toBe(original.reportFailure);
          expect(source.isAvailable).toBe(original.isAvailable);
        }

        engine.stop();
        await runPromise;
      }),
      { numRuns: 100 }
    );
  });
});
