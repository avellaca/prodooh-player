/**
 * POPQueue — Persistent queue for Proof of Play and expiration notifications.
 *
 * Uses SQLite (better-sqlite3) to persist notifications that must be delivered
 * to the Prodooh Ad Serving API. Implements exponential backoff on failures
 * and never discards undelivered notifications.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export type POPAction = 'proof_of_play' | 'expiration';

export interface POPQueueEntry {
  id: string;
  print_id: string;
  action: POPAction;
  url: string;
  created_at: string;
  attempts: number;
  next_retry_at: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
}

export class POPQueue {
  private db: Database.Database;
  private maxBackoff = 60_000; // 60 seconds max

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Enqueue a proof_of_play or expiration notification for delivery.
   * Inserts with status='pending', attempts=0, next_retry_at=now.
   */
  enqueue(printId: string, action: POPAction, url: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO pop_queue (id, print_id, action, url, created_at, attempts, next_retry_at, status)
         VALUES (?, ?, ?, ?, ?, 0, ?, 'pending')`
      )
      .run(randomUUID(), printId, action, url, now, now);
  }

  /**
   * Process all pending queue entries whose next_retry_at <= now.
   * For each entry:
   * - On HTTP 201 or 409: mark as 'sent'
   * - On error: increment attempts, calculate next_retry_at with exponential backoff
   * Never discards undelivered notifications.
   */
  async processQueue(): Promise<void> {
    const now = new Date().toISOString();
    const pending = this.db
      .prepare(
        `SELECT * FROM pop_queue WHERE status = 'pending' AND next_retry_at <= ? ORDER BY created_at`
      )
      .all(now) as POPQueueEntry[];

    for (const item of pending) {
      try {
        // Mark as sending
        this.db
          .prepare(`UPDATE pop_queue SET status = 'sending' WHERE id = ?`)
          .run(item.id);

        const response = await fetch(item.url, { method: 'GET' });

        if (response.status === 201 || response.status === 409) {
          // Success: 201 = confirmed, 409 = already processed (idempotent)
          this.db
            .prepare(`UPDATE pop_queue SET status = 'sent' WHERE id = ?`)
            .run(item.id);
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch {
        // On any error, schedule retry with exponential backoff
        const nextAttempts = item.attempts + 1;
        const backoff = this.calculateBackoff(nextAttempts);
        const nextRetry = new Date(Date.now() + backoff).toISOString();

        this.db
          .prepare(
            `UPDATE pop_queue SET status = 'pending', attempts = ?, next_retry_at = ? WHERE id = ?`
          )
          .run(nextAttempts, nextRetry, item.id);
      }
    }
  }

  /**
   * Returns the count of pending (undelivered) items in the queue.
   */
  getPendingCount(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) as count FROM pop_queue WHERE status = 'pending'`)
      .get() as { count: number };
    return row.count;
  }

  /**
   * Returns the count of successfully sent items in the queue.
   */
  getSentCount(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) as count FROM pop_queue WHERE status = 'sent'`)
      .get() as { count: number };
    return row.count;
  }

  /**
   * Calculate exponential backoff delay in milliseconds.
   * Formula: min(2^attempts * 1000, 60000)
   */
  private calculateBackoff(attempts: number): number {
    return Math.min(Math.pow(2, attempts) * 1000, this.maxBackoff);
  }
}
