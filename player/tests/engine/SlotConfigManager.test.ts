import { describe, it, expect } from 'vitest';
import {
  SlotConfigManager,
  computeEffectiveSlots,
  type SourcesEnabledConfig,
} from '../../src/engine/SlotConfigManager';
import type { LoopConfig, SlotConfig } from '../../src/storage/types';
import type { SourceType } from '../../src/sources/types';

/**
 * Tests for SlotConfigManager — source toggle and slot reassignment.
 *
 * Validates: Requirements 7.6, 10.1, 10.2, 10.3
 */

function makeSlot(position: number, source: SourceType, duration = 10): SlotConfig {
  return { position, source, duration };
}

function makeLoopConfig(slots: SlotConfig[]): LoopConfig {
  const total_duration = slots.reduce((sum, s) => sum + s.duration, 0);
  return {
    slots,
    total_duration,
    version: 'v1',
    synced_at: '2024-01-01T00:00:00Z',
  };
}

const defaultSlots: SlotConfig[] = [
  makeSlot(0, 'prodooh'),
  makeSlot(1, 'gam'),
  makeSlot(2, 'url'),
  makeSlot(3, 'playlist'),
];

const allEnabled: SourcesEnabledConfig = {
  prodooh: true,
  gam: true,
  url: true,
  playlist: true,
};

describe('computeEffectiveSlots', () => {
  it('returns identical config when all sources are enabled', () => {
    const config = makeLoopConfig(defaultSlots);
    const effective = computeEffectiveSlots(config, allEnabled);

    expect(effective.slots).toEqual(config.slots);
    expect(effective.total_duration).toBe(config.total_duration);
    expect(effective.version).toBe(config.version);
  });

  it('reassigns disabled source slots to playlist (Req 7.6, 10.2)', () => {
    const config = makeLoopConfig(defaultSlots);
    const enabled: SourcesEnabledConfig = { ...allEnabled, prodooh: false };

    const effective = computeEffectiveSlots(config, enabled);

    expect(effective.slots[0]!.source).toBe('playlist');
    expect(effective.slots[0]!.position).toBe(0);
    expect(effective.slots[0]!.duration).toBe(10);
    // Other slots unchanged
    expect(effective.slots[1]!.source).toBe('gam');
    expect(effective.slots[2]!.source).toBe('url');
    expect(effective.slots[3]!.source).toBe('playlist');
  });

  it('preserves total slot count when source is disabled (Req 10.2)', () => {
    const config = makeLoopConfig(defaultSlots);
    const enabled: SourcesEnabledConfig = { ...allEnabled, gam: false, url: false };

    const effective = computeEffectiveSlots(config, enabled);

    expect(effective.slots.length).toBe(config.slots.length);
    expect(effective.total_duration).toBe(config.total_duration);
  });

  it('disabling multiple sources reassigns all their slots to playlist', () => {
    const config = makeLoopConfig(defaultSlots);
    const enabled: SourcesEnabledConfig = {
      prodooh: false,
      gam: false,
      url: false,
      playlist: true,
    };

    const effective = computeEffectiveSlots(config, enabled);

    // All slots should now be playlist
    for (const slot of effective.slots) {
      expect(slot.source).toBe('playlist');
    }
  });

  it('does not mutate the original config', () => {
    const config = makeLoopConfig(defaultSlots);
    const originalSlotsCopy = config.slots.map((s) => ({ ...s }));
    const enabled: SourcesEnabledConfig = { ...allEnabled, prodooh: false };

    computeEffectiveSlots(config, enabled);

    expect(config.slots).toEqual(originalSlotsCopy);
  });

  it('preserves slot positions even when source is disabled', () => {
    const slots: SlotConfig[] = [
      makeSlot(0, 'prodooh', 5),
      makeSlot(1, 'prodooh', 5),
      makeSlot(2, 'gam', 10),
      makeSlot(3, 'playlist', 10),
    ];
    const config = makeLoopConfig(slots);
    const enabled: SourcesEnabledConfig = { ...allEnabled, prodooh: false };

    const effective = computeEffectiveSlots(config, enabled);

    expect(effective.slots[0]).toEqual({ position: 0, source: 'playlist', duration: 5 });
    expect(effective.slots[1]).toEqual({ position: 1, source: 'playlist', duration: 5 });
    expect(effective.slots[2]).toEqual({ position: 2, source: 'gam', duration: 10 });
    expect(effective.slots[3]).toEqual({ position: 3, source: 'playlist', duration: 10 });
  });

  it('playlist source cannot be disabled', () => {
    const config = makeLoopConfig(defaultSlots);
    // Even if playlist is marked as false, it should still be treated as enabled
    const enabled: SourcesEnabledConfig = {
      prodooh: true,
      gam: true,
      url: true,
      playlist: false, // This should have no effect
    };

    const effective = computeEffectiveSlots(config, enabled);

    // Playlist slots remain as playlist
    expect(effective.slots[3]!.source).toBe('playlist');
  });
});

describe('SlotConfigManager', () => {
  it('initializes with all sources enabled by default', () => {
    const config = makeLoopConfig(defaultSlots);
    const manager = new SlotConfigManager(config);

    const enabled = manager.getEnabledSources();
    expect(enabled.prodooh).toBe(true);
    expect(enabled.gam).toBe(true);
    expect(enabled.url).toBe(true);
    expect(enabled.playlist).toBe(true);
  });

  it('initializes with provided enabled sources', () => {
    const config = makeLoopConfig(defaultSlots);
    const manager = new SlotConfigManager(config, { prodooh: false });

    expect(manager.isSourceEnabled('prodooh')).toBe(false);
    expect(manager.isSourceEnabled('gam')).toBe(true);
  });

  it('getEffectiveConfig reflects disabled sources', () => {
    const config = makeLoopConfig(defaultSlots);
    const manager = new SlotConfigManager(config);

    manager.disableSource('gam');

    const effective = manager.getEffectiveConfig();
    expect(effective.slots[1]!.source).toBe('playlist');
    // Others unchanged
    expect(effective.slots[0]!.source).toBe('prodooh');
    expect(effective.slots[2]!.source).toBe('url');
  });

  it('disableSource is a no-op for playlist', () => {
    const config = makeLoopConfig(defaultSlots);
    const manager = new SlotConfigManager(config);

    manager.disableSource('playlist');

    expect(manager.isSourceEnabled('playlist')).toBe(true);
    const effective = manager.getEffectiveConfig();
    expect(effective.slots[3]!.source).toBe('playlist');
  });

  it('enableSource restores original assignment (Req 10.3)', () => {
    const config = makeLoopConfig(defaultSlots);
    const manager = new SlotConfigManager(config);

    // Disable then re-enable
    manager.disableSource('prodooh');
    expect(manager.getEffectiveConfig().slots[0]!.source).toBe('playlist');

    manager.enableSource('prodooh');
    const restored = manager.getEffectiveConfig();
    expect(restored.slots[0]!.source).toBe('prodooh');
    expect(restored).toEqual(config);
  });

  it('getOriginalConfig always returns the unmodified config', () => {
    const config = makeLoopConfig(defaultSlots);
    const manager = new SlotConfigManager(config);

    manager.disableSource('gam');
    manager.disableSource('url');

    expect(manager.getOriginalConfig()).toEqual(config);
  });

  it('updateOriginalConfig replaces the base config', () => {
    const config = makeLoopConfig(defaultSlots);
    const manager = new SlotConfigManager(config);

    const newSlots: SlotConfig[] = [
      makeSlot(0, 'prodooh', 15),
      makeSlot(1, 'playlist', 15),
    ];
    const newConfig = makeLoopConfig(newSlots);
    manager.updateOriginalConfig(newConfig);

    expect(manager.getOriginalConfig()).toEqual(newConfig);
    expect(manager.getEffectiveConfig().slots.length).toBe(2);
  });

  it('updateEnabledSources allows bulk updates', () => {
    const config = makeLoopConfig(defaultSlots);
    const manager = new SlotConfigManager(config);

    manager.updateEnabledSources({ prodooh: false, gam: false });

    expect(manager.isSourceEnabled('prodooh')).toBe(false);
    expect(manager.isSourceEnabled('gam')).toBe(false);
    expect(manager.isSourceEnabled('url')).toBe(true);
    expect(manager.isSourceEnabled('playlist')).toBe(true); // Always true
  });

  it('updateEnabledSources always forces playlist to true', () => {
    const config = makeLoopConfig(defaultSlots);
    const manager = new SlotConfigManager(config);

    manager.updateEnabledSources({ playlist: false });

    expect(manager.isSourceEnabled('playlist')).toBe(true);
  });

  it('multiple toggle cycles produce correct effective config (round-trip)', () => {
    const config = makeLoopConfig(defaultSlots);
    const manager = new SlotConfigManager(config);

    // Disable all non-playlist sources
    manager.disableSource('prodooh');
    manager.disableSource('gam');
    manager.disableSource('url');

    const allPlaylist = manager.getEffectiveConfig();
    for (const slot of allPlaylist.slots) {
      expect(slot.source).toBe('playlist');
    }

    // Re-enable all
    manager.enableSource('prodooh');
    manager.enableSource('gam');
    manager.enableSource('url');

    const restored = manager.getEffectiveConfig();
    expect(restored).toEqual(config);
  });

  it('handles config with many slots from same source', () => {
    const slots: SlotConfig[] = [
      makeSlot(0, 'prodooh', 5),
      makeSlot(1, 'prodooh', 5),
      makeSlot(2, 'prodooh', 5),
      makeSlot(3, 'gam', 5),
      makeSlot(4, 'gam', 5),
      makeSlot(5, 'playlist', 5),
    ];
    const config = makeLoopConfig(slots);
    const manager = new SlotConfigManager(config);

    manager.disableSource('prodooh');

    const effective = manager.getEffectiveConfig();
    expect(effective.slots.length).toBe(6);
    expect(effective.slots[0]!.source).toBe('playlist');
    expect(effective.slots[1]!.source).toBe('playlist');
    expect(effective.slots[2]!.source).toBe('playlist');
    expect(effective.slots[3]!.source).toBe('gam');
    expect(effective.slots[4]!.source).toBe('gam');
    expect(effective.slots[5]!.source).toBe('playlist');
  });
});
