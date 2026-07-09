/**
 * PlaylistSource — Content source that cycles through local playlist items.
 *
 * Reads playlist items from the SQLite local store (playlist_items table),
 * ordered by position, and cycles sequentially (wrapping at end).
 * Supports image, video, and URL item types.
 *
 * Validates: Requirements 4.1, 4.2, 28.1, 28.3
 */

import Database from 'better-sqlite3';
import type { ContentSource, PreparedContent, SourceType } from './types';

/** Row shape returned from playlist_items table */
interface PlaylistItemRow {
  id: string;
  playlist_id: string;
  type: 'image' | 'video' | 'url';
  media_path: string | null;
  url: string | null;
  duration_seconds: number | null;
  position: number;
  rotation: number | null;
  refresh_interval: number | null;
  checksum: string | null;
  download_status: string | null;
}

/** Default display duration in seconds when not specified per item */
const DEFAULT_DURATION_SECONDS = 10;

export class PlaylistSource implements ContentSource {
  readonly id: SourceType = 'playlist';

  private db: Database.Database;
  private currentIndex: number = 0;

  /**
   * @param db - An open better-sqlite3 Database instance (with schema initialized)
   */
  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Pre-fetch the next playlist item. Returns PreparedContent or null if no items exist.
   * Advances the internal index each call, wrapping to 0 after the last item.
   */
  async prefetch(): Promise<PreparedContent | null> {
    const items = this.getReadyItems();

    if (items.length === 0) {
      return null;
    }

    // Wrap index if needed
    if (this.currentIndex >= items.length) {
      this.currentIndex = 0;
    }

    const item = items[this.currentIndex]!;
    this.currentIndex = (this.currentIndex + 1) % items.length;

    return this.toPreparedContent(item);
  }

  /**
   * Confirm content was played. No-op for playlist source.
   */
  async confirmPlay(_content: PreparedContent): Promise<void> {
    // No-op: playlist items don't require confirmation
  }

  /**
   * Report a failure playing the content. Logs the error and the index
   * has already been advanced by prefetch, so next call will get the next item.
   */
  async reportFailure(content: PreparedContent, reason: string): Promise<void> {
    console.error(
      `[PlaylistSource] Failed to play item ${content.id}: ${reason}`
    );
  }

  /**
   * Returns true if at least one playlist item exists and is ready for playback.
   */
  isAvailable(): boolean {
    const items = this.getReadyItems();
    return items.length > 0;
  }

  /**
   * Query all ready playlist items sorted by position.
   * Only items with download_status = 'ready' or URL items are considered playable.
   * Uses JS filtering for browser shim compatibility (shim has limited SQL WHERE support).
   */
  private getReadyItems(): PlaylistItemRow[] {
    const stmt = this.db.prepare(`
      SELECT id, playlist_id, type, media_path, url, duration_seconds,
             position, rotation, refresh_interval, checksum, download_status
      FROM playlist_items
      ORDER BY position ASC
    `);

    const allItems = stmt.all() as PlaylistItemRow[];

    // Filter in JS for browser shim compatibility (OR conditions not fully supported)
    return allItems.filter(
      (item) => item.download_status === 'ready' || item.type === 'url'
    );
  }

  /**
   * Convert a database row into PreparedContent.
   */
  private toPreparedContent(item: PlaylistItemRow): PreparedContent {
    const mediaUrl = item.type === 'url'
      ? (item.url ?? '')
      : (item.media_path ?? '');

    const contentType = item.type === 'url' ? 'url' : item.type;

    return {
      id: item.id,
      type: contentType,
      source: 'playlist',
      mediaUrl,
      duration: item.duration_seconds ?? DEFAULT_DURATION_SECONDS,
      metadata: {
        playlist_id: item.playlist_id,
        position: item.position,
        rotation: item.rotation ?? 0,
        refresh_interval: item.refresh_interval ?? null,
      },
    };
  }
}
