/**
 * PlaybackLogger — Records every play event locally (SQLite) and batch syncs
 * to the backend periodically. Local-first: persists to SQLite before any
 * network attempt. Entries are only marked synced after backend acknowledgment.
 *
 * Validates: Requirements 18.1, 18.2, 18.5
 */

import Database from 'better-sqlite3';

export type SourceType = 'prodooh' | 'gam' | 'url' | 'playlist';
export type PlaybackResult = 'success' | 'failed';

/** Input for recording a playback event */
export interface PlaybackEvent {
  contentId: string;
  source: SourceType;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  result: PlaybackResult;
  failureReason?: string;
}

/** A persisted playback log entry (as stored in SQLite) */
export interface PlaybackLogRow {
  id: string;
  content_id: string;
  source: SourceType;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  result: PlaybackResult;
  failure_reason: string | null;
  synced: number; // 0 or 1
}

/** Shape of the backend response for playback log sync */
export interface PlaybackLogsResponse {
  received: number;
  ack_ids: string[];
}

/** Interface for the HTTP client used to sync logs */
export interface PlaybackLogSyncClient {
  post<T>(path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T | null }>;
}

/**
 * Generates a UUID v4 string using crypto.randomUUID when available,
 * with a fallback for environments that don't support it.
 */
function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: manual UUID v4 generation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class PlaybackLogger {
  private db: Database.Database;
  private client: PlaybackLogSyncClient | null;
  private syncIntervalMs: number;
  private batchSize: number;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    db: Database.Database,
    client: PlaybackLogSyncClient | null = null,
    options?: { syncIntervalMs?: number; batchSize?: number }
  ) {
    this.db = db;
    this.client = client;
    this.syncIntervalMs = options?.syncIntervalMs ?? 60_000; // Default: 1 minute
    this.batchSize = options?.batchSize ?? 50;
  }

  /**
   * Record a playback event. Persists to SQLite immediately (local-first).
   * Returns the generated log entry ID.
   */
  record(event: PlaybackEvent): string {
    const id = generateId();

    this.db
      .prepare(
        `INSERT INTO playback_log (id, content_id, source, started_at, ended_at, duration_seconds, result, failure_reason, synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
      )
      .run(
        id,
        event.contentId,
        event.source,
        event.startedAt.toISOString(),
        event.endedAt.toISOString(),
        event.durationSeconds,
        event.result,
        event.failureReason ?? null
      );

    return id;
  }

  /**
   * Get all unsynced log entries (up to batchSize).
   */
  getUnsynced(limit?: number): PlaybackLogRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM playback_log WHERE synced = 0 ORDER BY started_at ASC LIMIT ?`
      )
      .all(limit ?? this.batchSize) as PlaybackLogRow[];

    return rows;
  }

  /**
   * Get the count of unsynced entries.
   */
  getUnsyncedCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM playback_log WHERE synced = 0')
      .get() as { count: number };
    return row.count;
  }

  /**
   * Get the total count of all entries.
   */
  getTotalCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM playback_log')
      .get() as { count: number };
    return row.count;
  }

  /**
   * Mark specific entries as synced by their IDs.
   * Only marks entries whose IDs are in the ack_ids list from the backend.
   */
  markSynced(ids: string[]): void {
    if (ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(', ');
    this.db
      .prepare(`UPDATE playback_log SET synced = 1 WHERE id IN (${placeholders})`)
      .run(...ids);
  }

  /**
   * Batch sync unsynced entries to the backend.
   * Returns the number of entries successfully acknowledged, or -1 on failure.
   *
   * Flow:
   * 1. Read unsynced entries from SQLite
   * 2. POST batch to backend
   * 3. Mark only acknowledged entries as synced
   */
  async sync(): Promise<number> {
    if (!this.client) return -1;

    const unsynced = this.getUnsynced();
    if (unsynced.length === 0) return 0;

    // Build the request payload matching the API contract
    const logs = unsynced.map((row) => ({
      id: row.id,
      content_id: row.content_id,
      source: row.source,
      started_at: row.started_at,
      ended_at: row.ended_at,
      duration_seconds: row.duration_seconds,
      result: row.result,
      ...(row.failure_reason ? { failure_reason: row.failure_reason } : {}),
    }));

    try {
      const response = await this.client.post<PlaybackLogsResponse>(
        '/api/device/playback-logs',
        { logs }
      );

      if (!response.ok || !response.data) {
        return -1;
      }

      // Only mark entries as synced that the backend explicitly acknowledged
      const { ack_ids } = response.data;
      if (ack_ids && ack_ids.length > 0) {
        this.markSynced(ack_ids);
      }

      return ack_ids?.length ?? 0;
    } catch {
      // Network error — entries remain unsynced, will retry on next sync
      return -1;
    }
  }

  /**
   * Start periodic background sync.
   */
  startPeriodicSync(): void {
    if (this.syncTimer) return; // Already running
    this.syncTimer = setInterval(() => {
      void this.sync();
    }, this.syncIntervalMs);
  }

  /**
   * Stop periodic background sync.
   */
  stopPeriodicSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * Check if periodic sync is currently active.
   */
  isSyncing(): boolean {
    return this.syncTimer !== null;
  }
}
