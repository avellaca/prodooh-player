/**
 * Property-based test: Exponential Backoff Calculation
 *
 * Generates random failure counts and verifies that the calculated backoff delay
 * matches the formula min(2^N * 1000, 60000), is capped at 60000ms, and items
 * are never discarded from the queue.
 *
 * **Validates: Requirements 5.4**
 *
 * Requirement 5.4: If a notification can't be delivered due to network issues,
 * queue locally and retry with exponential backoff (1s → 2s → 4s → ... → 60s max)
 * until delivered. Never discard undelivered notifications.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import Database from 'better-sqlite3';
import { POPQueue } from '../../src/queue/POPQueue';
import type { POPQueueEntry } from '../../src/queue/POPQueue';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS pop_queue (
      id TEXT PRIMARY KEY,
      print_id TEXT NOT NULL,
      action TEXT CHECK(action IN ('proof_of_play', 'expiration')),
      url TEXT NOT NULL,
      created_at TEXT,
      attempts INTEGER DEFAULT 0,
      next_retry_at TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sending', 'sent', 'failed'))
    );
  `);
  return db;
}

describe('Property 8: Exponential Backoff Calculation', () => {
  let db: Database.Database;
  let queue: POPQueue;

  beforeEach(() => {
    db = createTestDb();
    queue = new POPQueue(db);
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('backoff delay equals min(2^attempts * 1000, 60000) for any failure count', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 20 }),
        async (previousAttempts) => {
          // Reset DB for each run
          db.exec('DELETE FROM pop_queue');
          vi.setSystemTime(1_700_000_000_000);

          // Insert an entry with the given number of previous attempts
          const now = new Date().toISOString();
          db.prepare(
            `INSERT INTO pop_queue (id, print_id, action, url, created_at, attempts, next_retry_at, status)
             VALUES ('test-id', 'print-001', 'proof_of_play', 'https://api.prodooh.com/pop/print-001', ?, ?, ?, 'pending')`
          ).run(now, previousAttempts, now);

          const beforeProcess = Date.now();
          await queue.processQueue();

          const row = db.prepare('SELECT * FROM pop_queue WHERE id = ?').get('test-id') as POPQueueEntry;

          // After failure, attempts should be incremented by 1
          const expectedAttempts = previousAttempts + 1;
          expect(row.attempts).toBe(expectedAttempts);

          // Verify backoff formula: min(2^newAttempts * 1000, 60000)
          const expectedBackoff = Math.min(Math.pow(2, expectedAttempts) * 1000, 60_000);
          const actualNextRetry = new Date(row.next_retry_at).getTime();
          const actualBackoff = actualNextRetry - beforeProcess;

          // Allow small timing tolerance (±50ms)
          expect(actualBackoff).toBeGreaterThanOrEqual(expectedBackoff - 50);
          expect(actualBackoff).toBeLessThanOrEqual(expectedBackoff + 50);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('backoff delay is always capped at 60000ms regardless of attempt count', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 100 }),
        async (previousAttempts) => {
          db.exec('DELETE FROM pop_queue');
          vi.setSystemTime(1_700_000_000_000);

          const now = new Date().toISOString();
          db.prepare(
            `INSERT INTO pop_queue (id, print_id, action, url, created_at, attempts, next_retry_at, status)
             VALUES ('test-id', 'print-001', 'proof_of_play', 'https://api.prodooh.com/pop/print-001', ?, ?, ?, 'pending')`
          ).run(now, previousAttempts, now);

          const beforeProcess = Date.now();
          await queue.processQueue();

          const row = db.prepare('SELECT * FROM pop_queue WHERE id = ?').get('test-id') as POPQueueEntry;
          const actualNextRetry = new Date(row.next_retry_at).getTime();
          const actualBackoff = actualNextRetry - beforeProcess;

          // Backoff must never exceed 60000ms
          expect(actualBackoff).toBeLessThanOrEqual(60_050); // small timing tolerance
        }
      ),
      { numRuns: 100 }
    );
  });

  it('items are never discarded after any number of failures', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 30 }),
        async (failureCount) => {
          db.exec('DELETE FROM pop_queue');
          vi.setSystemTime(1_700_000_000_000);

          // Enqueue a notification
          queue.enqueue('print-001', 'proof_of_play', 'https://api.prodooh.com/pop/print-001');

          // Simulate the given number of consecutive failures
          for (let i = 0; i < failureCount; i++) {
            // Reset next_retry_at to now so it gets processed
            db.prepare(`UPDATE pop_queue SET next_retry_at = ? WHERE print_id = ?`)
              .run(new Date().toISOString(), 'print-001');
            await queue.processQueue();
          }

          // Verify: the item still exists and is still pending (never discarded)
          const row = db.prepare('SELECT * FROM pop_queue WHERE print_id = ?').get('print-001') as POPQueueEntry;
          expect(row).toBeDefined();
          expect(row.status).toBe('pending');
          expect(row.attempts).toBe(failureCount);

          // Verify: total items in queue hasn't decreased
          const totalCount = db.prepare('SELECT COUNT(*) as count FROM pop_queue').get() as { count: number };
          expect(totalCount.count).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('backoff sequence follows exponential growth: each delay is double the previous until cap', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 8 }),
        async (consecutiveFailures) => {
          db.exec('DELETE FROM pop_queue');
          vi.setSystemTime(1_700_000_000_000);

          queue.enqueue('print-001', 'proof_of_play', 'https://api.prodooh.com/pop/print-001');

          const backoffs: number[] = [];

          for (let i = 0; i < consecutiveFailures; i++) {
            // Reset next_retry_at to now
            db.prepare(`UPDATE pop_queue SET next_retry_at = ? WHERE print_id = ?`)
              .run(new Date().toISOString(), 'print-001');

            const before = Date.now();
            await queue.processQueue();

            const row = db.prepare('SELECT next_retry_at FROM pop_queue WHERE print_id = ?')
              .get('print-001') as { next_retry_at: string };
            const backoff = new Date(row.next_retry_at).getTime() - before;
            backoffs.push(backoff);
          }

          // Verify exponential growth: each backoff should be approximately double the previous
          // until hitting the 60s cap
          for (let i = 1; i < backoffs.length; i++) {
            const prevBackoff = backoffs[i - 1]!;
            const currBackoff = backoffs[i]!;

            if (prevBackoff < 60_000 && currBackoff < 60_000) {
              // Current should be approximately 2x previous (within tolerance)
              const ratio = currBackoff / prevBackoff;
              expect(ratio).toBeGreaterThanOrEqual(1.9);
              expect(ratio).toBeLessThanOrEqual(2.1);
            } else if (currBackoff >= 59_950) {
              // Once capped, it stays capped
              expect(currBackoff).toBeLessThanOrEqual(60_050);
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
