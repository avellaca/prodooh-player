/**
 * Property 3: Source Fallback to Playlist Local
 *
 * For any slot in the loop where the assigned source fails to provide content
 * (timeout, no-fill, error, decode failure, or prefetch not ready), that slot
 * SHALL be filled with the next item from the playlist local, and the loop
 * SHALL continue to the next slot without interruption.
 *
 * **Validates: Requirements 2.3, 2.4, 3.3, 6.3, 7.3**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { LoopEngine } from '../../src/engine/LoopEngine';
import type { ContentSource, PreparedContent, SourceType } from '../../src/sources/types';
import type { FallbackBuffer } from '../../src/sources/FallbackBuffer';
import type { LoopConfig, SlotConfig } from '../../src/storage/types';

// --- Failure modes a source can exhibit ---
type FailureMode = 'returns-null' | 'throws-error' | 'not-available' | 'not-registered';

// --- Arbitraries ---

const sourceTypeArb: fc.Arbitrary<SourceType> = fc.constantFrom('prodooh', 'gam', 'url', 'playlist');

const failureModeArb: fc.Arbitrary<FailureMode> = fc.constantFrom(
  'returns-null',
  'throws-error',
  'not-available',
  'not-registered'
);

interface SlotAssignment {
  source: SourceType;
  willFail: boolean;
  failureMode: FailureMode;
}

const slotAssignmentArb: fc.Arbitrary<SlotAssignment> = fc.record({
  source: sourceTypeArb,
  willFail: fc.boolean(),
  failureMode: failureModeArb,
});

const slotAssignmentsArb: fc.Arbitrary<SlotAssignment[]> = fc.array(slotAssignmentArb, {
  minLength: 1,
  maxLength: 6,
});

// --- Helpers ---

function makePreparedContent(id: string, source: SourceType, duration = 1): PreparedContent {
  return {
    id,
    type: 'image',
    source,
    mediaUrl: `/media/${id}.jpg`,
    duration,
    metadata: {},
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

/**
 * Runs the LoopEngine through exactly numSlots slots using fake timers,
 * collecting all played content. Matches the timing pattern from the
 * existing LoopEngine.test.ts.
 */
async function runEngineForSlots(
  config: LoopConfig,
  sources: Map<SourceType, ContentSource>,
  fallbackBuffer: FallbackBuffer,
  numSlots: number
): Promise<PreparedContent[]> {
  const playedContent: PreparedContent[] = [];

  const engine = new LoopEngine({
    config,
    sources,
    fallbackBuffer,
    onPlay: (content) => playedContent.push(content),
  });

  const runPromise = engine.run();

  // First slot starts immediately — flush microtasks
  await vi.advanceTimersByTimeAsync(0);

  // For each subsequent slot, advance the timer past the previous slot's duration
  // and flush microtasks to trigger confirmPlay + the next executeNextSlot
  for (let i = 1; i < numSlots; i++) {
    // content.duration = 1 → 1000ms wait
    await vi.advanceTimersByTimeAsync(1000);
    // Extra flushes needed for confirmPlay (async) → advance index → executeNextSlot → prefetch
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  }

  engine.stop();
  await runPromise;

  return playedContent;
}

// --- Property Tests ---

describe('Property 3: Source Fallback to Playlist Local', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('every failed slot is filled with playlist/fallback content — never null, never black screen', async () => {
    await fc.assert(
      fc.asyncProperty(slotAssignmentsArb, async (assignments) => {
        vi.clearAllMocks();

        const slots: SlotConfig[] = assignments.map((a, i) => ({
          position: i,
          source: a.source,
          duration: 1,
        }));

        const config: LoopConfig = {
          slots,
          total_duration: slots.length,
          version: '1.0.0',
        };

        // Create sources where EVERY call fails — this ensures no prefetch can save a slot
        const sources = new Map<SourceType, ContentSource>();
        const uniqueSources = new Set(assignments.map((a) => a.source));

        for (const sourceType of uniqueSources) {
          // Find what failure modes are used for this source type
          const failingAssignments = assignments.filter(
            (a) => a.source === sourceType && a.willFail
          );
          const successAssignments = assignments.filter(
            (a) => a.source === sourceType && !a.willFail
          );

          // If ALL assignments for this source fail, the source always fails
          const allFail = successAssignments.length === 0;

          if (allFail && failingAssignments.length > 0) {
            const mode = failingAssignments[0]!.failureMode;
            if (mode === 'not-registered') continue;

            const source: ContentSource = {
              id: sourceType,
              prefetch: vi.fn(async () => {
                if (mode === 'throws-error') {
                  throw new Error('Simulated source failure');
                }
                return null;
              }),
              confirmPlay: vi.fn(async () => {}),
              reportFailure: vi.fn(async () => {}),
              isAvailable: vi.fn(() => mode !== 'not-available'),
            };
            sources.set(sourceType, source);
          } else {
            // Mix of success and failure — source sometimes works
            const source: ContentSource = {
              id: sourceType,
              prefetch: vi.fn(async () => {
                return makePreparedContent(`${sourceType}-ok`, sourceType, 1);
              }),
              confirmPlay: vi.fn(async () => {}),
              reportFailure: vi.fn(async () => {}),
              isAvailable: vi.fn(() => true),
            };
            sources.set(sourceType, source);
          }
        }

        const fallbackBuffer = createMockFallbackBuffer();
        const playedContent = await runEngineForSlots(config, sources, fallbackBuffer, slots.length);

        // --- PROPERTY ASSERTIONS ---

        // 1. Every slot got content (no nulls, no black screen)
        //    This is THE core property: regardless of source behavior, content always plays
        expect(playedContent.length).toBe(slots.length);
        for (let i = 0; i < playedContent.length; i++) {
          const content = playedContent[i]!;
          expect(content).toBeDefined();
          expect(content.id).toBeTruthy();
          expect(content.duration).toBeGreaterThan(0);
          expect(content.source).toBeTruthy();
        }

        // 2. For source types that ALWAYS fail (all assignments are willFail),
        //    every slot using that source must be filled from fallback (playlist)
        for (let i = 0; i < assignments.length; i++) {
          const assignment = assignments[i]!;
          const content = playedContent[i]!;

          const allAssignmentsForSourceFail = assignments
            .filter((a) => a.source === assignment.source)
            .every((a) => a.willFail);

          if (allAssignmentsForSourceFail && assignment.willFail) {
            // Source always fails → fallback must have filled this slot
            expect(content.source).toBe('playlist');
          }
        }

        // 3. Content is always either from the assigned source or from playlist (fallback)
        for (let i = 0; i < playedContent.length; i++) {
          const content = playedContent[i]!;
          const assignedSource = assignments[i]!.source;
          // Content comes from either the assigned source or from fallback (playlist)
          expect(['playlist', assignedSource]).toContain(content.source);
        }
      }),
      { numRuns: 50 }
    );
  });

  it('fallback buffer getNext() is called for every slot with a failing source', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            source: fc.constantFrom<SourceType>('prodooh', 'gam', 'url'),
            failureMode: failureModeArb,
          }),
          { minLength: 1, maxLength: 5 }
        ),
        async (failingSlots) => {
          vi.clearAllMocks();

          // ALL slots in this test FAIL
          const slots: SlotConfig[] = failingSlots.map((s, i) => ({
            position: i,
            source: s.source,
            duration: 1,
          }));

          const config: LoopConfig = {
            slots,
            total_duration: slots.length,
            version: '1.0.0',
          };

          // Create sources that always fail
          const sources = new Map<SourceType, ContentSource>();
          const uniqueSources = new Set(failingSlots.map((s) => s.source));

          for (const sourceType of uniqueSources) {
            const mode = failingSlots.find((s) => s.source === sourceType)!.failureMode;
            if (mode === 'not-registered') continue;

            const source: ContentSource = {
              id: sourceType,
              prefetch: vi.fn(async () => {
                if (mode === 'throws-error') {
                  throw new Error('Source failure');
                }
                return null;
              }),
              confirmPlay: vi.fn(async () => {}),
              reportFailure: vi.fn(async () => {}),
              isAvailable: vi.fn(() => mode !== 'not-available'),
            };
            sources.set(sourceType, source);
          }

          const fallbackBuffer = createMockFallbackBuffer();
          const playedContent = await runEngineForSlots(config, sources, fallbackBuffer, slots.length);

          // ALL content should come from the fallback buffer
          expect(playedContent.length).toBe(slots.length);
          for (const content of playedContent) {
            expect(content.source).toBe('playlist');
            expect(content.id).toMatch(/^fallback-/);
          }

          // Fallback buffer getNext() was called for every slot
          expect(fallbackBuffer.getNext).toHaveBeenCalledTimes(slots.length);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('loop continues to the next slot without interruption after failures', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            source: sourceTypeArb,
            willFail: fc.boolean(),
          }),
          { minLength: 2, maxLength: 6 }
        ),
        async (slotDefs) => {
          vi.clearAllMocks();

          const slots: SlotConfig[] = slotDefs.map((s, i) => ({
            position: i,
            source: s.source,
            duration: 1,
          }));

          const config: LoopConfig = {
            slots,
            total_duration: slots.length,
            version: '1.0.0',
          };

          // Build sources with per-call fail/success behavior
          const sources = new Map<SourceType, ContentSource>();
          const uniqueSources = new Set(slotDefs.map((s) => s.source));

          for (const sourceType of uniqueSources) {
            const callBehaviors = slotDefs
              .filter((s) => s.source === sourceType)
              .map((s) => s.willFail);

            let callIdx = 0;
            const source: ContentSource = {
              id: sourceType,
              prefetch: vi.fn(async () => {
                const shouldFail = callBehaviors[callIdx % callBehaviors.length];
                callIdx++;
                if (shouldFail) return null;
                return makePreparedContent(`${sourceType}-${callIdx}`, sourceType, 1);
              }),
              confirmPlay: vi.fn(async () => {}),
              reportFailure: vi.fn(async () => {}),
              isAvailable: vi.fn(() => true),
            };
            sources.set(sourceType, source);
          }

          const fallbackBuffer = createMockFallbackBuffer();
          const playedContent = await runEngineForSlots(config, sources, fallbackBuffer, slots.length);

          // The loop visited ALL slots — failures didn't interrupt the sequence
          expect(playedContent.length).toBe(slots.length);

          // No content is null/undefined (never a black screen)
          for (const content of playedContent) {
            expect(content).toBeDefined();
            expect(content.duration).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
