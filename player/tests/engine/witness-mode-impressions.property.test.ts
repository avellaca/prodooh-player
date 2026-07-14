/**
 * Property-based test: Witness Mode Impression Exclusion
 *
 * Feature: 08-reingenieria-back-front, Property 10: Witness Mode Impression Exclusion
 *
 * **Validates: Requirements 20.8, 21.5**
 *
 * Properties:
 * - When witness mode is active (factor > 1, not expired), `isWitnessMode()` returns true
 *   → impressions should be flagged as 'witness'
 * - When witness mode is NOT active (factor = 1 or expired), `isWitnessMode()` returns false
 *   → impressions should be 'normal'
 * - The mode flag is deterministic based on the override state
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { SpeedOverrideHandler } from '../../src/engine/SpeedOverrideHandler';
import type { DeviceCommand } from '../../src/sync/HeartbeatService';

// --- Arbitraries ---

/** Valid speed factors that activate witness mode (factor > 1) */
const activeFactorArb = fc.constantFrom(2, 4);

/** All valid speed factors including 1 (which deactivates) */
const anyValidFactorArb = fc.constantFrom(1, 2, 4);

/** Invalid factor values that should default to 1 */
const invalidFactorArb = fc.oneof(
  fc.integer({ min: 5, max: 100 }),
  fc.integer({ min: -100, max: 0 }),
  fc.constantFrom(3, 5, 6, 7, 8, 10),
  fc.double({ min: 1.1, max: 10.0, noNaN: true }),
);

/**
 * Generate a future expiry offset in milliseconds (1 second to 1 hour).
 */
const futureExpiryOffsetArb = fc.integer({ min: 1000, max: 3600000 });

/**
 * Generate a past expiry offset in milliseconds (1 second to 1 hour in the past).
 */
const pastExpiryOffsetArb = fc.integer({ min: 1000, max: 3600000 });

/**
 * Generate a base time (arbitrary timestamp within a reasonable range).
 */
const baseTimeArb = fc.integer({
  min: new Date('2024-01-01T00:00:00Z').getTime(),
  max: new Date('2026-12-31T23:59:59Z').getTime(),
});

// --- Helpers ---

function createSpeedCommand(factor: unknown, expiresAtIso: string): DeviceCommand {
  return {
    id: `cmd-${Math.random().toString(36).slice(2)}`,
    type: 'speed_override',
    payload: { factor, expires_at: expiresAtIso },
  };
}

function classifyImpression(handler: SpeedOverrideHandler): 'witness' | 'normal' {
  return handler.isWitnessMode() ? 'witness' : 'normal';
}

// --- Property Tests ---

describe('Property 10: Witness Mode Impression Exclusion', () => {
  it('witness mode active (factor > 1, not expired) → impressions flagged as witness', async () => {
    await fc.assert(
      fc.property(
        baseTimeArb,
        activeFactorArb,
        futureExpiryOffsetArb,
        (baseTime, factor, expiryOffset) => {
          const expiresAt = new Date(baseTime + expiryOffset).toISOString();
          const handler = new SpeedOverrideHandler({ now: () => baseTime });

          const cmd = createSpeedCommand(factor, expiresAt);
          handler.handleCommand(cmd);

          // Property: isWitnessMode() must be true
          expect(handler.isWitnessMode()).toBe(true);

          // Property: impressions should be flagged as 'witness'
          expect(classifyImpression(handler)).toBe('witness');

          // Property: factor is > 1
          expect(handler.getFactor()).toBe(factor);
          expect(handler.getFactor()).toBeGreaterThan(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('witness mode NOT active (factor = 1) → impressions flagged as normal', async () => {
    await fc.assert(
      fc.property(
        baseTimeArb,
        futureExpiryOffsetArb,
        (baseTime, expiryOffset) => {
          const expiresAt = new Date(baseTime + expiryOffset).toISOString();
          const handler = new SpeedOverrideHandler({ now: () => baseTime });

          // First activate with factor > 1, then deactivate with factor 1
          const activateCmd = createSpeedCommand(2, expiresAt);
          handler.handleCommand(activateCmd);

          const deactivateCmd = createSpeedCommand(1, expiresAt);
          handler.handleCommand(deactivateCmd);

          // Property: isWitnessMode() must be false
          expect(handler.isWitnessMode()).toBe(false);

          // Property: impressions should be flagged as 'normal'
          expect(classifyImpression(handler)).toBe('normal');

          // Property: factor is 1
          expect(handler.getFactor()).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('witness mode NOT active (expired) → impressions flagged as normal', async () => {
    await fc.assert(
      fc.property(
        baseTimeArb,
        activeFactorArb,
        pastExpiryOffsetArb,
        (baseTime, factor, pastOffset) => {
          // Set current time AFTER the expiry
          const expiresAt = new Date(baseTime - pastOffset).toISOString();
          const handler = new SpeedOverrideHandler({ now: () => baseTime });

          const cmd = createSpeedCommand(factor, expiresAt);
          handler.handleCommand(cmd);

          // Property: isWitnessMode() must be false (command ignored because already expired)
          expect(handler.isWitnessMode()).toBe(false);

          // Property: impressions should be flagged as 'normal'
          expect(classifyImpression(handler)).toBe('normal');

          // Property: factor is 1 (no override)
          expect(handler.getFactor()).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('witness mode auto-expires → impressions transition from witness to normal', async () => {
    await fc.assert(
      fc.property(
        baseTimeArb,
        activeFactorArb,
        futureExpiryOffsetArb,
        fc.integer({ min: 1, max: 60000 }), // extra time past expiry
        (baseTime, factor, expiryOffset, extraPastExpiry) => {
          let currentTime = baseTime;
          const expiresAtMs = baseTime + expiryOffset;
          const expiresAt = new Date(expiresAtMs).toISOString();

          const handler = new SpeedOverrideHandler({ now: () => currentTime });

          const cmd = createSpeedCommand(factor, expiresAt);
          handler.handleCommand(cmd);

          // Before expiry: witness mode should be active
          expect(handler.isWitnessMode()).toBe(true);
          expect(classifyImpression(handler)).toBe('witness');

          // Advance time past expiry
          currentTime = expiresAtMs + extraPastExpiry;

          // After expiry: witness mode should be inactive
          expect(handler.isWitnessMode()).toBe(false);
          expect(classifyImpression(handler)).toBe('normal');
          expect(handler.getFactor()).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('mode flag is deterministic: same state always yields same classification', async () => {
    await fc.assert(
      fc.property(
        baseTimeArb,
        anyValidFactorArb,
        futureExpiryOffsetArb,
        fc.integer({ min: 5, max: 50 }), // number of times to check
        (baseTime, factor, expiryOffset, checks) => {
          const expiresAt = new Date(baseTime + expiryOffset).toISOString();
          const handler = new SpeedOverrideHandler({ now: () => baseTime });

          const cmd = createSpeedCommand(factor, expiresAt);
          handler.handleCommand(cmd);

          // Query isWitnessMode() multiple times — must always return the same value
          const firstResult = handler.isWitnessMode();
          const firstClassification = classifyImpression(handler);

          for (let i = 0; i < checks; i++) {
            expect(handler.isWitnessMode()).toBe(firstResult);
            expect(classifyImpression(handler)).toBe(firstClassification);
          }

          // Verify classification is consistent with factor
          if (factor > 1) {
            expect(firstClassification).toBe('witness');
          } else {
            expect(firstClassification).toBe('normal');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('invalid factors default to 1 → impressions always normal', async () => {
    await fc.assert(
      fc.property(
        baseTimeArb,
        invalidFactorArb,
        futureExpiryOffsetArb,
        (baseTime, invalidFactor, expiryOffset) => {
          const expiresAt = new Date(baseTime + expiryOffset).toISOString();
          const handler = new SpeedOverrideHandler({ now: () => baseTime });

          const cmd = createSpeedCommand(invalidFactor, expiresAt);
          handler.handleCommand(cmd);

          // Property: invalid factor defaults to 1, so no witness mode
          expect(handler.isWitnessMode()).toBe(false);
          expect(classifyImpression(handler)).toBe('normal');
          expect(handler.getFactor()).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
