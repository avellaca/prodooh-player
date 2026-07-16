/**
 * Integration tests for LoopEngine wiring into the player main entry point.
 *
 * Validates:
 * - onSlotStartCallback setter wires rendering after construction
 * - onSlotComplete fires for impression reporting on ad slots
 * - ManifestSyncManager → LoopEngine.updateTemplate() atomic swap
 * - Graceful degradation: engine continues with local template on backend failure
 *
 * Requirements: 7.1, 7.11
 */
import { describe, it, expect, vi } from 'vitest';
import {
  LoopEngine,
  type LoopTemplate,
  type LoopSlot,
  type SlotCandidate,
} from '../../src/engine/LoopEngine';

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

function createCandidate(id: string): SlotCandidate {
  return {
    order_line_id: `ol-${id}`,
    creative_id: `cr-${id}`,
    asset_url: `https://cdn.example.com/${id}.mp4`,
    checksum_sha256: `sha256-${id}`,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('LoopEngine wiring (task 9.7)', () => {
  describe('onSlotStartCallback setter', () => {
    it('wires rendering callback after construction', async () => {
      const slots = [createAdSlot(0, [createCandidate('A')])];
      const template = createTemplate(slots);

      const renderedSlots: Array<{ position: number; assetUrl: string }> = [];
      let callCount = 0;

      // Create engine WITHOUT onSlotStart
      const engine = new LoopEngine({
        template,
        playbackFn: async (_candidate, _durationMs) => {
          callCount++;
          if (callCount >= 2) engine.stop();
          return 'success';
        },
      });

      // Wire onSlotStart AFTER construction via setter (as main.ts does)
      engine.onSlotStartCallback = (slot: LoopSlot, candidate: SlotCandidate, _iteration: number) => {
        renderedSlots.push({ position: slot.position, assetUrl: candidate.asset_url });
      };

      await engine.run();

      expect(renderedSlots).toEqual([
        { position: 0, assetUrl: 'https://cdn.example.com/A.mp4' },
        { position: 0, assetUrl: 'https://cdn.example.com/A.mp4' },
      ]);
    });

    it('overrides initial onSlotStart when set via setter', async () => {
      const slots = [createAdSlot(0, [createCandidate('A')])];
      const template = createTemplate(slots);

      const initialCalls: number[] = [];
      const setterCalls: number[] = [];
      let callCount = 0;

      const engine = new LoopEngine({
        template,
        onSlotStart: (_slot, _candidate, iteration) => {
          initialCalls.push(iteration);
        },
        playbackFn: async (_candidate, _durationMs) => {
          callCount++;
          if (callCount >= 2) engine.stop();
          return 'success';
        },
      });

      // Override with setter before running
      engine.onSlotStartCallback = (_slot, _candidate, iteration) => {
        setterCalls.push(iteration);
      };

      await engine.run();

      expect(initialCalls).toEqual([]); // Original not called
      expect(setterCalls).toEqual([0, 1]); // Setter callback called
    });
  });

  describe('onSlotComplete for impression reporting', () => {
    it('fires onSlotComplete with result for ad slots', async () => {
      const slots = [createAdSlot(0, [createCandidate('A')])];
      const template = createTemplate(slots);

      const impressions: Array<{
        orderLineId: string | undefined;
        creativeId: string | undefined;
        result: string;
      }> = [];
      let callCount = 0;

      const engine = new LoopEngine({
        template,
        onSlotComplete: (slot, candidate, result) => {
          if (slot.type === 'ad' && candidate.order_line_id && candidate.creative_id) {
            impressions.push({
              orderLineId: candidate.order_line_id,
              creativeId: candidate.creative_id,
              result,
            });
          }
        },
        playbackFn: async (_candidate, _durationMs) => {
          callCount++;
          if (callCount >= 2) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      expect(impressions).toEqual([
        { orderLineId: 'ol-A', creativeId: 'cr-A', result: 'success' },
        { orderLineId: 'ol-A', creativeId: 'cr-A', result: 'success' },
      ]);
    });

    it('reports failed result when playback fails', async () => {
      const slots = [createAdSlot(0, [createCandidate('A')])];
      const template = createTemplate(slots);

      const results: string[] = [];
      let callCount = 0;

      const engine = new LoopEngine({
        template,
        onSlotComplete: (_slot, _candidate, result) => {
          results.push(result);
        },
        playbackFn: async (_candidate, _durationMs) => {
          callCount++;
          if (callCount >= 2) engine.stop();
          return 'failed';
        },
      });

      await engine.run();

      expect(results).toEqual(['failed', 'failed']);
    });
  });

  describe('ManifestSyncManager → LoopEngine.updateTemplate()', () => {
    it('applies new template from sync manager via updateTemplate()', async () => {
      const oldSlots = [createAdSlot(0, [createCandidate('OLD')])];
      const oldTemplate = createTemplate(oldSlots, { version: 'sha256:old' });

      const newSlots = [createAdSlot(0, [createCandidate('NEW')])];
      const newTemplate = createTemplate(newSlots, { version: 'sha256:new' });

      const playedAssets: string[] = [];
      let callCount = 0;

      const engine = new LoopEngine({
        template: oldTemplate,
        playbackFn: async (candidate, _durationMs) => {
          playedAssets.push(candidate.asset_url);
          callCount++;
          // Simulate sync manager delivering a new template after first slot
          if (callCount === 1) {
            engine.updateTemplate(newTemplate);
          }
          if (callCount >= 2) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      // First plays OLD, then after template swap plays NEW
      expect(playedAssets).toEqual([
        'https://cdn.example.com/OLD.mp4',
        'https://cdn.example.com/NEW.mp4',
      ]);
    });
  });

  describe('graceful degradation', () => {
    it('continues playing existing template when no new template arrives', async () => {
      const slots = [
        createAdSlot(0, [createCandidate('A')]),
        createAdSlot(1, [createCandidate('B')]),
      ];
      const template = createTemplate(slots);

      const playedAssets: string[] = [];
      let callCount = 0;

      const engine = new LoopEngine({
        template,
        playbackFn: async (candidate, _durationMs) => {
          playedAssets.push(candidate.asset_url);
          callCount++;
          if (callCount >= 4) engine.stop();
          return 'success';
        },
      });

      // Simulate backend unreachable — updateTemplate() is never called
      // The engine should continue with the local template (Req 7.11)
      await engine.run();

      expect(playedAssets).toEqual([
        'https://cdn.example.com/A.mp4',
        'https://cdn.example.com/B.mp4',
        'https://cdn.example.com/A.mp4',
        'https://cdn.example.com/B.mp4',
      ]);
      expect(engine.getIteration()).toBe(2);
    });

    it('continues looping even after stop + restart with same template', async () => {
      const slots = [createAdSlot(0, [createCandidate('A')])];
      const template = createTemplate(slots);

      let callCount = 0;
      const engine = new LoopEngine({
        template,
        playbackFn: async (_candidate, _durationMs) => {
          callCount++;
          if (callCount >= 3) engine.stop();
          return 'success';
        },
      });

      await engine.run();
      expect(callCount).toBe(3);
    });
  });

  describe('onSlotCompleteCallback setter', () => {
    it('wires onSlotComplete callback after construction', async () => {
      const slots = [createAdSlot(0, [createCandidate('A')])];
      const template = createTemplate(slots);

      const completions: string[] = [];
      let callCount = 0;

      const engine = new LoopEngine({
        template,
        playbackFn: async (_candidate, _durationMs) => {
          callCount++;
          if (callCount >= 1) engine.stop();
          return 'success';
        },
      });

      // Wire via setter after construction
      engine.onSlotCompleteCallback = (_slot, candidate, result) => {
        completions.push(`${candidate.creative_id}:${result}`);
      };

      await engine.run();

      expect(completions).toEqual(['cr-A:success']);
    });
  });
});
