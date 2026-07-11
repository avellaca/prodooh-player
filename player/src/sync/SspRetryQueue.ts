/**
 * SspRetryQueue — Persists failed SSP calls (proof_of_play, expiration) in SQLite
 * and retries them with exponential backoff until success or permanent error (4xx).
 *
 * Reutiliza la misma base de datos SQLite que ImpressionReporter, en una tabla separada.
 *
 * Validates: Requirements 1.3, 2.1, 2.2
 */

import Database from 'better-sqlite3';
import { SspClient } from '../engine/SspPrefetcher';

/**
 * Classify an HTTP error status code as transient or permanent.
 * - 5xx → transient (server error, may resolve with time)
 * - 4xx → permanent (client error, won't resolve with retries)
 */
export function classifyHttpError(statusCode: number): 'transient' | 'permanent' {
  if (statusCode >= 500) return 'transient';
  if (statusCode >= 400) return 'permanent';
  // 2xx/3xx shouldn't be errors; default to transient to be safe
  return 'transient';
}

/**
 * Determine if an error is transient (network, timeout, etc.)
 * Non-HTTP errors (network failures, timeouts) are always transient.
 */
export function isTransientError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const statusCode = (error as { statusCode: number }).statusCode;
    return classifyHttpError(statusCode) === 'transient';
  }
  // Network errors, timeouts, DNS failures — all transient
  return true;
}

/** Types of SSP operations that can be retried */
export type SspOperationType = 'proof_of_play' | 'expiration';

/** Configuration for SspRetryQueue */
export interface SspRetryQueueOptions {
  /** Base backoff interval in ms (default: 1000) */
  baseBackoffMs?: number;
  /** Maximum backoff interval in ms (default: 60000) */
  maxBackoffMs?: number;
  /** Interval for periodic flush in ms (default: 5000) */
  flushIntervalMs?: number;
}

/** Row shape stored in SQLite */
export interface SspRetryRow {
  id: number;
  print_id: string;
  operation_type: SspOperationType;
  url: string;
  created_at: string;       // ISO 8601 — timestamp del intento original
  last_attempt_at: string;  // ISO 8601 — timestamp del último intento
  attempts: number;
}

/** Result of an SSP call attempt */
export interface SspCallResult {
  success: boolean;
  permanent: boolean;  // true if 4xx (should not retry)
  statusCode?: number;
}

export class SspRetryQueue {
  private db: Database.Database;
  private sspClient: SspClient;
  private baseBackoffMs: number;
  private maxBackoffMs: number;
  private flushIntervalMs: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(db: Database.Database, sspClient: SspClient, options?: SspRetryQueueOptions) {
    this.db = db;
    this.sspClient = sspClient;
    this.baseBackoffMs = options?.baseBackoffMs ?? 1000;
    this.maxBackoffMs = options?.maxBackoffMs ?? 60_000;
    this.flushIntervalMs = options?.flushIntervalMs ?? 5000;

    this.ensureTable();
  }

  /**
   * Creates the ssp_retry_queue table and index if they do not exist.
   */
  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ssp_retry_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        print_id TEXT NOT NULL,
        operation_type TEXT NOT NULL CHECK (operation_type IN ('proof_of_play', 'expiration')),
        url TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
        attempts INTEGER NOT NULL DEFAULT 1
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ssp_retry_queue_created_at
        ON ssp_retry_queue(created_at ASC)
    `);
  }

  /**
   * Get count of pending entries in the retry queue.
   * Useful for testing and diagnostics.
   */
  getPendingCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM ssp_retry_queue')
      .get() as { count: number };
    return row.count;
  }

  /**
   * Calculate backoff delay in ms for a given attempt count.
   * Formula: min(2^(attempts-1) × baseBackoffMs, maxBackoffMs)
   */
  calculateBackoffMs(attempts: number): number {
    const delay = Math.pow(2, attempts - 1) * this.baseBackoffMs;
    return Math.min(delay, this.maxBackoffMs);
  }

  /**
   * Attempt a proof_of_play call. If it fails transiently, enqueue for retry.
   * If it fails permanently (4xx), discard silently.
   */
  async proofOfPlay(printId: string, popUrl: string): Promise<void> {
    try {
      await this.sspClient.proofOfPlay(printId);
    } catch (error: unknown) {
      const errorType = this.classifyError(error);
      if (errorType === 'transient') {
        this.enqueue(printId, 'proof_of_play', popUrl);
      }
      // permanent errors are silently discarded
    }
  }

  /**
   * Attempt an expiration call. If it fails transiently, enqueue for retry.
   * If it fails permanently (4xx), discard silently.
   */
  async expire(printId: string, expireUrl: string): Promise<void> {
    try {
      await this.sspClient.expireAd(printId);
    } catch (error: unknown) {
      const errorType = this.classifyError(error);
      if (errorType === 'transient') {
        this.enqueue(printId, 'expiration', expireUrl);
      }
      // permanent errors are silently discarded
    }
  }

  /**
   * Classify an HTTP status code as transient or permanent error.
   * 4xx → permanent (won't resolve with retries)
   * 5xx → transient (server may recover)
   * Other → transient (safety default)
   */
  private classifyHttpError(statusCode: number): 'transient' | 'permanent' {
    if (statusCode >= 500) return 'transient';
    if (statusCode >= 400) return 'permanent';
    return 'transient';
  }

  /**
   * Classify a thrown error as transient or permanent.
   * If the error has a statusCode property, uses classifyHttpError.
   * Network errors (no statusCode) are treated as transient.
   */
  private classifyError(error: unknown): 'transient' | 'permanent' {
    if (
      error !== null &&
      typeof error === 'object' &&
      'statusCode' in error &&
      typeof (error as { statusCode: unknown }).statusCode === 'number'
    ) {
      return this.classifyHttpError((error as { statusCode: number }).statusCode);
    }
    // Network errors, timeouts, DNS failures — all transient
    return 'transient';
  }

  /**
   * Insert a failed operation into the retry queue.
   */
  private enqueue(printId: string, operationType: SspOperationType, url: string): void {
    this.db.prepare(`
      INSERT INTO ssp_retry_queue (print_id, operation_type, url, created_at, last_attempt_at, attempts)
      VALUES (?, ?, ?, datetime('now'), datetime('now'), 1)
    `).run(printId, operationType, url);
  }

  /**
   * Process all pending entries whose backoff has elapsed.
   * Processes in FIFO order (created_at ASC).
   * For each entry:
   *   - If backoff has NOT elapsed → skip
   *   - If backoff elapsed → execute call:
   *     - On success → DELETE entry
   *     - On transient error → UPDATE attempts + 1, last_attempt_at = now
   *     - On permanent error (4xx) → DELETE entry
   */
  async flush(): Promise<void> {
    const rows = this.db
      .prepare('SELECT * FROM ssp_retry_queue ORDER BY created_at ASC')
      .all() as SspRetryRow[];

    const now = Date.now();

    for (const row of rows) {
      // Calculate backoff and check if elapsed
      const backoffMs = this.calculateBackoffMs(row.attempts);
      const lastAttemptTime = new Date(row.last_attempt_at + 'Z').getTime();

      if (now - lastAttemptTime < backoffMs) {
        // Backoff not yet elapsed — skip this entry
        continue;
      }

      try {
        // Execute the call based on operation_type
        if (row.operation_type === 'proof_of_play') {
          await this.sspClient.proofOfPlay(row.print_id);
        } else {
          await this.sspClient.expireAd(row.print_id);
        }

        // Success → DELETE entry from queue
        this.db
          .prepare('DELETE FROM ssp_retry_queue WHERE id = ?')
          .run(row.id);
      } catch (error: unknown) {
        const errorType = this.classifyError(error);
        if (errorType === 'permanent') {
          // Permanent error (4xx) → DELETE entry
          this.db
            .prepare('DELETE FROM ssp_retry_queue WHERE id = ?')
            .run(row.id);
        } else {
          // Transient error (5xx / network) → increment attempts, update last_attempt_at
          this.db
            .prepare(
              "UPDATE ssp_retry_queue SET attempts = attempts + 1, last_attempt_at = datetime('now') WHERE id = ?"
            )
            .run(row.id);
        }
      }
    }
  }

  /**
   * Start periodic flush at the configured interval.
   */
  startPeriodicFlush(intervalMs?: number): void {
    if (this.flushTimer) return; // Already running
    const interval = intervalMs ?? this.flushIntervalMs;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, interval);
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
}
