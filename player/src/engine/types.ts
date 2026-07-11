/**
 * Shared type definitions for the engine module.
 */

/**
 * Interface for checking operating hours.
 * Used by ManifestEngine and ScheduleManager.
 */
export interface ScheduleChecker {
  /** Returns true if playback should be active based on current time and schedule rules. */
  isWithinOperatingHours(): boolean;
}
