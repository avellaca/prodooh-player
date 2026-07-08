/**
 * Types used by the local storage layer.
 * These mirror the contract types but include storage-specific fields.
 */

/** A single slot in the playback loop */
export interface SlotConfig {
  position: number;
  source: 'prodooh' | 'gam' | 'url' | 'playlist';
  duration: number; // seconds
}

/** Full loop configuration persisted locally */
export interface LoopConfig {
  slots: SlotConfig[];
  total_duration: number;
  version: string;
  synced_at?: string;
}

/** Schedule rule for operating hours */
export interface ScheduleRule {
  days: number[]; // 0=Sunday, 6=Saturday
  start: string; // HH:mm
  end: string; // HH:mm
}

/** Schedule configuration persisted locally */
export interface ScheduleConfig {
  timezone: string;
  rules: ScheduleRule[];
  synced_at?: string;
}
