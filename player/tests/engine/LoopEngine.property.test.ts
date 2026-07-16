/**
 * Property-based test: Round-robin selection in LoopEngine
 *
 * **Validates: Requirements 7.12**
 *
 * Property 18: Sequential round-robin rotation in player —
 * For any slot with N candidates and strategy "round_robin", the player must
 * reproduce the candidate at position (iteration_count mod N) in each iteration
 * of the loop, advancing sequentially without repeating until completing the cycle.
 *
 * Uses fast-check to generate slots with N candidates and M iterations.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  LoopEngine,
  type LoopTemplate,
  type LoopSlot,
  type SlotCandidate,
} from '../../src/engine/LoopEngine';

// --- Helpers ---

function createTemplate(slots: LoopSlot[]): LoopTemplate {
  return {
    version: 'sha256:property-test',
    generated_at: '2025-01-15T10:30:00Z',
    loop_config: {
      num_slots: slots.length,
      slot_duration_seconds: 10,
      loop_duration_seconds: slots.length * 10,
      loops_per_day: 576,
    },
    slots,
    sync_interval_seconds: 240,
    cache_flush_interval_hours: 24,
  };
}

function createCandidate(index: number): SlotCandidate {
  return {
    order_line_id: `ol-${index}`,
    creative_id: `cr-${index}`,
    asset_url: `https://cdn.example.com/asset-${index}.mp4`,
    checksum_sha256: `sha256-${index}`,
  };
}

// --- Arbitraries ---

/**
 * Generates a round-robin slot with N candidates (2 to 20) at a given position.
 */
const roundRobinSlotArb = (position: number) =>
  fc.integer({ min: 2, max: 20 }).map((numCandidates): LoopSlot => ({
    position,
    type: 'ad',
    strategy: 'round_robin',
    candidates: Array.from({ length: numCandidates }, (_, i) => createCandidate(position * 100 + i)),
  }));

/**
 * Generates test parameters: a single round-robin slot with N candidates
 * and M iterations to run.
 */
const singleSlotScenarioArb = fc.record({
  numCandidates: fc.integer({ min: 2, max: 20 }),
  numIterations: fc.integer({ min: 2, max: 30 }),
});

/**
 * Generates a multi-slot scenario: multiple round-robin slots,
 * each with an independent candidate count, and M iterations.
 */
const multiSlotScenarioArb = fc.record({
  slotConfigs: fc.array(
    fc.integer({ min: 2, max: 10 }),
    { minLength: 2, maxLength: 6 },
  ),
  numIterations: fc.integer({ min: 2, max: 15 }),
});

// --- Tests ---

describe('Property 18: Sequential round-robin rotation in player', () => {
  it('selects candidate at position (iteration mod N) for a single round-robin slot', async () => {
    await fc.assert(
      fc.asyncProperty(
        singleSlotScenarioArb,
        async ({ numCandidates, numIterations }) => {
          const candidates = Array.from({ length: numCandidates }, (_, i) => createCandidate(i));
          const slot: LoopSlot = {
            position: 0,
            type: 'ad',
            strategy: 'round_robin',
            candidates,
          };
          const template = createTemplate([slot]);

          const playedIndices: number[] = [];
          let callCount = 0;
          const totalPlays = numIterations;

          const engine = new LoopEngine({
            template,
            playbackFn: async (candidate, _durationMs) => {
              // Determine which candidate index was played
              const idx = candidates.findIndex(c => c.asset_url === candidate.asset_url);
              playedIndices.push(idx);
              callCount++;
              if (callCount >= totalPlays) engine.stop();
              return 'success';
            },
          });

          await engine.run();

          // Verify: each iteration i should play candidate at index (i mod N)
          expect(playedIndices.length).toBe(numIterations);
          for (let i = 0; i < numIterations; i++) {
            const expectedIndex = i % numCandidates;
            expect(playedIndices[i]).toBe(expectedIndex);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('advances sequentially without repeating until completing the full cycle', async () => {
    await fc.assert(
      fc.asyncProperty(
        singleSlotScenarioArb,
        async ({ numCandidates, numIterations }) => {
          const candidates = Array.from({ length: numCandidates }, (_, i) => createCandidate(i));
          const slot: LoopSlot = {
            position: 0,
            type: 'ad',
            strategy: 'round_robin',
            candidates,
          };
          const template = createTemplate([slot]);

          const playedIndices: number[] = [];
          let callCount = 0;
          // Play at least one full cycle of N candidates
          const totalPlays = Math.max(numIterations, numCandidates);

          const engine = new LoopEngine({
            template,
            playbackFn: async (candidate, _durationMs) => {
              const idx = candidates.findIndex(c => c.asset_url === candidate.asset_url);
              playedIndices.push(idx);
              callCount++;
              if (callCount >= totalPlays) engine.stop();
              return 'success';
            },
          });

          await engine.run();

          // Property: within each complete cycle of N plays, all N candidates appear exactly once
          const fullCycles = Math.floor(playedIndices.length / numCandidates);
          for (let cycle = 0; cycle < fullCycles; cycle++) {
            const cycleSlice = playedIndices.slice(cycle * numCandidates, (cycle + 1) * numCandidates);
            // Each candidate should appear exactly once in the cycle
            const uniqueInCycle = new Set(cycleSlice);
            expect(uniqueInCycle.size).toBe(numCandidates);
            // And they should be in sequential order: 0, 1, 2, ..., N-1
            for (let j = 0; j < numCandidates; j++) {
              expect(cycleSlice[j]).toBe(j);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('maintains independent round-robin offsets per slot position in multi-slot templates', async () => {
    await fc.assert(
      fc.asyncProperty(
        multiSlotScenarioArb,
        async ({ slotConfigs, numIterations }) => {
          const slots: LoopSlot[] = slotConfigs.map((numCandidates, position) => ({
            position,
            type: 'ad' as const,
            strategy: 'round_robin' as const,
            candidates: Array.from({ length: numCandidates }, (_, i) => createCandidate(position * 100 + i)),
          }));
          const template = createTemplate(slots);

          // Track played candidates per slot position
          const playedPerSlot: Map<number, number[]> = new Map();
          slots.forEach((_, idx) => playedPerSlot.set(idx, []));

          let callCount = 0;
          const totalPlays = slots.length * numIterations;

          const engine = new LoopEngine({
            template,
            playbackFn: async (candidate, _durationMs) => {
              // Determine which slot this belongs to based on the URL pattern
              for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
                const slot = slots[slotIdx]!;
                const candidateIdx = slot.candidates.findIndex(c => c.asset_url === candidate.asset_url);
                if (candidateIdx !== -1) {
                  playedPerSlot.get(slotIdx)!.push(candidateIdx);
                  break;
                }
              }
              callCount++;
              if (callCount >= totalPlays) engine.stop();
              return 'success';
            },
          });

          await engine.run();

          // Verify: each slot independently rotates (iteration mod N_slot)
          for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
            const numCandidates = slotConfigs[slotIdx]!;
            const played = playedPerSlot.get(slotIdx)!;

            expect(played.length).toBe(numIterations);
            for (let iter = 0; iter < numIterations; iter++) {
              const expectedIndex = iter % numCandidates;
              expect(played[iter]).toBe(expectedIndex);
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
