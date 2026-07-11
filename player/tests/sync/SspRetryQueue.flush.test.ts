/**
 * Unit tests for SspRetryQueue.flush() method.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 3.1, 5.1, 5.2
 *
 * Tests the flush method:
 * - FIFO processing order (created_at ASC)
 * - Backoff respect (skip entries whose backoff hasn't elapsed)
 * - On success → DELETE entry
 * - On transient error → UPDATE attempts + 1
 * - On permanent error (4xx) → DELETE entry
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SspRetryQueue, type SspRetryRow } from '../../src/sync/SspRetryQueue';
import type { SspClient } from '../../src/engine/SspPrefetcher';

// --- Helpers ---

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  return db;
}

function createMockSspClient(overrides?: Partial<SspClient>): SspClient {
  return {
    requestAd: vi.fn().mockResolvedValue(null),
    expireAd: vi.fn().mockResolvedValue(undefined),
    proofOfPlay: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** Insert a row directly into the queue with a specific last_attempt_at time */
function insertRow(
  db: Database.Database,
  opts: {
    printId: string;
    operationType: 'proof_of_play' | 'expiration';
    url: string;
    createdAt: string;
    lastAttemptAt: string;
    attempts: number;
  }
): void {
  db.prepare(`
    INSERT INTO ssp_retry_queue (print_id, operation_type, url, created_at, last_attempt_at, attempts)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(opts.printId, opts.operationType, opts.url, opts.createdAt, opts.lastAttemptAt, opts.attempts);
}

/** Get all rows in queue ordered by created_at */
function getAllRows(db: Database.Database): SspRetryRow[] {
  return db.prepare('SELECT * FROM ssp_retry_queue ORDER BY created_at ASC').all() as SspRetryRow[];
}

/** Return an ISO timestamp N ms in the past */
function pastTimestamp(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString().replace('T', ' ').slice(0, 19);
}

describe('SspRetryQueue.flush()', () => {
  let db: Database.Database;
  let mockClient: SspClient;
  let queue: SspRetryQueue;

  beforeEach(() => {
    db = createTestDb();
    mockClient = createMockSspClient();
    queue = new SspRetryQueue(db, mockClient, {
      baseBackoffMs: 1000,
      maxBackoffMs: 60_000,
    });
  });

  afterEach(() => {
    db.close();
  });

  it('does nothing when queue is empty', async () => {
    await queue.flush();
    expect(queue.getPendingCount()).toBe(0);
    expect(mockClient.proofOfPlay).not.toHaveBeenCalled();
    expect(mockClient.expireAd).not.toHaveBeenCalled();
  });

  it('deletes entry on successful proof_of_play retry', async () => {
    // Insert a row whose backoff has elapsed (last attempt 10s ago, attempts=1, backoff=1s)
    insertRow(db, {
      printId: 'print-1',
      operationType: 'proof_of_play',
      url: 'https://ssp.example.com/pop/print-1',
      createdAt: pastTimestamp(60_000),
      lastAttemptAt: pastTimestamp(10_000),
      attempts: 1,
    });

    expect(queue.getPendingCount()).toBe(1);
    await queue.flush();
    expect(queue.getPendingCount()).toBe(0);
    expect(mockClient.proofOfPlay).toHaveBeenCalledWith('print-1');
  });

  it('deletes entry on successful expiration retry', async () => {
    insertRow(db, {
      printId: 'print-2',
      operationType: 'expiration',
      url: 'https://ssp.example.com/expire/print-2',
      createdAt: pastTimestamp(60_000),
      lastAttemptAt: pastTimestamp(10_000),
      attempts: 1,
    });

    await queue.flush();
    expect(queue.getPendingCount()).toBe(0);
    expect(mockClient.expireAd).toHaveBeenCalledWith('print-2');
  });

  it('increments attempts on transient error (5xx)', async () => {
    const error = new Error('Server Error');
    (error as any).statusCode = 503;
    (mockClient.proofOfPlay as any).mockRejectedValue(error);

    insertRow(db, {
      printId: 'print-3',
      operationType: 'proof_of_play',
      url: 'https://ssp.example.com/pop/print-3',
      createdAt: pastTimestamp(60_000),
      lastAttemptAt: pastTimestamp(10_000),
      attempts: 1,
    });

    await queue.flush();
    expect(queue.getPendingCount()).toBe(1);

    const rows = getAllRows(db);
    expect(rows[0]!.attempts).toBe(2);
  });

  it('increments attempts on network error (no statusCode)', async () => {
    const error = new Error('Network timeout');
    (mockClient.expireAd as any).mockRejectedValue(error);

    insertRow(db, {
      printId: 'print-4',
      operationType: 'expiration',
      url: 'https://ssp.example.com/expire/print-4',
      createdAt: pastTimestamp(60_000),
      lastAttemptAt: pastTimestamp(10_000),
      attempts: 2,
    });

    await queue.flush();
    expect(queue.getPendingCount()).toBe(1);

    const rows = getAllRows(db);
    expect(rows[0]!.attempts).toBe(3);
  });

  it('deletes entry on permanent error (4xx)', async () => {
    const error = new Error('Not Found');
    (error as any).statusCode = 404;
    (mockClient.proofOfPlay as any).mockRejectedValue(error);

    insertRow(db, {
      printId: 'print-5',
      operationType: 'proof_of_play',
      url: 'https://ssp.example.com/pop/print-5',
      createdAt: pastTimestamp(60_000),
      lastAttemptAt: pastTimestamp(10_000),
      attempts: 1,
    });

    await queue.flush();
    expect(queue.getPendingCount()).toBe(0);
  });

  it('deletes entry on 409 (already processed)', async () => {
    const error = new Error('Conflict');
    (error as any).statusCode = 409;
    (mockClient.expireAd as any).mockRejectedValue(error);

    insertRow(db, {
      printId: 'print-6',
      operationType: 'expiration',
      url: 'https://ssp.example.com/expire/print-6',
      createdAt: pastTimestamp(60_000),
      lastAttemptAt: pastTimestamp(10_000),
      attempts: 3,
    });

    await queue.flush();
    expect(queue.getPendingCount()).toBe(0);
  });

  it('deletes entry on 401 (invalid credentials)', async () => {
    const error = new Error('Unauthorized');
    (error as any).statusCode = 401;
    (mockClient.proofOfPlay as any).mockRejectedValue(error);

    insertRow(db, {
      printId: 'print-7',
      operationType: 'proof_of_play',
      url: 'https://ssp.example.com/pop/print-7',
      createdAt: pastTimestamp(60_000),
      lastAttemptAt: pastTimestamp(10_000),
      attempts: 1,
    });

    await queue.flush();
    expect(queue.getPendingCount()).toBe(0);
  });

  it('skips entries whose backoff has NOT elapsed', async () => {
    // attempts=3, backoff=2^2 * 1000 = 4000ms. Insert with last_attempt_at = now (0ms ago)
    // Since SQLite datetime has second precision, use attempts with large backoff
    // and a very recent last_attempt_at to ensure backoff is clearly NOT elapsed
    const nowTs = new Date().toISOString().replace('T', ' ').slice(0, 19);

    insertRow(db, {
      printId: 'print-8',
      operationType: 'proof_of_play',
      url: 'https://ssp.example.com/pop/print-8',
      createdAt: pastTimestamp(60_000),
      lastAttemptAt: nowTs, // just now — backoff should NOT have elapsed
      attempts: 3, // backoff = 4000ms
    });

    await queue.flush();
    // Entry should still be there, untouched
    expect(queue.getPendingCount()).toBe(1);
    expect(mockClient.proofOfPlay).not.toHaveBeenCalled();

    const rows = getAllRows(db);
    expect(rows[0]!.attempts).toBe(3); // attempts not changed
  });

  it('skips high-attempt entries whose larger backoff has not elapsed', async () => {
    // attempts=5, backoff = 2^4 * 1000 = 16000ms. Last attempt 10s ago — should skip
    insertRow(db, {
      printId: 'print-9',
      operationType: 'expiration',
      url: 'https://ssp.example.com/expire/print-9',
      createdAt: pastTimestamp(120_000),
      lastAttemptAt: pastTimestamp(10_000), // 10s ago, but backoff is 16s
      attempts: 5,
    });

    await queue.flush();
    expect(queue.getPendingCount()).toBe(1);
    expect(mockClient.expireAd).not.toHaveBeenCalled();
  });

  it('processes entries in FIFO order (created_at ASC)', async () => {
    const callOrder: string[] = [];

    (mockClient.proofOfPlay as any).mockImplementation((printId: string) => {
      callOrder.push(printId);
      return Promise.resolve();
    });
    (mockClient.expireAd as any).mockImplementation((printId: string) => {
      callOrder.push(printId);
      return Promise.resolve();
    });

    // Insert entries with different created_at but all ready (last_attempt is old)
    insertRow(db, {
      printId: 'first',
      operationType: 'expiration',
      url: 'https://ssp.example.com/expire/first',
      createdAt: '2024-01-01 10:00:00',
      lastAttemptAt: '2024-01-01 10:00:00',
      attempts: 1,
    });
    insertRow(db, {
      printId: 'second',
      operationType: 'proof_of_play',
      url: 'https://ssp.example.com/pop/second',
      createdAt: '2024-01-01 10:01:00',
      lastAttemptAt: '2024-01-01 10:01:00',
      attempts: 1,
    });
    insertRow(db, {
      printId: 'third',
      operationType: 'expiration',
      url: 'https://ssp.example.com/expire/third',
      createdAt: '2024-01-01 10:02:00',
      lastAttemptAt: '2024-01-01 10:02:00',
      attempts: 1,
    });

    await queue.flush();

    expect(callOrder).toEqual(['first', 'second', 'third']);
    expect(queue.getPendingCount()).toBe(0);
  });

  it('processes mixed operation types without priority differentiation', async () => {
    const callOrder: Array<{ type: string; id: string }> = [];

    (mockClient.proofOfPlay as any).mockImplementation((printId: string) => {
      callOrder.push({ type: 'proof_of_play', id: printId });
      return Promise.resolve();
    });
    (mockClient.expireAd as any).mockImplementation((printId: string) => {
      callOrder.push({ type: 'expiration', id: printId });
      return Promise.resolve();
    });

    // Interleave operation types — order should be purely by created_at
    insertRow(db, {
      printId: 'pop-1',
      operationType: 'proof_of_play',
      url: 'https://ssp.example.com/pop/pop-1',
      createdAt: '2024-01-01 10:00:00',
      lastAttemptAt: '2024-01-01 10:00:00',
      attempts: 1,
    });
    insertRow(db, {
      printId: 'exp-1',
      operationType: 'expiration',
      url: 'https://ssp.example.com/expire/exp-1',
      createdAt: '2024-01-01 10:00:30',
      lastAttemptAt: '2024-01-01 10:00:30',
      attempts: 1,
    });
    insertRow(db, {
      printId: 'pop-2',
      operationType: 'proof_of_play',
      url: 'https://ssp.example.com/pop/pop-2',
      createdAt: '2024-01-01 10:01:00',
      lastAttemptAt: '2024-01-01 10:01:00',
      attempts: 1,
    });

    await queue.flush();

    expect(callOrder).toEqual([
      { type: 'proof_of_play', id: 'pop-1' },
      { type: 'expiration', id: 'exp-1' },
      { type: 'proof_of_play', id: 'pop-2' },
    ]);
  });

  it('respects maxBackoffMs cap for high attempt counts', async () => {
    // attempts=20, backoff would be 2^19 * 1000 = very large, capped at 60000ms
    // Last attempt was 61s ago → should be processed (just over the 60s cap)
    insertRow(db, {
      printId: 'print-high',
      operationType: 'proof_of_play',
      url: 'https://ssp.example.com/pop/print-high',
      createdAt: pastTimestamp(300_000),
      lastAttemptAt: pastTimestamp(61_000), // 61s ago, cap is 60s
      attempts: 20,
    });

    await queue.flush();
    expect(queue.getPendingCount()).toBe(0);
    expect(mockClient.proofOfPlay).toHaveBeenCalledWith('print-high');
  });
});
