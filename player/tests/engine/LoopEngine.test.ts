/**
 * Unit tests for LoopEngine.
 *
 * Validates: Requirements 7.8, 7.9, 7.10, 7.11, 7.12
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LoopEngine,
  type LoopTemplate,
  type LoopSlot,
  type SlotCandidate,
  type LoopEngineOptions,
} from '../../src/engine/LoopEngine';
import type { SspPrefetcher } from '../../src/engine/SspPrefetcher';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTemplate(slots: LoopSlot[], overrides: Partial<LoopTemplate> = {}): LoopTemplate {
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
    ...overrides,
  };
}

function createAdSlot(position: number, candidates: SlotCandidate[], strategy: 'fixed' | 'round_robin' = 'fixed'): LoopSlot {
  return { position, type: 'ad', strategy, candidates };
}

function createPlaylistSlot(position: number, candidates: SlotCandidate[], strategy: 'fixed' | 'round_robin' = 'round_robin'): LoopSlot {
  return { position, type: 'playlist', strategy, candidates };
}

function createSspSlot(position: number): LoopSlot {
  return {
    position,
    type: 'ssp',
    strategy: 'fixed',
    candidates: [],
    provider: 'prodooh',
    config: { api_key: 'key', network_id: 'net-1', venue_id: 'venue-1' },
  };
}

function createCandidate(id: string): SlotCandidate {
  return {
    order_line_id: `ol-${id}`,
    creative_id: `cr-${id}`,
    asset_url: `https://cdn.example.com/${id}.mp4`,
    checksum_sha256: `sha256-${id}`,
  };
}

function createPlaylistCandidate(id: string): SlotCandidate {
  return {
    playlist_item_id: `pl-${id}`,
    asset_url: `https://cdn.example.com/playlist-${id}.jpg`,
    checksum_sha256: `sha256-pl-${id}`,
  };
}

function createMockSspPrefetcher(opts: { isReady: boolean } = { isReady: false }): SspPrefetcher {
  return {
    prefetch: vi.fn().mockResolvedValue(null),
    expire: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn(),
    isReady: vi.fn().mockReturnValue(opts.isReady),
    getContent: vi.fn().mockReturnValue(
      opts.isReady
        ? { printId: 'print-1', assetUrl: 'https://ssp.example.com/ad.mp4', durationSeconds: 10, popUrl: 'https://ssp.example.com/pop/print-1', expireUrl: 'https://ssp.example.com/expire/print-1' }
        : null,
    ),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('LoopEngine', () => {
  let playbackFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    playbackFn = vi.fn().mockResolvedValue('success' as const);
  });

  describe('continuous loop playback', () => {
    it('loops through all slots sequentially and wraps around', async () => {
      const slots = [
        createAdSlot(0, [createCandidate('A')]),
        createAdSlot(1, [createCandidate('B')]),
        createAdSlot(2, [createCandidate('C')]),
      ];
      const template = createTemplate(slots);

      let callCount = 0;
      const playedCandidates: string[] = [];

      const engine = new LoopEngine({
        template,
        playbackFn: async (candidate, _durationMs) => {
          playedCandidates.push(candidate.asset_url);
          callCount++;
          if (callCount >= 6) engine.stop(); // 2 full loops
          return 'success';
        },
      });

      await engine.run();

      expect(playedCandidates).toEqual([
        'https://cdn.example.com/A.mp4',
        'https://cdn.example.com/B.mp4',
        'https://cdn.example.com/C.mp4',
        'https://cdn.example.com/A.mp4',
        'https://cdn.example.com/B.mp4',
        'https://cdn.example.com/C.mp4',
      ]);
    });

    it('increments iteration after completing all slots', async () => {
      const slots = [
        createAdSlot(0, [createCandidate('A')]),
        createAdSlot(1, [createCandidate('B')]),
      ];
      const template = createTemplate(slots);

      let callCount = 0;
      const iterations: number[] = [];

      const engine = new LoopEngine({
        template,
        onSlotStart: (_slot, _candidate, iteration) => {
          iterations.push(iteration);
        },
        playbackFn: async (_candidate, _durationMs) => {
          callCount++;
          if (callCount >= 4) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      // First 2 items = iteration 0, next 2 = iteration 1
      expect(iterations).toEqual([0, 0, 1, 1]);
    });
  });

  describe('candidate selection — fixed strategy', () => {
    it('always selects candidates[0] for fixed strategy', async () => {
      const candidates = [createCandidate('A'), createCandidate('B'), createCandidate('C')];
      const slots = [createAdSlot(0, candidates, 'fixed')];
      const template = createTemplate(slots);

      const playedCandidates: string[] = [];
      let callCount = 0;

      const engine = new LoopEngine({
        template,
        playbackFn: async (candidate, _durationMs) => {
          playedCandidates.push(candidate.asset_url);
          callCount++;
          if (callCount >= 3) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      // Always the first candidate
      expect(playedCandidates).toEqual([
        'https://cdn.example.com/A.mp4',
        'https://cdn.example.com/A.mp4',
        'https://cdn.example.com/A.mp4',
      ]);
    });
  });

  describe('candidate selection — round_robin strategy', () => {
    it('rotates candidates using (offset mod N) for round_robin strategy', async () => {
      const candidates = [createCandidate('A'), createCandidate('B'), createCandidate('C')];
      const slots = [createAdSlot(0, candidates, 'round_robin')];
      const template = createTemplate(slots);

      const playedCandidates: string[] = [];
      let callCount = 0;

      const engine = new LoopEngine({
        template,
        playbackFn: async (candidate, _durationMs) => {
          playedCandidates.push(candidate.asset_url);
          callCount++;
          if (callCount >= 6) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      // Cycles through A, B, C, A, B, C
      expect(playedCandidates).toEqual([
        'https://cdn.example.com/A.mp4',
        'https://cdn.example.com/B.mp4',
        'https://cdn.example.com/C.mp4',
        'https://cdn.example.com/A.mp4',
        'https://cdn.example.com/B.mp4',
        'https://cdn.example.com/C.mp4',
      ]);
    });

    it('maintains independent rotation offsets per slot position', async () => {
      const candidatesSlot0 = [createCandidate('X'), createCandidate('Y')];
      const candidatesSlot1 = [createCandidate('P'), createCandidate('Q'), createCandidate('R')];
      const slots = [
        createAdSlot(0, candidatesSlot0, 'round_robin'),
        createAdSlot(1, candidatesSlot1, 'round_robin'),
      ];
      const template = createTemplate(slots);

      const playedCandidates: string[] = [];
      let callCount = 0;

      const engine = new LoopEngine({
        template,
        playbackFn: async (candidate, _durationMs) => {
          playedCandidates.push(candidate.asset_url);
          callCount++;
          if (callCount >= 6) engine.stop(); // 3 full loops
          return 'success';
        },
      });

      await engine.run();

      // Slot 0 rotates: X, Y, X (2 candidates, wraps)
      // Slot 1 rotates: P, Q, R (3 candidates)
      expect(playedCandidates).toEqual([
        'https://cdn.example.com/X.mp4', // slot 0, iteration 0
        'https://cdn.example.com/P.mp4', // slot 1, iteration 0
        'https://cdn.example.com/Y.mp4', // slot 0, iteration 1
        'https://cdn.example.com/Q.mp4', // slot 1, iteration 1
        'https://cdn.example.com/X.mp4', // slot 0, iteration 2
        'https://cdn.example.com/R.mp4', // slot 1, iteration 2
      ]);
    });
  });

  describe('atomic template swap via updateTemplate()', () => {
    it('applies new template at the start of the next loop iteration', async () => {
      const slots1 = [
        createAdSlot(0, [createCandidate('OLD-A')]),
        createAdSlot(1, [createCandidate('OLD-B')]),
      ];
      const template1 = createTemplate(slots1);

      const slots2 = [
        createAdSlot(0, [createCandidate('NEW-X')]),
        createAdSlot(1, [createCandidate('NEW-Y')]),
      ];
      const template2 = createTemplate(slots2);

      const playedCandidates: string[] = [];
      let callCount = 0;

      const engine = new LoopEngine({
        template: template1,
        playbackFn: async (candidate, _durationMs) => {
          playedCandidates.push(candidate.asset_url);
          callCount++;
          // Queue the new template during the first loop
          if (callCount === 1) {
            engine.updateTemplate(template2);
          }
          if (callCount >= 4) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      // First loop plays OLD-A, OLD-B (template swap is pending)
      // Second loop picks up NEW-X, NEW-Y
      expect(playedCandidates).toEqual([
        'https://cdn.example.com/OLD-A.mp4',
        'https://cdn.example.com/OLD-B.mp4',
        'https://cdn.example.com/NEW-X.mp4',
        'https://cdn.example.com/NEW-Y.mp4',
      ]);
    });

    it('resets rotation offsets when template is swapped', async () => {
      const slots1 = [createAdSlot(0, [createCandidate('A'), createCandidate('B')], 'round_robin')];
      const template1 = createTemplate(slots1);

      const slots2 = [createAdSlot(0, [createCandidate('X'), createCandidate('Y'), createCandidate('Z')], 'round_robin')];
      const template2 = createTemplate(slots2);

      const playedCandidates: string[] = [];
      let callCount = 0;

      const engine = new LoopEngine({
        template: template1,
        playbackFn: async (candidate, _durationMs) => {
          playedCandidates.push(candidate.asset_url);
          callCount++;
          if (callCount === 2) {
            engine.updateTemplate(template2);
          }
          if (callCount >= 5) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      // Template 1: A, B (rotation 0, 1)
      // Template 2 (reset offsets): X, Y, Z (rotation starts at 0)
      expect(playedCandidates).toEqual([
        'https://cdn.example.com/A.mp4',
        'https://cdn.example.com/B.mp4',
        'https://cdn.example.com/X.mp4',
        'https://cdn.example.com/Y.mp4',
        'https://cdn.example.com/Z.mp4',
      ]);
    });
  });

  describe('SSP slot handling', () => {
    it('plays SSP content from SspPrefetcher when ready', async () => {
      const sspPrefetcher = createMockSspPrefetcher({ isReady: true });
      const slots = [
        createAdSlot(0, [createCandidate('A')]),
        createSspSlot(1),
      ];
      const template = createTemplate(slots);

      const playedCandidates: string[] = [];
      let callCount = 0;

      const engine = new LoopEngine({
        template,
        sspPrefetcher,
        playbackFn: async (candidate, _durationMs) => {
          playedCandidates.push(candidate.asset_url);
          callCount++;
          if (callCount >= 2) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      expect(playedCandidates).toEqual([
        'https://cdn.example.com/A.mp4',
        'https://ssp.example.com/ad.mp4',
      ]);
      expect(sspPrefetcher.cleanup).toHaveBeenCalled();
    });

    it('falls back to first playlist_item when SSP is not ready', async () => {
      const sspPrefetcher = createMockSspPrefetcher({ isReady: false });
      const slots = [
        createAdSlot(0, [createCandidate('A')]),
        createSspSlot(1),
        createPlaylistSlot(2, [createPlaylistCandidate('fallback')]),
      ];
      const template = createTemplate(slots);

      const playedCandidates: string[] = [];
      let callCount = 0;

      const engine = new LoopEngine({
        template,
        sspPrefetcher,
        playbackFn: async (candidate, _durationMs) => {
          playedCandidates.push(candidate.asset_url);
          callCount++;
          if (callCount >= 3) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      expect(playedCandidates[1]).toBe('https://cdn.example.com/playlist-fallback.jpg');
    });

    it('triggers SSP prefetch when the next slot is SSP', async () => {
      const sspPrefetcher = createMockSspPrefetcher({ isReady: true });
      const slots = [
        createAdSlot(0, [createCandidate('A')]),
        createSspSlot(1),
      ];
      const template = createTemplate(slots);

      let callCount = 0;

      const engine = new LoopEngine({
        template,
        sspPrefetcher,
        playbackFn: async (_candidate, _durationMs) => {
          callCount++;
          if (callCount >= 2) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      // Prefetch should have been called when playing slot 0 (next is SSP at slot 1)
      expect(sspPrefetcher.prefetch).toHaveBeenCalledWith(10); // slot_duration_seconds
    });
  });

  describe('callbacks', () => {
    it('calls onSlotStart and onSlotComplete for each slot', async () => {
      const slots = [createAdSlot(0, [createCandidate('A')])];
      const template = createTemplate(slots);

      const starts: Array<{ position: number; iteration: number }> = [];
      const completes: Array<{ position: number; result: string }> = [];

      let callCount = 0;
      const engine = new LoopEngine({
        template,
        onSlotStart: (slot, _candidate, iteration) => {
          starts.push({ position: slot.position, iteration });
        },
        onSlotComplete: (slot, _candidate, result) => {
          completes.push({ position: slot.position, result });
        },
        playbackFn: async (_candidate, _durationMs) => {
          callCount++;
          if (callCount >= 2) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      expect(starts).toEqual([
        { position: 0, iteration: 0 },
        { position: 0, iteration: 1 },
      ]);
      expect(completes).toEqual([
        { position: 0, result: 'success' },
        { position: 0, result: 'success' },
      ]);
    });
  });

  describe('stop()', () => {
    it('stops the loop after current slot finishes', async () => {
      const slots = [
        createAdSlot(0, [createCandidate('A')]),
        createAdSlot(1, [createCandidate('B')]),
      ];
      const template = createTemplate(slots);

      let callCount = 0;

      const engine = new LoopEngine({
        template,
        playbackFn: async (_candidate, _durationMs) => {
          callCount++;
          if (callCount === 1) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      expect(callCount).toBe(1);
      expect(engine.isRunning()).toBe(false);
    });
  });

  describe('empty template handling', () => {
    it('waits and checks again when template has no slots', async () => {
      const template = createTemplate([]);

      let loopCount = 0;

      // We'll swap in a real template after a brief delay
      const engine = new LoopEngine({
        template,
        playbackFn: async (_candidate, _durationMs) => {
          loopCount++;
          engine.stop();
          return 'success';
        },
      });

      // Update template after a small delay
      setTimeout(() => {
        engine.updateTemplate(createTemplate([createAdSlot(0, [createCandidate('A')])]));
      }, 50);

      await engine.run();

      // Should have eventually played once after template was updated
      expect(loopCount).toBe(1);
    });
  });
});
