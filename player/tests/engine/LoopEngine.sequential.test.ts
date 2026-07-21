/**
 * Unit tests for LoopEngine sequential strategy.
 *
 * Validates: Requirements 10.1, 10.2
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LoopEngine,
  type LoopTemplate,
  type LoopSlot,
  type SlotCandidate,
} from '../../src/engine/LoopEngine';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTemplate(slots: LoopSlot[]): LoopTemplate {
  return {
    version: 'sha256:test-version',
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

function createSlot(
  position: number,
  candidates: SlotCandidate[],
  strategy: 'fixed' | 'round_robin' | 'sequential',
): LoopSlot {
  return { position, type: 'ad', strategy, candidates };
}

function createCandidate(id: string): SlotCandidate {
  return {
    order_line_id: `ol-${id}`,
    creative_id: `cr-${id}`,
    asset_url: `https://cdn.example.com/${id}.mp4`,
    checksum_sha256: `sha256-${id}`,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('LoopEngine — sequential strategy', () => {
  let playbackFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    playbackFn = vi.fn().mockResolvedValue('success' as const);
  });

  describe('sequential plays candidates in order', () => {
    it('plays candidates in array order (0, 1, 2)', async () => {
      const candidates = [createCandidate('A'), createCandidate('B'), createCandidate('C')];
      const slots = [createSlot(0, candidates, 'sequential')];
      const template = createTemplate(slots);

      const playedCandidates: string[] = [];
      let callCount = 0;

      const engine = new LoopEngine({
        template,
        playbackFn: async (candidate, _durationMs) => {
          playedCandidates.push(candidate.creative_id!);
          callCount++;
          if (callCount >= 3) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      expect(playedCandidates).toEqual(['cr-A', 'cr-B', 'cr-C']);
    });

    it('respects the pre-ordered array from backend (position order)', async () => {
      // Candidates arrive pre-ordered by position from the backend
      const candidates = [
        createCandidate('first'),
        createCandidate('second'),
        createCandidate('third'),
        createCandidate('fourth'),
      ];
      const slots = [createSlot(0, candidates, 'sequential')];
      const template = createTemplate(slots);

      const playedCandidates: string[] = [];
      let callCount = 0;

      const engine = new LoopEngine({
        template,
        playbackFn: async (candidate, _durationMs) => {
          playedCandidates.push(candidate.creative_id!);
          callCount++;
          if (callCount >= 4) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      expect(playedCandidates).toEqual([
        'cr-first',
        'cr-second',
        'cr-third',
        'cr-fourth',
      ]);
    });
  });

  describe('sequential cycles back to start after last candidate', () => {
    it('wraps around to the first candidate after exhausting all', async () => {
      const candidates = [createCandidate('A'), createCandidate('B'), createCandidate('C')];
      const slots = [createSlot(0, candidates, 'sequential')];
      const template = createTemplate(slots);

      const playedCandidates: string[] = [];
      let callCount = 0;

      const engine = new LoopEngine({
        template,
        playbackFn: async (candidate, _durationMs) => {
          playedCandidates.push(candidate.creative_id!);
          callCount++;
          if (callCount >= 7) engine.stop(); // More than 2 full cycles
          return 'success';
        },
      });

      await engine.run();

      // A, B, C, A, B, C, A — cycles back deterministically
      expect(playedCandidates).toEqual([
        'cr-A', 'cr-B', 'cr-C',
        'cr-A', 'cr-B', 'cr-C',
        'cr-A',
      ]);
    });

    it('works correctly with a single candidate (always plays same one)', async () => {
      const candidates = [createCandidate('only')];
      const slots = [createSlot(0, candidates, 'sequential')];
      const template = createTemplate(slots);

      const playedCandidates: string[] = [];
      let callCount = 0;

      const engine = new LoopEngine({
        template,
        playbackFn: async (candidate, _durationMs) => {
          playedCandidates.push(candidate.creative_id!);
          callCount++;
          if (callCount >= 3) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      expect(playedCandidates).toEqual(['cr-only', 'cr-only', 'cr-only']);
    });

    it('maintains independent sequential offsets per slot position', async () => {
      const candidatesSlot0 = [createCandidate('X'), createCandidate('Y')];
      const candidatesSlot1 = [createCandidate('P'), createCandidate('Q'), createCandidate('R')];
      const slots = [
        createSlot(0, candidatesSlot0, 'sequential'),
        createSlot(1, candidatesSlot1, 'sequential'),
      ];
      const template = createTemplate(slots);

      const playedCandidates: string[] = [];
      let callCount = 0;

      const engine = new LoopEngine({
        template,
        playbackFn: async (candidate, _durationMs) => {
          playedCandidates.push(candidate.creative_id!);
          callCount++;
          if (callCount >= 6) engine.stop(); // 3 iterations
          return 'success';
        },
      });

      await engine.run();

      // Slot 0 (2 candidates): X, Y, X
      // Slot 1 (3 candidates): P, Q, R
      expect(playedCandidates).toEqual([
        'cr-X', 'cr-P',  // iteration 0
        'cr-Y', 'cr-Q',  // iteration 1
        'cr-X', 'cr-R',  // iteration 2 (slot 0 wraps)
      ]);
    });
  });

  describe('unknown strategy falls back to round_robin', () => {
    it('treats an unknown strategy the same as round_robin', async () => {
      const candidates = [createCandidate('A'), createCandidate('B'), createCandidate('C')];
      // Cast to bypass TypeScript type checking for an unknown strategy value
      const slots = [createSlot(0, candidates, 'unknown_strategy' as any)];
      const template = createTemplate(slots);

      const playedCandidates: string[] = [];
      let callCount = 0;

      const engine = new LoopEngine({
        template,
        playbackFn: async (candidate, _durationMs) => {
          playedCandidates.push(candidate.creative_id!);
          callCount++;
          if (callCount >= 6) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      // Should behave like round_robin: cycle through A, B, C, A, B, C
      expect(playedCandidates).toEqual([
        'cr-A', 'cr-B', 'cr-C',
        'cr-A', 'cr-B', 'cr-C',
      ]);
    });
  });

  describe('existing round_robin and fixed behaviors unchanged', () => {
    it('fixed strategy still always returns candidates[0]', async () => {
      const candidates = [createCandidate('A'), createCandidate('B'), createCandidate('C')];
      const slots = [createSlot(0, candidates, 'fixed')];
      const template = createTemplate(slots);

      const playedCandidates: string[] = [];
      let callCount = 0;

      const engine = new LoopEngine({
        template,
        playbackFn: async (candidate, _durationMs) => {
          playedCandidates.push(candidate.creative_id!);
          callCount++;
          if (callCount >= 4) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      // Always the first candidate
      expect(playedCandidates).toEqual(['cr-A', 'cr-A', 'cr-A', 'cr-A']);
    });

    it('round_robin strategy still rotates through candidates', async () => {
      const candidates = [createCandidate('A'), createCandidate('B'), createCandidate('C')];
      const slots = [createSlot(0, candidates, 'round_robin')];
      const template = createTemplate(slots);

      const playedCandidates: string[] = [];
      let callCount = 0;

      const engine = new LoopEngine({
        template,
        playbackFn: async (candidate, _durationMs) => {
          playedCandidates.push(candidate.creative_id!);
          callCount++;
          if (callCount >= 6) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      // Cycles: A, B, C, A, B, C
      expect(playedCandidates).toEqual([
        'cr-A', 'cr-B', 'cr-C',
        'cr-A', 'cr-B', 'cr-C',
      ]);
    });

    it('selectCandidate returns empty candidate for slot with no candidates', () => {
      const slots = [createSlot(0, [], 'sequential')];
      const template = createTemplate(slots);

      const engine = new LoopEngine({
        template,
        playbackFn: async () => 'success',
      });

      const result = engine.selectCandidate(slots[0]);
      expect(result).toEqual({ asset_url: '', checksum_sha256: '' });
    });
  });
});
