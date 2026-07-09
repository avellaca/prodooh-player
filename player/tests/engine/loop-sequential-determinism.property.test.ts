/**
 * Property-based test: Loop Sequential Determinism
 *
 * Generates random loop sizes N and execution counts K, runs the engine for K slots,
 * and verifies the current index is always K mod N — demonstrating deterministic
 * sequential execution with no randomness.
 *
 * **Validates: Requirements 7.1, 7.8**
 *
 * Requirement 7.1: Loop is a fixed sequence of N slots that repeats continuously.
 * Requirement 7.8: Execute slots in defined sequential order, no randomness,
 *                  making SOV predictable and auditable.
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

function makeSlot(position: number, source: SourceType, duration = 1): SlotConfig {
  return { position, source, duration };
}

function makeLoopConfig(slots: SlotConfig[]): LoopConfig {
  const totalDuration = slots.reduce((sum, s) => sum + s.duration, 0);
  return {
    slots,
    total_duration: totalDuration,
    version: '1.0.0',
  };
}

/** Available source types to distribute across slots */
const sourceTypes: SourceType[] = ['prodooh', 'gam', 'url', 'playlist'];

/**
 * Arbitrary for loop size N (1..20).
 * Constrained to keep tests fast under fake timers.
 */
const loopSizeArb = fc.integer({ min: 1, max: 20 });

/**
 * Arbitrary for execution count K (1..50).
 * Represents how many slots the engine executes before we check the index.
 */
const executionCountArb = fc.integer({ min: 1, max: 50 });

describe('Property 9: Loop Sequential Determinism', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('after executing K slots in a loop of N, currentIndex equals K mod N', async () => {
    await fc.assert(
      fc.asyncProperty(
        loopSizeArb,
        executionCountArb,
        async (N, K) => {
          // Build N slots, assigning source types round-robin
          const slots: SlotConfig[] = Array.from({ length: N }, (_, i) =>
            makeSlot(i, sourceTypes[i % sourceTypes.length]!, 1)
          );
          const config = makeLoopConfig(slots);

          // Set up sources for all types used
          const sources = new Map<SourceType, ContentSource>(
            sourceTypes.map(s => [s, createMockSource(s)])
          );
          const fallbackBuffer = createMockFallbackBuffer();

          let slotsPlayed = 0;
          const engine = new LoopEngine({
            config,
            sources,
            fallbackBuffer,
            onPlay: () => { slotsPlayed++; },
          });

          // Start the engine
          const runPromise = engine.run();

          // Let the first slot start (flush microtasks for async prefetch)
          await vi.advanceTimersByTimeAsync(0);

          // First slot is now playing, slotsPlayed = 1
          // Advance through all K slots (each completes its duration timer)
          for (let i = 1; i <= K; i++) {
            // Advance past current slot's duration (1000ms) and flush microtasks
            await vi.advanceTimersByTimeAsync(1000);
            await vi.advanceTimersByTimeAsync(0);
          }

          // After K slots have completed (played and duration elapsed), the engine
          // has advanced currentIndex K times. The (K+1)-th slot is now playing.
          // Total slots played = K + 1 (K completed + 1 currently playing)
          expect(slotsPlayed).toBe(K + 1);

          // The engine advances currentIndex after each slot completes:
          // starts at 0, plays, advances to 1, plays, advances to 2, etc.
          // After K advances from 0, currentIndex = K % N
          const expectedIndex = K % N;
          expect(engine.getCurrentSlotIndex()).toBe(expectedIndex);

          engine.stop();
          await runPromise;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('slot execution order is strictly sequential with no skips or reordering', async () => {
    await fc.assert(
      fc.asyncProperty(
        loopSizeArb,
        executionCountArb,
        async (N, K) => {
          const slots: SlotConfig[] = Array.from({ length: N }, (_, i) =>
            makeSlot(i, sourceTypes[i % sourceTypes.length]!, 1)
          );
          const config = makeLoopConfig(slots);

          const sources = new Map<SourceType, ContentSource>(
            sourceTypes.map(s => [s, createMockSource(s)])
          );
          const fallbackBuffer = createMockFallbackBuffer();

          // Track the index at which each slot was played
          const playedIndices: number[] = [];
          let currentSlotIndex = 0;

          const engine = new LoopEngine({
            config,
            sources,
            fallbackBuffer,
            onPlay: () => {
              playedIndices.push(engine.getCurrentSlotIndex());
            },
          });

          const runPromise = engine.run();
          await vi.advanceTimersByTimeAsync(0);

          for (let i = 1; i < K; i++) {
            await vi.advanceTimersByTimeAsync(1000);
            await vi.advanceTimersByTimeAsync(0);
          }

          // Verify all K slots were played in strict sequential order
          expect(playedIndices.length).toBe(K);

          for (let i = 0; i < K; i++) {
            const expectedSlotIndex = i % N;
            expect(playedIndices[i]).toBe(expectedSlotIndex);
          }

          engine.stop();
          await runPromise;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('multiple full loops produce the same repeating pattern (deterministic cycle)', async () => {
    await fc.assert(
      fc.asyncProperty(
        loopSizeArb,
        fc.integer({ min: 2, max: 5 }), // number of full cycles
        async (N, cycles) => {
          const slots: SlotConfig[] = Array.from({ length: N }, (_, i) =>
            makeSlot(i, sourceTypes[i % sourceTypes.length]!, 1)
          );
          const config = makeLoopConfig(slots);

          const sources = new Map<SourceType, ContentSource>(
            sourceTypes.map(s => [s, createMockSource(s)])
          );
          const fallbackBuffer = createMockFallbackBuffer();

          const playedIndices: number[] = [];

          const engine = new LoopEngine({
            config,
            sources,
            fallbackBuffer,
            onPlay: () => {
              playedIndices.push(engine.getCurrentSlotIndex());
            },
          });

          const totalSlots = N * cycles;

          const runPromise = engine.run();
          await vi.advanceTimersByTimeAsync(0);

          // Advance through totalSlots - 1 more (first slot started on its own)
          for (let i = 1; i < totalSlots; i++) {
            await vi.advanceTimersByTimeAsync(1000);
            await vi.advanceTimersByTimeAsync(0);
          }

          expect(playedIndices.length).toBe(totalSlots);

          // Each full cycle should produce the identical sequence [0, 1, ..., N-1]
          for (let cycle = 0; cycle < cycles; cycle++) {
            const cycleSlice = playedIndices.slice(cycle * N, (cycle + 1) * N);
            const expectedSequence = Array.from({ length: N }, (_, i) => i);
            expect(cycleSlice).toEqual(expectedSequence);
          }

          // The last slot played was at index (totalSlots - 1) % N.
          // getCurrentSlotIndex() still reports that index because the slot
          // hasn't finished yet (its timer hasn't fired).
          expect(engine.getCurrentSlotIndex()).toBe((totalSlots - 1) % N);

          engine.stop();
          await runPromise;
        }
      ),
      { numRuns: 50 }
    );
  });
});
