/**
 * Property-based test: Player Speed Override Calculation
 *
 * Feature: 08-reingenieria-back-front, Property 9: Speed Override Calculation
 *
 * **Validates: Requirements 20.4, 20.5**
 *
 * For any duration (> 0) and any valid speed factor (1, 2, 4):
 * - getEffectiveDuration(duration) === Math.ceil(duration / factor)
 * - After expiry, duration returns to original value (no loss)
 *
 * Uses fast-check with 100+ iterations per property.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { SpeedOverrideHandler } from '../../src/engine/SpeedOverrideHandler';
import type { DeviceCommand } from '../../src/sync/HeartbeatService';

// --- Helpers ---

function createSpeedOverrideCommand(factor: number, expiresAt: string): DeviceCommand {
  return {
    id: 'cmd-pbt',
    type: 'speed_override',
    payload: { factor, expires_at: expiresAt },
  };
}

// --- Arbitraries ---

/** Positive integer durations (1 to 10000 seconds) */
const durationArb = fc.integer({ min: 1, max: 10_000 });

/** Valid speed factors as defined by the spec */
const factorArb = fc.constantFrom(1 as const, 2 as const, 4 as const);

describe('Property 9: Speed Override Calculation', () => {
  it('getEffectiveDuration === Math.ceil(duration / factor) for all valid factors and durations', () => {
    fc.assert(
      fc.property(
        durationArb,
        factorArb,
        (duration, factor) => {
          let currentTime = new Date('2025-01-15T12:00:00Z').getTime();
          const handler = new SpeedOverrideHandler({ now: () => currentTime });

          if (factor === 1) {
            // Factor 1 means no override active → duration unchanged
            expect(handler.getEffectiveDuration(duration)).toBe(duration);
          } else {
            // Activate override with future expiry
            const cmd = createSpeedOverrideCommand(factor, '2025-01-15T12:10:00Z');
            handler.handleCommand(cmd);

            const effective = handler.getEffectiveDuration(duration);
            const expected = Math.ceil(duration / factor);

            expect(effective).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('duration restores to original value after override expires', () => {
    fc.assert(
      fc.property(
        durationArb,
        fc.constantFrom(2 as const, 4 as const),
        (duration, factor) => {
          let currentTime = new Date('2025-01-15T12:00:00Z').getTime();
          const handler = new SpeedOverrideHandler({ now: () => currentTime });

          // Activate override
          const cmd = createSpeedOverrideCommand(factor, '2025-01-15T12:10:00Z');
          handler.handleCommand(cmd);

          // Verify override is active and effective
          expect(handler.isActive()).toBe(true);
          expect(handler.getEffectiveDuration(duration)).toBe(Math.ceil(duration / factor));

          // Advance time past expiry
          currentTime = new Date('2025-01-15T12:11:00Z').getTime();

          // After expiry, duration must return to original — no loss
          expect(handler.isActive()).toBe(false);
          expect(handler.getEffectiveDuration(duration)).toBe(duration);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('factor=1 override clears state and restores original duration', () => {
    fc.assert(
      fc.property(
        durationArb,
        fc.constantFrom(2 as const, 4 as const),
        (duration, factor) => {
          let currentTime = new Date('2025-01-15T12:00:00Z').getTime();
          const handler = new SpeedOverrideHandler({ now: () => currentTime });

          // Activate override with factor > 1
          const activateCmd = createSpeedOverrideCommand(factor, '2025-01-15T12:10:00Z');
          handler.handleCommand(activateCmd);
          expect(handler.getEffectiveDuration(duration)).toBe(Math.ceil(duration / factor));

          // Send factor=1 to restore
          const restoreCmd = createSpeedOverrideCommand(1, '2025-01-15T12:10:00Z');
          handler.handleCommand(restoreCmd);

          // Duration fully restored
          expect(handler.isActive()).toBe(false);
          expect(handler.getEffectiveDuration(duration)).toBe(duration);
        },
      ),
      { numRuns: 100 },
    );
  });
});
