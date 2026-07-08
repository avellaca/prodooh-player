/**
 * Content source types and shared playback types.
 */

/** Available content source types in the loop */
export type SourceType = 'prodooh' | 'gam' | 'url' | 'playlist';

/** Content media types supported by the player */
export type ContentMediaType = 'image' | 'video' | 'url' | 'html';

/** Display orientation */
export type Orientation = 'landscape' | 'portrait';

/** Transition animation type */
export type TransitionType = 'cut' | 'fade' | 'slide';

/** Rotation angles supported for content */
export type RotationAngle = 0 | 90 | 180 | 270;

/** A single slot in the playback loop */
export interface SlotConfig {
  position: number;
  source: SourceType;
  duration: number; // seconds
}

/** Full loop configuration for a screen */
export interface LoopConfig {
  slots: SlotConfig[];
  total_duration: number; // seconds (sum of all slot durations)
}

/** Prepared content ready for display */
export interface PreparedContent {
  id: string;
  type: ContentMediaType;
  mediaUrl: string;
  duration: number; // seconds, resolved from hierarchy
  metadata: Record<string, unknown>;
}

/** Device display configuration */
export interface DisplayConfig {
  resolution: { width: number; height: number };
  orientation: Orientation;
  transition: { type: TransitionType; duration_ms: number };
}

/** Schedule rule for operating hours */
export interface ScheduleRule {
  days: number[]; // 0=Sunday, 6=Saturday
  start: string; // HH:mm
  end: string; // HH:mm
}

/** Schedule configuration */
export interface ScheduleConfig {
  timezone: string;
  rules: ScheduleRule[];
}
