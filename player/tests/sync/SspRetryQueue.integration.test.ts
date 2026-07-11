/**
 * Integration tests for SspRetryQueue — end-to-end flows.
 *
 * These tests validate the complete lifecycle of proof_of_play and expiration
 * operations through the SspRetryQueue + SspPrefetcher pipeline.
 *
 * Validates: Requirements 1.1, 1.2, 2.3, 3.2, 4.1, 6.1, 6.2, 7.2, 7.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SspRetryQueue } from '../../src/sync/SspRetryQueue';
import { SspPrefetcher, type SspClient, type SspContent } from '../../src/engine/SspPrefetcher';

// --- Helpers ---

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  return db;
}

/** Create an error with statusCode property (simulating HTTP errors) */
function httpError(statusCode: number, message?: string): Error & { statusCode: number } {
  const err = new Error(message ?? `HTTP ${statusCode}`) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

function createMockSspClient(overrides?: Partial<SspClient>): SspClient {
  return {
    requestAd: vi.fn().mockResolvedValue(null),
    expireAd: vi.fn().mockResolvedValue(undefined),
    proofOfPlay: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createSspContent(printId: string): SspContent {
  return {
    printId,
    assetUrl: `https://cdn.example.com/assets/${printId}.mp4`,
    durationSeconds: 15,
    mimeType: 'video/mp4',
    popUrl: `https://ssp.example.com/pop/${printId}`,
    expireUrl: `https://ssp.example.com/expire/${printId}`,
  };
}

/** Insert a row directly with old timestamps so backoff has elapsed */
function insertRowWithExpiredBackoff(
  db: Database.Database,
  opts: {
    printId: string;
    operationType: 'proof_of_play' | 'expiration';
    url: string;
  }
): void {
  const pastTime = new Date(Date.now() - 120_000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(`
    INSERT INTO ssp_retry_queue (print_id, operation_type, url, created_at, last_attempt_at, attempts)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(opts.printId, opts.operationType, opts.url, pastTime, pastTime);
}

describe('SspRetryQueue Integration Tests', () => {
  describe('Ciclo completo proof_of_play', () => {
    it('prefetch → reproducción → proofOfPlay falla → enqueue → flush → éxito → entry eliminada', async () => {
      // Setup: in-memory DB, mock SspClient
      const db = createTestDb();
      const content = createSspContent('print-pop-001');

      let popCallCount = 0;
      const mockClient = createMockSspClient({
        requestAd: vi.fn().mockResolvedValue(content),
        proofOfPlay: vi.fn().mockImplementation(() => {
          popCallCount++;
          if (popCallCount === 1) {
            // First call: 503 transient failure
            return Promise.reject(httpError(503, 'Service Unavailable'));
          }
          // Subsequent calls: success
          return Promise.resolve();
        }),
      });

      // Create SspRetryQueue and SspPrefetcher with retryQueue
      const retryQueue = new SspRetryQueue(db, mockClient, {
        baseBackoffMs: 1, // Very short for test speed
        maxBackoffMs: 10,
      });
      const prefetcher = new SspPrefetcher(mockClient, retryQueue);

      // Step 1: Prefetch SSP content
      const fetched = await prefetcher.prefetch(15);
      expect(fetched).not.toBeNull();
      expect(fetched!.printId).toBe('print-pop-001');
      expect(fetched!.popUrl).toBe('https://ssp.example.com/pop/print-pop-001');

      // Step 2: Simulate reproduction complete — call proofOfPlay (will fail with 503)
      await retryQueue.proofOfPlay(fetched!.printId, fetched!.popUrl);

      // Step 3: Assert entry was enqueued
      expect(retryQueue.getPendingCount()).toBe(1);

      // Step 4: Wait for backoff to elapse, then flush (mock now resolves)
      await new Promise((r) => setTimeout(r, 15));
      await retryQueue.flush();

      // Step 5: Assert queue is now empty — entry processed successfully
      expect(retryQueue.getPendingCount()).toBe(0);
      expect(popCallCount).toBe(2); // first call failed, second succeeded

      db.close();
    });
  });

  describe('Ciclo completo expiration', () => {
    it('prefetch → cambio manifiesto → expire falla → enqueue → flush → éxito → entry eliminada', async () => {
      // Setup: in-memory DB, mock SspClient
      const db = createTestDb();
      const contentA = createSspContent('print-exp-001');

      let expireCallCount = 0;
      const mockClient = createMockSspClient({
        requestAd: vi.fn().mockResolvedValue(contentA),
        expireAd: vi.fn().mockImplementation(() => {
          expireCallCount++;
          if (expireCallCount === 1) {
            // First call: 502 transient failure
            return Promise.reject(httpError(502, 'Bad Gateway'));
          }
          // Subsequent calls: success
          return Promise.resolve();
        }),
      });

      // Create SspRetryQueue and SspPrefetcher with retryQueue
      const retryQueue = new SspRetryQueue(db, mockClient, {
        baseBackoffMs: 1,
        maxBackoffMs: 10,
      });
      const prefetcher = new SspPrefetcher(mockClient, retryQueue);

      // Step 1: Prefetch content A
      const fetched = await prefetcher.prefetch(15);
      expect(fetched).not.toBeNull();
      expect(fetched!.printId).toBe('print-exp-001');

      // Step 2: Manifest changes — expire old content (triggers expire which fails)
      await prefetcher.expire('print-exp-001');

      // Step 3: Assert entry was enqueued due to transient failure
      expect(retryQueue.getPendingCount()).toBe(1);

      // Step 4: Wait for backoff to elapse, then flush (mock now resolves)
      await new Promise((r) => setTimeout(r, 15));
      await retryQueue.flush();

      // Step 5: Assert queue is now empty
      expect(retryQueue.getPendingCount()).toBe(0);
      expect(expireCallCount).toBe(2); // first failed, second succeeded

      db.close();
    });
  });

  describe('Reinicio del player', () => {
    it('encolar entries → destruir instancia → crear nueva → verificar recovery', async () => {
      // Use a SHARED database instance (not :memory: per instance)
      const sharedDb = createTestDb();

      // Create first SspRetryQueue instance and enqueue some entries
      const mockClient1 = createMockSspClient({
        proofOfPlay: vi.fn().mockRejectedValue(httpError(503)),
        expireAd: vi.fn().mockRejectedValue(httpError(500)),
      });

      const queue1 = new SspRetryQueue(sharedDb, mockClient1, {
        baseBackoffMs: 1,
        maxBackoffMs: 10,
      });

      // Enqueue entries via failing calls
      await queue1.proofOfPlay('print-recovery-1', 'https://ssp.example.com/pop/recovery-1');
      await queue1.proofOfPlay('print-recovery-2', 'https://ssp.example.com/pop/recovery-2');
      await queue1.expire('print-recovery-3', 'https://ssp.example.com/expire/recovery-3');

      // Verify entries are persisted
      expect(queue1.getPendingCount()).toBe(3);

      // "Destroy" instance 1 (let it go out of scope — no explicit destroy needed)
      // The DB remains open since it's shared

      // Create second SspRetryQueue instance with the SAME DB
      const mockClient2 = createMockSspClient(); // This client resolves successfully

      const queue2 = new SspRetryQueue(sharedDb, mockClient2, {
        baseBackoffMs: 1,
        maxBackoffMs: 10,
      });

      // Verify instance 2 sees the entries persisted by instance 1
      expect(queue2.getPendingCount()).toBe(3);

      // Wait for backoff to elapse, then flush on instance 2
      await new Promise((r) => setTimeout(r, 15));
      await queue2.flush();

      // Assert entries processed and removed
      expect(queue2.getPendingCount()).toBe(0);

      // Verify the correct calls were made by instance 2
      expect(mockClient2.proofOfPlay).toHaveBeenCalledWith('print-recovery-1');
      expect(mockClient2.proofOfPlay).toHaveBeenCalledWith('print-recovery-2');
      expect(mockClient2.expireAd).toHaveBeenCalledWith('print-recovery-3');

      sharedDb.close();
    });
  });

  describe('Error permanente en flush', () => {
    it('encolar entries → flush con mock 404 → verificar entries eliminadas', async () => {
      const db = createTestDb();

      // Phase 1: Enqueue entries with a transient-failing client
      const failingClient = createMockSspClient({
        proofOfPlay: vi.fn().mockRejectedValue(httpError(503)),
        expireAd: vi.fn().mockRejectedValue(httpError(500)),
      });

      const queue = new SspRetryQueue(db, failingClient, {
        baseBackoffMs: 1,
        maxBackoffMs: 10,
      });

      // Enqueue entries
      await queue.proofOfPlay('print-perm-1', 'https://ssp.example.com/pop/perm-1');
      await queue.proofOfPlay('print-perm-2', 'https://ssp.example.com/pop/perm-2');
      await queue.expire('print-perm-3', 'https://ssp.example.com/expire/perm-3');

      expect(queue.getPendingCount()).toBe(3);

      // Phase 2: Switch client to return 404 (permanent error) on all calls
      (failingClient.proofOfPlay as ReturnType<typeof vi.fn>).mockRejectedValue(httpError(404));
      (failingClient.expireAd as ReturnType<typeof vi.fn>).mockRejectedValue(httpError(404));

      // Wait for backoff to elapse, then flush
      await new Promise((r) => setTimeout(r, 15));
      await queue.flush();

      // Assert: all entries deleted (permanent error discards, no retry)
      expect(queue.getPendingCount()).toBe(0);

      db.close();
    });

    it('entries are deleted on 409 permanent error during flush', async () => {
      const db = createTestDb();

      const failingClient = createMockSspClient({
        proofOfPlay: vi.fn().mockRejectedValue(httpError(503)),
      });

      const queue = new SspRetryQueue(db, failingClient, {
        baseBackoffMs: 1,
        maxBackoffMs: 10,
      });

      await queue.proofOfPlay('print-conflict', 'https://ssp.example.com/pop/conflict');
      expect(queue.getPendingCount()).toBe(1);

      // Change mock to return 409 (already processed)
      (failingClient.proofOfPlay as ReturnType<typeof vi.fn>).mockRejectedValue(httpError(409));

      await new Promise((r) => setTimeout(r, 15));
      await queue.flush();

      expect(queue.getPendingCount()).toBe(0);

      db.close();
    });

    it('entries are deleted on 401 permanent error during flush', async () => {
      const db = createTestDb();

      const failingClient = createMockSspClient({
        expireAd: vi.fn().mockRejectedValue(httpError(500)),
      });

      const queue = new SspRetryQueue(db, failingClient, {
        baseBackoffMs: 1,
        maxBackoffMs: 10,
      });

      await queue.expire('print-unauth', 'https://ssp.example.com/expire/unauth');
      expect(queue.getPendingCount()).toBe(1);

      // Change mock to return 401 (invalid credentials)
      (failingClient.expireAd as ReturnType<typeof vi.fn>).mockRejectedValue(httpError(401));

      await new Promise((r) => setTimeout(r, 15));
      await queue.flush();

      expect(queue.getPendingCount()).toBe(0);

      db.close();
    });
  });
});
