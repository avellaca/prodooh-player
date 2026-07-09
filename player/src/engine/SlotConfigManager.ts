/**
 * SlotConfigManager — Manages slot configuration with source toggle support.
 *
 * Handles disabled sources by reassigning their slots to 'playlist' (local),
 * preserving total slot count and positions of other sources.
 * Supports re-enabling a source (restores original config).
 *
 * Validates: Requirements 7.6, 10.1, 10.2, 10.3
 */

import type { LoopConfig, SlotConfig } from '../storage/types';
import type { SourceType } from '../sources/types';

/**
 * Sources configuration indicating which sources are enabled/disabled.
 * When a source is disabled, its slots are reassigned to 'playlist'.
 */
export interface SourcesEnabledConfig {
  prodooh: boolean;
  gam: boolean;
  url: boolean;
  playlist: boolean; // playlist is always effectively enabled (fallback)
}

/**
 * Computes the effective slot configuration by replacing disabled sources
 * with 'playlist'. The original config is not mutated.
 *
 * Key invariants:
 * - Total slot count is preserved (same as original)
 * - Positions of slots whose source is still enabled are unchanged
 * - Disabled source slots become 'playlist' at the same position
 * - The 'playlist' source itself cannot be disabled (always available)
 *
 * @param originalConfig - The base loop configuration (source of truth)
 * @param enabledSources - Which sources are currently enabled
 * @returns A new LoopConfig with disabled sources replaced by 'playlist'
 */
export function computeEffectiveSlots(
  originalConfig: LoopConfig,
  enabledSources: SourcesEnabledConfig
): LoopConfig {
  const effectiveSlots: SlotConfig[] = originalConfig.slots.map((slot) => {
    const sourceEnabled = isSourceEnabled(slot.source, enabledSources);
    if (sourceEnabled) {
      return { ...slot };
    }
    // Disabled source → reassign to playlist, preserving position and duration
    return {
      position: slot.position,
      source: 'playlist' as const,
      duration: slot.duration,
    };
  });

  return {
    slots: effectiveSlots,
    total_duration: originalConfig.total_duration,
    version: originalConfig.version,
    synced_at: originalConfig.synced_at,
  };
}

/**
 * Checks if a source type is enabled in the given config.
 * 'playlist' is always considered enabled (it's the fallback source).
 */
function isSourceEnabled(
  source: SourceType,
  enabledSources: SourcesEnabledConfig
): boolean {
  // Playlist is always enabled — it's the fallback
  if (source === 'playlist') return true;
  return enabledSources[source];
}

/**
 * SlotConfigManager class that maintains both the original config and the
 * effective config, supporting toggle operations.
 */
export class SlotConfigManager {
  private originalConfig: LoopConfig;
  private enabledSources: SourcesEnabledConfig;

  constructor(originalConfig: LoopConfig, enabledSources?: Partial<SourcesEnabledConfig>) {
    this.originalConfig = originalConfig;
    this.enabledSources = {
      prodooh: true,
      gam: true,
      url: true,
      playlist: true,
      ...enabledSources,
    };
  }

  /**
   * Returns the effective loop config with disabled sources replaced by 'playlist'.
   */
  getEffectiveConfig(): LoopConfig {
    return computeEffectiveSlots(this.originalConfig, this.enabledSources);
  }

  /**
   * Returns the original (unmodified) loop config.
   */
  getOriginalConfig(): LoopConfig {
    return this.originalConfig;
  }

  /**
   * Returns the current enabled/disabled state of all sources.
   */
  getEnabledSources(): SourcesEnabledConfig {
    return { ...this.enabledSources };
  }

  /**
   * Disable a source. Its slots will be reassigned to 'playlist' in the effective config.
   * Disabling 'playlist' is a no-op (playlist is always enabled).
   */
  disableSource(source: SourceType): void {
    if (source === 'playlist') return; // Cannot disable playlist
    this.enabledSources[source] = false;
  }

  /**
   * Re-enable a previously disabled source.
   * The effective config will restore the original source assignment for those slots.
   * No action needed other than reverting the enabled flag (Req 10.3).
   */
  enableSource(source: SourceType): void {
    this.enabledSources[source] = true;
  }

  /**
   * Check if a specific source is currently enabled.
   */
  isSourceEnabled(source: SourceType): boolean {
    if (source === 'playlist') return true;
    return this.enabledSources[source];
  }

  /**
   * Update the original config (e.g., from a backend sync).
   * The effective config is recomputed based on current enabled states.
   */
  updateOriginalConfig(newConfig: LoopConfig): void {
    this.originalConfig = newConfig;
  }

  /**
   * Update enabled sources in bulk (e.g., from a backend config sync).
   */
  updateEnabledSources(enabledSources: Partial<SourcesEnabledConfig>): void {
    this.enabledSources = {
      ...this.enabledSources,
      ...enabledSources,
      playlist: true, // Always force playlist enabled
    };
  }
}
