/**
 * ImpressionReporter — Queues completed order_line_creative impressions locally
 * (SQLite) and batch-flushes them to the backend with exponential backoff.
 *
 * Only impressions of type `order_line_creative` are enqueued; playlist and SSP
 * items are ignored since they track their own metrics externally.
 *
 * Validates: Requirements 9.1, 9.3, 9.6
 */

import Database from 'better-sqlite3';
import { BackendApiClient } from '../api/BackendApiClient';
import { JwtRenewer } from '../api/JwtRenewer';

export interface ImpressionRecord {
  order_line_id: string;
  creative_id: string;
  started_at: string; // ISO 8601
  ended_at: string;
  duration_seconds: number;
  result: 'success' | 'failed';
  failure_reason?: string;
  /** When set to 'witness', this impression does NOT count against target_spots */
  mode?: 'normal' | 'witness';
}

/** Internal row shape stored in SQLite */
interface PendingImpressionRow {
  id: number;
  payload: string;
  created_at: string;
}

export class ImpressionReporter {
  private client: BackendApiClient;
  private db: Database.Database;
  private jwtRenewer: JwtRenewer;

  /** Exponential backoff state */
  private backoffMs: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  /** Periodic flush timer */
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    client: BackendApiClient,
    db: Database.Database,
    jwtRenewer: JwtRenewer,
    options?: { baseBackoffMs?: number; maxBackoffMs?: number },
  ) {
    this.client = client;
    this.db = db;
    this.jwtRenewer = jwtRenewer;
    this.baseBackoffMs = options?.baseBackoffMs ?? 5000;
    this.maxBackoffMs = options?.maxBackoffMs ?? 300_000; // 5 minutes
    this.backoffMs = this.baseBackoffMs;

    this.ensureTable();
  }

  /**
   * Creates the pending_impressions table if it does not exist.
   */
  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pending_impressions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payload JSON NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  /**
   * Enqueue an impression for later flush.
   * Only order_line_creative impressions should be enqueued.
   */
  enqueue(impression: ImpressionRecord): void {
    const payload = JSON.stringify(impression);
    this.db
      .prepare('INSERT INTO pending_impressions (payload, created_at) VALUES (?, datetime(\'now\'))')
      .run(payload);
  }

  /**
   * Flush all pending impressions to the backend.
   * On success (201): deletes sent rows and resets backoff.
   * On failure: increments backoff exponentially.
   */
  async flush(): Promise<void> {
    const rows = this.db
      .prepare('SELECT id, payload, created_at FROM pending_impressions ORDER BY id ASC')
      .all() as PendingImpressionRow[];

    if (rows.length === 0) return;

    const impressions = rows.map((row) => JSON.parse(row.payload) as ImpressionRecord);
    const ids = rows.map((row) => row.id);

    const response = await this.jwtRenewer.withAutoRenewal(() =>
      this.client.post('/api/device/impressions', { impressions }),
    );

    if (response.ok && response.status === 201) {
      // Success — delete sent rows and reset backoff
      const placeholders = ids.map(() => '?').join(', ');
      this.db.prepare(`DELETE FROM pending_impressions WHERE id IN (${placeholders})`).run(...ids);
      this.backoffMs = this.baseBackoffMs;
    } else {
      // Failure — increase backoff
      this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    }
  }

  /**
   * Start periodic flush at the given interval.
   */
  startPeriodicFlush(intervalMs: number): void {
    if (this.flushTimer) return; // Already running
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, intervalMs);
  }

  /**
   * Stop periodic flush.
   */
  stopPeriodicFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Get the current backoff delay in ms (useful for testing).
   */
  getBackoffMs(): number {
    return this.backoffMs;
  }

  /**
   * Get the count of pending (unsent) impressions.
   */
  getPendingCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM pending_impressions')
      .get() as { count: number };
    return row.count;
  }
}
