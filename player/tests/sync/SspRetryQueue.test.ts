import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SspRetryQueue, SspRetryRow } from '../../src/sync/SspRetryQueue';
import type { SspClient } from '../../src/engine/SspPrefetcher';

/**
 * Unit tests for SspRetryQueue — proofOfPlay, expire, and error classification.
 * Validates: Requirements 1.1, 1.2, 4.1, 4.2, 4.3, 4.4, 6.1, 6.2, 6.3
 */

function createTestDb(): Database.Database {
  return new Database(':memory:');
}

function createMockSspClient(overrides?: Partial<SspClient>): SspClient {
  return {
    requestAd: vi.fn().mockResolvedValue(null),
    expireAd: vi.fn().mockResolvedValue(undefined),
    proofOfPlay: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** Create an error with statusCode property (simulating HTTP errors) */
function httpError(statusCode: number, message?: string): Error & { statusCode: number } {
  const err = new Error(message ?? `HTTP ${statusCode}`) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

describe('SspRetryQueue', () => {
  let db: Database.Database;
  let sspClient: SspClient;
  let queue: SspRetryQueue;

  beforeEach(() => {
    db = createTestDb();
    sspClient = createMockSspClient();
    queue = new SspRetryQueue(db, sspClient);
  });

  afterEach(() => {
    db.close();
  });

  /** Helper: get all rows from the retry queue */
  function getAllRows(): SspRetryRow[] {
    return db.prepare('SELECT * FROM ssp_retry_queue ORDER BY id').all() as SspRetryRow[];
  }

  describe('proofOfPlay', () => {
    it('should not enqueue when the immediate attempt succeeds', async () => {
      await queue.proofOfPlay('print-123', 'https://ssp.example.com/pop/print-123');

      expect(sspClient.proofOfPlay).toHaveBeenCalledWith('print-123');
      expect(queue.getPendingCount()).toBe(0);
    });

    it('should enqueue on transient error (5xx)', async () => {
      (sspClient.proofOfPlay as ReturnType<typeof vi.fn>).mockRejectedValueOnce(httpError(503));

      await queue.proofOfPlay('print-abc', 'https://ssp.example.com/pop/print-abc');

      expect(queue.getPendingCount()).toBe(1);
      const rows = getAllRows();
      expect(rows[0].print_id).toBe('print-abc');
      expect(rows[0].operation_type).toBe('proof_of_play');
      expect(rows[0].url).toBe('https://ssp.example.com/pop/print-abc');
      expect(rows[0].attempts).toBe(1);
    });

    it('should enqueue on network error (no statusCode)', async () => {
      (sspClient.proofOfPlay as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('ECONNREFUSED'),
      );

      await queue.proofOfPlay('print-net', 'https://ssp.example.com/pop/print-net');

      expect(queue.getPendingCount()).toBe(1);
      const rows = getAllRows();
      expect(rows[0].print_id).toBe('print-net');
      expect(rows[0].operation_type).toBe('proof_of_play');
    });

    it('should discard on permanent error (404)', async () => {
      (sspClient.proofOfPlay as ReturnType<typeof vi.fn>).mockRejectedValueOnce(httpError(404));

      await queue.proofOfPlay('print-gone', 'https://ssp.example.com/pop/print-gone');

      expect(queue.getPendingCount()).toBe(0);
    });

    it('should discard on permanent error (409)', async () => {
      (sspClient.proofOfPlay as ReturnType<typeof vi.fn>).mockRejectedValueOnce(httpError(409));

      await queue.proofOfPlay('print-dup', 'https://ssp.example.com/pop/print-dup');

      expect(queue.getPendingCount()).toBe(0);
    });

    it('should discard on permanent error (401)', async () => {
      (sspClient.proofOfPlay as ReturnType<typeof vi.fn>).mockRejectedValueOnce(httpError(401));

      await queue.proofOfPlay('print-auth', 'https://ssp.example.com/pop/print-auth');

      expect(queue.getPendingCount()).toBe(0);
    });

    it('should discard on any 4xx error (e.g. 422)', async () => {
      (sspClient.proofOfPlay as ReturnType<typeof vi.fn>).mockRejectedValueOnce(httpError(422));

      await queue.proofOfPlay('print-bad', 'https://ssp.example.com/pop/print-bad');

      expect(queue.getPendingCount()).toBe(0);
    });

    it('should store the popUrl parameter (not derived from client)', async () => {
      (sspClient.proofOfPlay as ReturnType<typeof vi.fn>).mockRejectedValueOnce(httpError(500));
      const customUrl = 'https://custom-ssp.example.com/special-pop-url/xyz';

      await queue.proofOfPlay('print-custom', customUrl);

      const rows = getAllRows();
      expect(rows[0].url).toBe(customUrl);
    });
  });

  describe('expire', () => {
    it('should not enqueue when the immediate attempt succeeds', async () => {
      await queue.expire('print-456', 'https://ssp.example.com/expire/print-456');

      expect(sspClient.expireAd).toHaveBeenCalledWith('print-456');
      expect(queue.getPendingCount()).toBe(0);
    });

    it('should enqueue on transient error (500)', async () => {
      (sspClient.expireAd as ReturnType<typeof vi.fn>).mockRejectedValueOnce(httpError(500));

      await queue.expire('print-exp', 'https://ssp.example.com/expire/print-exp');

      expect(queue.getPendingCount()).toBe(1);
      const rows = getAllRows();
      expect(rows[0].print_id).toBe('print-exp');
      expect(rows[0].operation_type).toBe('expiration');
      expect(rows[0].url).toBe('https://ssp.example.com/expire/print-exp');
      expect(rows[0].attempts).toBe(1);
    });

    it('should enqueue on network error (TypeError)', async () => {
      (sspClient.expireAd as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new TypeError('Failed to fetch'),
      );

      await queue.expire('print-offline', 'https://ssp.example.com/expire/print-offline');

      expect(queue.getPendingCount()).toBe(1);
    });

    it('should discard on permanent error (404)', async () => {
      (sspClient.expireAd as ReturnType<typeof vi.fn>).mockRejectedValueOnce(httpError(404));

      await queue.expire('print-not-found', 'https://ssp.example.com/expire/print-not-found');

      expect(queue.getPendingCount()).toBe(0);
    });

    it('should discard on permanent error (401)', async () => {
      (sspClient.expireAd as ReturnType<typeof vi.fn>).mockRejectedValueOnce(httpError(401));

      await queue.expire('print-unauth', 'https://ssp.example.com/expire/print-unauth');

      expect(queue.getPendingCount()).toBe(0);
    });

    it('should store the expireUrl parameter (not derived from client)', async () => {
      (sspClient.expireAd as ReturnType<typeof vi.fn>).mockRejectedValueOnce(httpError(502));
      const customUrl = 'https://custom-ssp.example.com/expire-endpoint/abc';

      await queue.expire('print-custom-exp', customUrl);

      const rows = getAllRows();
      expect(rows[0].url).toBe(customUrl);
    });
  });

  describe('constructor', () => {
    it('creates the ssp_retry_queue table if it does not exist', () => {
      const freshDb = new Database(':memory:');
      const client = createMockSspClient();

      // Before constructing, table should not exist
      const tablesBefore = freshDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ssp_retry_queue'")
        .all();
      expect(tablesBefore).toHaveLength(0);

      // Construct — table should be created
      new SspRetryQueue(freshDb, client);

      const tablesAfter = freshDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ssp_retry_queue'")
        .all();
      expect(tablesAfter).toHaveLength(1);

      freshDb.close();
    });
  });

  describe('calculateBackoffMs', () => {
    it('returns baseBackoffMs for attempts=1', () => {
      expect(queue.calculateBackoffMs(1)).toBe(1000);
    });

    it('doubles for each subsequent attempt', () => {
      expect(queue.calculateBackoffMs(2)).toBe(2000);
      expect(queue.calculateBackoffMs(3)).toBe(4000);
      expect(queue.calculateBackoffMs(4)).toBe(8000);
      expect(queue.calculateBackoffMs(5)).toBe(16000);
    });

    it('caps at maxBackoffMs (60000)', () => {
      // 2^6 * 1000 = 64000 → capped at 60000
      expect(queue.calculateBackoffMs(7)).toBe(60000);
      expect(queue.calculateBackoffMs(10)).toBe(60000);
      expect(queue.calculateBackoffMs(20)).toBe(60000);
    });

    it('respects custom baseBackoffMs and maxBackoffMs', () => {
      const customDb = new Database(':memory:');
      const customClient = createMockSspClient();
      const customQueue = new SspRetryQueue(customDb, customClient, {
        baseBackoffMs: 500,
        maxBackoffMs: 10000,
      });

      expect(customQueue.calculateBackoffMs(1)).toBe(500);
      expect(customQueue.calculateBackoffMs(2)).toBe(1000);
      expect(customQueue.calculateBackoffMs(3)).toBe(2000);
      // 2^4 * 500 = 8000, still under 10000
      expect(customQueue.calculateBackoffMs(5)).toBe(8000);
      // 2^5 * 500 = 16000, capped at 10000
      expect(customQueue.calculateBackoffMs(6)).toBe(10000);

      customDb.close();
    });
  });

  describe('error classification edge cases', () => {
    it('should treat 5xx (502, 503, 504) as transient', async () => {
      for (const code of [502, 503, 504]) {
        const localDb = createTestDb();
        const localClient = createMockSspClient({
          proofOfPlay: vi.fn().mockRejectedValue(httpError(code)),
        });
        const localQueue = new SspRetryQueue(localDb, localClient);

        await localQueue.proofOfPlay(`print-${code}`, `https://example.com/pop/${code}`);
        expect(localQueue.getPendingCount()).toBe(1);

        localDb.close();
      }
    });

    it('should treat null/undefined error as transient', async () => {
      (sspClient.proofOfPlay as ReturnType<typeof vi.fn>).mockRejectedValueOnce(null);

      await queue.proofOfPlay('print-null', 'https://example.com/pop/null');

      // null is not an object with statusCode, so treated as transient
      expect(queue.getPendingCount()).toBe(1);
    });

    it('should not throw even when the SSP call fails', async () => {
      (sspClient.proofOfPlay as ReturnType<typeof vi.fn>).mockRejectedValueOnce(httpError(500));

      // proofOfPlay should never throw — it handles errors internally
      await expect(
        queue.proofOfPlay('print-safe', 'https://example.com/pop/safe'),
      ).resolves.toBeUndefined();
    });
  });
});
