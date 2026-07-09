/**
 * Property-based test: Source Toggle Round-Trip
 *
 * Generates random loop configs and source toggle sequences (disable then re-enable),
 * verifying that the effective config always returns to its original state after
 * a round-trip toggle.
 *
 * **Validates: Requirements 10.3**
 *
 * Requirement 10.3: Allow reactivating a previously disabled source without requiring
 *                   any action other than reverting the same configuration (no special
 *                   restore procedure).
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { SlotConfigManager, type SourcesEnabledConfig } from '../../src/engine/SlotConfigManager';
import type { LoopConfig, SlotConfig } from '../../src/storage/types';
import type { SourceType } from '../../src/sources/types';

// --- Generators ---

/** Available toggleable source types (playlist cannot be disabled) */
const toggleableSources: SourceType[] = ['prodooh', 'gam', 'url'];
const allSources: SourceType[] = ['prodooh', 'gam', 'url', 'playlist'];

/** Arbitrary for a valid source type */
const sourceTypeArb = fc.constantFrom<SourceType>('prodooh', 'gam', 'url', 'playlist');

/** Arbitrary for a toggleable (disableable) source type */
const toggleableSourceArb = fc.constantFrom<SourceType>('prodooh', 'gam', 'url');

/** Arbitrary for slot duration (1-60 seconds) */
const durationArb = fc.integer({ min: 1, max: 60 });

/** Arbitrary for a single slot config */
const slotConfigArb = (position: number): fc.Arbitrary<SlotConfig> =>
  fc.tuple(sourceTypeArb, durationArb).map(([source, duration]) => ({
    position,
    source,
    duration,
  }));

/** Arbitrary for a loop config with 1-20 slots */
const loopConfigArb: fc.Arbitrary<LoopConfig> = fc
  .integer({ min: 1, max: 20 })
  .chain((numSlots) =>
    fc.tuple(
      fc.tuple(...Array.from({ length: numSlots }, (_, i) => slotConfigArb(i))),
      fc.string({ minLength: 1, maxLength: 10 }),
      fc.option(fc.date().map((d) => d.toISOString()), { nil: undefined })
    )
  )
  .map(([slots, version, synced_at]) => ({
    slots,
    total_duration: slots.reduce((sum, s) => sum + s.duration, 0),
    version,
    synced_at,
  }));

/** Arbitrary for a non-empty subset of toggleable sources to disable */
const sourceSubsetArb: fc.Arbitrary<SourceType[]> = fc
  .subarray(toggleableSources, { minLength: 1, maxLength: 3 })
  .filter((arr) => arr.length > 0);

// --- Test Suite ---

describe('Property 13: Source Toggle Round-Trip', () => {
  it('disable then re-enable a single source restores effective config to original', () => {
    fc.assert(
      fc.property(loopConfigArb, toggleableSourceArb, (config, sourceToToggle) => {
        const manager = new SlotConfigManager(config);

        // Capture original effective config (all sources enabled)
        const originalEffective = manager.getEffectiveConfig();

        // Disable the source
        manager.disableSource(sourceToToggle);

        // Re-enable the source
        manager.enableSource(sourceToToggle);

        // After round-trip, effective config must match the original
        const restoredEffective = manager.getEffectiveConfig();
        expect(restoredEffective).toEqual(originalEffective);
      }),
      { numRuns: 200 }
    );
  });

  it('disable then re-enable multiple sources restores effective config to original', () => {
    fc.assert(
      fc.property(loopConfigArb, sourceSubsetArb, (config, sourcesToToggle) => {
        const manager = new SlotConfigManager(config);

        // Capture original effective config
        const originalEffective = manager.getEffectiveConfig();

        // Disable all selected sources
        for (const source of sourcesToToggle) {
          manager.disableSource(source);
        }

        // Re-enable all selected sources (in same order)
        for (const source of sourcesToToggle) {
          manager.enableSource(source);
        }

        // After round-trip, effective config must match the original
        const restoredEffective = manager.getEffectiveConfig();
        expect(restoredEffective).toEqual(originalEffective);
      }),
      { numRuns: 200 }
    );
  });

  it('disable then re-enable in reverse order still restores original config', () => {
    fc.assert(
      fc.property(loopConfigArb, sourceSubsetArb, (config, sourcesToToggle) => {
        const manager = new SlotConfigManager(config);

        const originalEffective = manager.getEffectiveConfig();

        // Disable sources in given order
        for (const source of sourcesToToggle) {
          manager.disableSource(source);
        }

        // Re-enable in reverse order
        const reversed = [...sourcesToToggle].reverse();
        for (const source of reversed) {
          manager.enableSource(source);
        }

        const restoredEffective = manager.getEffectiveConfig();
        expect(restoredEffective).toEqual(originalEffective);
      }),
      { numRuns: 200 }
    );
  });

  it('repeated toggle cycles always return to original state', () => {
    fc.assert(
      fc.property(
        loopConfigArb,
        toggleableSourceArb,
        fc.integer({ min: 1, max: 10 }),
        (config, sourceToToggle, cycles) => {
          const manager = new SlotConfigManager(config);

          const originalEffective = manager.getEffectiveConfig();

          // Perform multiple disable/enable cycles
          for (let i = 0; i < cycles; i++) {
            manager.disableSource(sourceToToggle);
            manager.enableSource(sourceToToggle);
          }

          // After any number of round-trip cycles, config is unchanged
          const restoredEffective = manager.getEffectiveConfig();
          expect(restoredEffective).toEqual(originalEffective);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('original config is never mutated by toggle operations', () => {
    fc.assert(
      fc.property(loopConfigArb, sourceSubsetArb, (config, sourcesToToggle) => {
        const manager = new SlotConfigManager(config);

        // Deep copy the original config for comparison
        const originalConfigSnapshot = JSON.parse(JSON.stringify(manager.getOriginalConfig()));

        // Perform toggle operations
        for (const source of sourcesToToggle) {
          manager.disableSource(source);
        }
        for (const source of sourcesToToggle) {
          manager.enableSource(source);
        }

        // Original config should never be mutated
        expect(manager.getOriginalConfig()).toEqual(originalConfigSnapshot);
      }),
      { numRuns: 200 }
    );
  });
});
