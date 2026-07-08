/**
 * Content source types and interfaces for the player loop engine.
 * All content sources implement the ContentSource interface to provide
 * a uniform "give me the next content" / "confirm or invalidate" contract.
 *
 * Validates: Requirements 7.4
 */

/** Available content source types in the loop */
export type SourceType = 'prodooh' | 'gam' | 'url' | 'playlist';

/** Content media types supported by the player */
export type ContentType = 'image' | 'video' | 'url' | 'html';

/** Content that has been fetched and is ready for display */
export interface PreparedContent {
  /** Unique identifier for this content piece (e.g. print_id, playlist item id) */
  id: string;
  /** The media type of the content */
  type: ContentType;
  /** Which source produced this content */
  source: SourceType;
  /** URL or local path to the media resource */
  mediaUrl: string;
  /** Display duration in seconds */
  duration: number;
  /** Source-specific metadata (e.g. print_id, campaign_id, vast info) */
  metadata: Record<string, unknown>;
  /** Pre-rendered DOM element for instant swap (image, video, iframe) */
  element?: HTMLElement;
}

/**
 * Uniform interface that all content sources must implement.
 * The loop engine treats every source identically through this contract.
 */
export interface ContentSource {
  /** Identifies which source type this is */
  readonly id: SourceType;

  /** Pre-fetch next content for this source. Returns null if unavailable. */
  prefetch(): Promise<PreparedContent | null>;

  /** Confirm the content was played successfully */
  confirmPlay(content: PreparedContent): Promise<void>;

  /** Notify that content could not be played */
  reportFailure(content: PreparedContent, reason: string): Promise<void>;

  /** Check if source is enabled and configured */
  isAvailable(): boolean;
}
