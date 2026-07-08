import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { POPQueue } from '../../src/queue/POPQueue';
import type { POPQueueEntry } from '../../src/queue/POPQueue';

/**
 * Tests for POPQueue — Persistent Proof of Play queue with exponential backoff.
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4
 */

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

describe('POPQueue', () => {
  let db: Database.Database;
  let queue: POPQueue;

  beforeEach(() => {
    db = createTestDb();
    queue = new POPQueue(db);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  describe('enqueue', () => {
    it('should insert a proof_of_play entry with pending status', () => {
      queue.enqueue('print-001', 'proof_of_play', 'https://api.prodooh.com/pop/print-001');

      const row = db.prepare('SELECT * FROM pop_queue WHERE print_id = ?').get('print-001') as POPQueueEntry;
      expect(row).toBeDefined();
      expect(row.print_id).toBe('print-001');
      expect(row.action).toBe('proof_of_play');
      expect(row.url).toBe('https://api.prodooh.com/pop/print-001');
      expect(row.status).toBe('pending');
      expect(row.attempts).toBe(0);
      expect(row.next_retry_at).toBeDefined();
      expect(row.created_at).toBeDefined();
    });

    it('should insert an expiration entry with pending status', () => {
      queue.enqueue('print-002', 'expiration', 'https://api.prodooh.com/expiration/print-002');

      const row = db.prepare('SELECT * FROM pop_queue WHERE print_id = ?').get('print-002') as POPQueueEntry;
      expect(row).toBeDefined();
      expect(row.action).toBe('expiration');
      expect(row.status).toBe('pending');
      expect(row.attempts).toBe(0);
    });

    it('should generate unique IDs for each entry', () => {
      queue.enqueue('print-001', 'proof_of_play', 'https://api.prodooh.com/pop/print-001');
      queue.enqueue('print-002', 'proof_of_play', 'https://api.prodooh.com/pop/print-002');

      const rows = db.prepare('SELECT id FROM pop_queue').all() as { id: string }[];
      expect(rows).toHaveLength(2);
      expect(rows[0]!.id).not.toBe(rows[1]!.id);
    });

    it('should set next_retry_at to now (immediately processable)', () => {
      const before = new Date().toISOString();
      queue.enqueue('print-001', 'proof_of_play', 'https://api.prodooh.com/pop/print-001');
      const after = new Date().toISOString();

      const row = db.prepare('SELECT next_retry_at FROM pop_queue WHERE print_id = ?').get('print-001') as { next_retry_at: string };
      expect(row.next_retry_at >= before).toBe(true);
      expect(row.next_retry_at <= after).toBe(true);
    });
  });

  describe('processQueue', () => {
    it('should mark entry as sent on HTTP 201 response', async () => {
      queue.enqueue('print-001', 'proof_of_play', 'https://api.prodooh.com/pop/print-001');

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 201 }));

      await queue.processQueue();

      const row = db.prepare('SELECT status FROM pop_queue WHERE print_id = ?').get('print-001') as { status: string };
      expect(row.status).toBe('sent');
    });

    it('should mark entry as sent on HTTP 409 response (already processed)', async () => {
      queue.enqueue('print-001', 'proof_of_play', 'https://api.prodooh.com/pop/print-001');

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 409 }));

      await queue.processQueue();

      const row = db.prepare('SELECT status FROM pop_queue WHERE print_id = ?').get('print-001') as { status: string };
      expect(row.status).toBe('sent');
    });

    it('should increment attempts and set backoff on HTTP error', async () => {
      queue.enqueue('print-001', 'proof_of_play', 'https://api.prodooh.com/pop/print-001');

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500 }));

      const beforeProcess = Date.now();
      await queue.processQueue();

      const row = db.prepare('SELECT * FROM pop_queue WHERE print_id = ?').get('print-001') as POPQueueEntry;
      expect(row.status).toBe('pending');
      expect(row.attempts).toBe(1);

      // After 1 attempt, backoff = min(2^1 * 1000, 60000) = 2000ms
      const nextRetryTime = new Date(row.next_retry_at).getTime();
      expect(nextRetryTime).toBeGreaterThanOrEqual(beforeProcess + 2000 - 100); // small tolerance
    });

    it('should increment attempts and set backoff on network error', async () => {
      queue.enqueue('print-001', 'proof_of_play', 'https://api.prodooh.com/pop/print-001');

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      await queue.processQueue();

      const row = db.prepare('SELECT * FROM pop_queue WHERE print_id = ?').get('print-001') as POPQueueEntry;
      expect(row.status).toBe('pending');
      expect(row.attempts).toBe(1);
    });

    it('should not process entries with next_retry_at in the future', async () => {
      // Manually insert an entry with a future retry time
      const futureTime = new Date(Date.now() + 60000).toISOString();
      db.prepare(
        `INSERT INTO pop_queue (id, print_id, action, url, created_at, attempts, next_retry_at, status)
         VALUES ('q1', 'print-001', 'proof_of_play', 'https://api.prodooh.com/pop/print-001', ?, 2, ?, 'pending')`
      ).run(new Date().toISOString(), futureTime);

      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await queue.processQueue();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should not process entries already marked as sent', async () => {
      db.prepare(
        `INSERT INTO pop_queue (id, print_id, action, url, created_at, attempts, next_retry_at, status)
         VALUES ('q1', 'print-001', 'proof_of_play', 'https://api.prodooh.com/pop/print-001', ?, 0, ?, 'sent')`
      ).run(new Date().toISOString(), new Date().toISOString());

      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await queue.processQueue();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should process multiple pending entries', async () => {
      queue.enqueue('print-001', 'proof_of_play', 'https://api.prodooh.com/pop/print-001');
      queue.enqueue('print-002', 'expiration', 'https://api.prodooh.com/expiration/print-002');

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 201 }));

      await queue.processQueue();

      expect(queue.getSentCount()).toBe(2);
      expect(queue.getPendingCount()).toBe(0);
    });

    it('should never discard undelivered notifications', async () => {
      queue.enqueue('print-001', 'proof_of_play', 'https://api.prodooh.com/pop/print-001');

      // Fail 5 times
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      // Manually set next_retry_at to now for each retry cycle
      for (let i = 0; i < 5; i++) {
        db.prepare(`UPDATE pop_queue SET next_retry_at = ? WHERE print_id = ?`)
          .run(new Date().toISOString(), 'print-001');
        await queue.processQueue();
      }

      const row = db.prepare('SELECT * FROM pop_queue WHERE print_id = ?').get('print-001') as POPQueueEntry;
      expect(row.status).toBe('pending'); // Still pending, never discarded
      expect(row.attempts).toBe(5);
    });

    it('should use GET method when calling the URL', async () => {
      queue.enqueue('print-001', 'proof_of_play', 'https://api.prodooh.com/pop/print-001');

      const fetchMock = vi.fn().mockResolvedValue({ status: 201 });
      vi.stubGlobal('fetch', fetchMock);

      await queue.processQueue();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.prodooh.com/pop/print-001',
        { method: 'GET' }
      );
    });
  });

  describe('getPendingCount', () => {
    it('should return 0 when queue is empty', () => {
      expect(queue.getPendingCount()).toBe(0);
    });

    it('should return the correct count of pending items', () => {
      queue.enqueue('print-001', 'proof_of_play', 'https://api.prodooh.com/pop/print-001');
      queue.enqueue('print-002', 'expiration', 'https://api.prodooh.com/expiration/print-002');
      expect(queue.getPendingCount()).toBe(2);
    });

    it('should not count sent items', async () => {
      queue.enqueue('print-001', 'proof_of_play', 'https://api.prodooh.com/pop/print-001');
      queue.enqueue('print-002', 'proof_of_play', 'https://api.prodooh.com/pop/print-002');

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 201 }));
      // Only process one item by setting the other's retry to the future
      db.prepare(
        `UPDATE pop_queue SET next_retry_at = ? WHERE print_id = 'print-002'`
      ).run(new Date(Date.now() + 60000).toISOString());

      await queue.processQueue();

      expect(queue.getPendingCount()).toBe(1);
    });
  });

  describe('getSentCount', () => {
    it('should return 0 when queue is empty', () => {
      expect(queue.getSentCount()).toBe(0);
    });

    it('should return the correct count of sent items', async () => {
      queue.enqueue('print-001', 'proof_of_play', 'https://api.prodooh.com/pop/print-001');
      queue.enqueue('print-002', 'expiration', 'https://api.prodooh.com/expiration/print-002');

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 201 }));
      await queue.processQueue();

      expect(queue.getSentCount()).toBe(2);
    });
  });

  describe('exponential backoff', () => {
    it('should calculate correct backoff: 2s after 1st attempt', async () => {
      queue.enqueue('print-001', 'proof_of_play', 'https://api.prodooh.com/pop/print-001');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500 }));

      const before = Date.now();
      await queue.processQueue();

      const row = db.prepare('SELECT * FROM pop_queue WHERE print_id = ?').get('print-001') as POPQueueEntry;
      const nextRetry = new Date(row.next_retry_at).getTime();
      // 2^1 * 1000 = 2000ms
      expect(nextRetry - before).toBeGreaterThanOrEqual(1900);
      expect(nextRetry - before).toBeLessThan(3000);
    });

    it('should calculate correct backoff: 4s after 2nd attempt', async () => {
      // Insert with 1 attempt already done
      db.prepare(
        `INSERT INTO pop_queue (id, print_id, action, url, created_at, attempts, next_retry_at, status)
         VALUES ('q1', 'print-001', 'proof_of_play', 'https://api.prodooh.com/pop/print-001', ?, 1, ?, 'pending')`
      ).run(new Date().toISOString(), new Date().toISOString());

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500 }));

      const before = Date.now();
      await queue.processQueue();

      const row = db.prepare('SELECT * FROM pop_queue WHERE print_id = ?').get('print-001') as POPQueueEntry;
      const nextRetry = new Date(row.next_retry_at).getTime();
      // 2^2 * 1000 = 4000ms
      expect(nextRetry - before).toBeGreaterThanOrEqual(3900);
      expect(nextRetry - before).toBeLessThan(5000);
    });

    it('should cap backoff at 60 seconds', async () => {
      // Insert with 10 attempts already done (2^11 * 1000 = 2048000ms > 60000ms cap)
      db.prepare(
        `INSERT INTO pop_queue (id, print_id, action, url, created_at, attempts, next_retry_at, status)
         VALUES ('q1', 'print-001', 'proof_of_play', 'https://api.prodooh.com/pop/print-001', ?, 10, ?, 'pending')`
      ).run(new Date().toISOString(), new Date().toISOString());

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500 }));

      const before = Date.now();
      await queue.processQueue();

      const row = db.prepare('SELECT * FROM pop_queue WHERE print_id = ?').get('print-001') as POPQueueEntry;
      const nextRetry = new Date(row.next_retry_at).getTime();
      // Should be capped at 60000ms
      expect(nextRetry - before).toBeGreaterThanOrEqual(59000);
      expect(nextRetry - before).toBeLessThan(62000);
    });
  });
});
