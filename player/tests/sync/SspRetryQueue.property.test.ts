/**
 * Property-based tests for SspRetryQueue
 *
 * Uses fast-check to validate correctness properties of the retry queue.
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
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

/** Create an error with statusCode property (simulating HTTP errors) */
function httpError(statusCode: number): Error & { statusCode: number } {
  const err = new Error(`HTTP ${statusCode}`) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

// --- Generators ---

const arbPrintId = fc.uuid();
const arbOperationType = fc.constantFrom<'proof_of_play' | 'expiration'>('proof_of_play', 'expiration');
const arbUrl = fc.webUrl();
const arbAttempts = fc.integer({ min: 1, max: 50 });
const arb5xx = fc.integer({ min: 500, max: 599 });
const arb4xx = fc.integer({ min: 400, max: 499 });
const arbEntryCount = fc.integer({ min: 1, max: 10 });

// --- Property 1: Enqueue on transient failure persists correct data ---

/**
 * Tag: Feature: 07-player-reingenieria-estabilizacion, Property 1: Enqueue on transient failure persists correct data
 *
 * **Validates: Requirements 1.1**
 *
 * For any valid SSP operation (random print_id, random operation_type, random URL)
 * that fails with a transient error (5xx, timeout, network error), the SspRetryQueue
 * SHALL persist exactly one row in SQLite containing that print_id, operation_type,
 * URL, and attempts = 1.
 */
describe('Feature: 07-player-reingenieria-estabilizacion, Property 1: Enqueue on transient failure persists correct data', () => {
  it('5xx error enqueues exactly one row with correct print_id, operation_type, url, and attempts=1', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPrintId,
        arbOperationType,
        arbUrl,
        arb5xx,
        async (printId, operationType, url, statusCode) => {
          const db = createTestDb();

          try {
            // Create mock SspClient that throws a 5xx error for the relevant method
            const sspClient = createMockSspClient({
              proofOfPlay: vi.fn().mockRejectedValue(httpError(statusCode)),
              expireAd: vi.fn().mockRejectedValue(httpError(statusCode)),
            });

            const queue = new SspRetryQueue(db, sspClient);

            // Call the appropriate method based on operation_type
            if (operationType === 'proof_of_play') {
              await queue.proofOfPlay(printId, url);
            } else {
              await queue.expire(printId, url);
            }

            // PROPERTY: Exactly one row is persisted
            const rows = db
              .prepare('SELECT * FROM ssp_retry_queue')
              .all() as SspRetryRow[];
            expect(rows).toHaveLength(1);

            // PROPERTY: The row contains the correct print_id
            expect(rows[0].print_id).toBe(printId);

            // PROPERTY: The row contains the correct operation_type
            expect(rows[0].operation_type).toBe(operationType);

            // PROPERTY: The row contains the correct url
            expect(rows[0].url).toBe(url);

            // PROPERTY: attempts is initialized to 1
            expect(rows[0].attempts).toBe(1);
          } finally {
            db.close();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('network error (no statusCode) enqueues exactly one row with correct data', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPrintId,
        arbOperationType,
        arbUrl,
        async (printId, operationType, url) => {
          const db = createTestDb();

          try {
            // Network error has no statusCode — classified as transient
            const networkError = new Error('ECONNREFUSED');
            const sspClient = createMockSspClient({
              proofOfPlay: vi.fn().mockRejectedValue(networkError),
              expireAd: vi.fn().mockRejectedValue(networkError),
            });

            const queue = new SspRetryQueue(db, sspClient);

            if (operationType === 'proof_of_play') {
              await queue.proofOfPlay(printId, url);
            } else {
              await queue.expire(printId, url);
            }

            // PROPERTY: Exactly one row is persisted
            const rows = db
              .prepare('SELECT * FROM ssp_retry_queue')
              .all() as SspRetryRow[];
            expect(rows).toHaveLength(1);

            // PROPERTY: Correct data persisted
            expect(rows[0].print_id).toBe(printId);
            expect(rows[0].operation_type).toBe(operationType);
            expect(rows[0].url).toBe(url);
            expect(rows[0].attempts).toBe(1);
          } finally {
            db.close();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('timeout error (TypeError) enqueues exactly one row with correct data', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPrintId,
        arbOperationType,
        arbUrl,
        async (printId, operationType, url) => {
          const db = createTestDb();

          try {
            // TypeError simulates a fetch failure (timeout/network)
            const timeoutError = new TypeError('Failed to fetch');
            const sspClient = createMockSspClient({
              proofOfPlay: vi.fn().mockRejectedValue(timeoutError),
              expireAd: vi.fn().mockRejectedValue(timeoutError),
            });

            const queue = new SspRetryQueue(db, sspClient);

            if (operationType === 'proof_of_play') {
              await queue.proofOfPlay(printId, url);
            } else {
              await queue.expire(printId, url);
            }

            // PROPERTY: Exactly one row is persisted
            const rows = db
              .prepare('SELECT * FROM ssp_retry_queue')
              .all() as SspRetryRow[];
            expect(rows).toHaveLength(1);

            // PROPERTY: Correct data persisted
            expect(rows[0].print_id).toBe(printId);
            expect(rows[0].operation_type).toBe(operationType);
            expect(rows[0].url).toBe(url);
            expect(rows[0].attempts).toBe(1);
          } finally {
            db.close();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Property 2: Successful first attempt produces no queue entries ---

/**
 * Tag: Feature: 07-player-reingenieria-estabilizacion, Property 2: Successful first attempt produces no queue entries
 *
 * **Validates: Requirements 1.2**
 *
 * For any valid SSP operation that succeeds on the first attempt (2xx response / no exception),
 * the SspRetryQueue SHALL NOT insert any row into the retry queue table.
 */
describe('Feature: 07-player-reingenieria-estabilizacion, Property 2: Successful first attempt produces no queue entries', () => {
  it('no rows are inserted when the SSP call succeeds on the first attempt', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPrintId,
        arbOperationType,
        arbUrl,
        async (printId, operationType, url) => {
          const db = createTestDb();
          try {
            // Create a mock SspClient that always succeeds (never throws)
            const successClient: SspClient = {
              requestAd: async () => null,
              expireAd: async () => {},
              proofOfPlay: async () => {},
            };

            const queue = new SspRetryQueue(db, successClient);

            // Call the appropriate method based on generated operation_type
            if (operationType === 'proof_of_play') {
              await queue.proofOfPlay(printId, url);
            } else {
              await queue.expire(printId, url);
            }

            // Assert: no entries should be in the retry queue
            expect(queue.getPendingCount()).toBe(0);
          } finally {
            db.close();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Property 4: Successful retry removes entry ---

/**
 * Tag: Feature: 07-player-reingenieria-estabilizacion, Property 4: Successful retry removes entry
 *
 * **Validates: Requirements 2.3**
 *
 * For any entry in the retry queue, when a retry attempt succeeds (2xx response /
 * no exception), that entry SHALL be deleted from SQLite and no longer appear in
 * subsequent flush operations.
 */
describe('Feature: 07-player-reingenieria-estabilizacion, Property 4: Successful retry removes entry', () => {
  it('a successful retry deletes the entry from SQLite and subsequent flush is a no-op', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPrintId,
        arbOperationType,
        arbUrl,
        arbAttempts,
        async (printId, operationType, url, attempts) => {
          const db = createTestDb();

          try {
            // Create a mock SspClient that resolves successfully (simulates 2xx response)
            const mockClient = createMockSspClient();

            const queue = new SspRetryQueue(db, mockClient, {
              baseBackoffMs: 1000,
              maxBackoffMs: 60_000,
            });

            // Insert a row with last_attempt_at sufficiently in the past (backoff elapsed)
            // For attempts up to 50, max backoff is capped at 60s. Use 120s in the past to be safe.
            const lastAttemptAt = new Date(Date.now() - 120_000).toISOString().replace('T', ' ').slice(0, 19);
            const createdAt = new Date(Date.now() - 300_000).toISOString().replace('T', ' ').slice(0, 19);

            db.prepare(`
              INSERT INTO ssp_retry_queue (print_id, operation_type, url, created_at, last_attempt_at, attempts)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(printId, operationType, url, createdAt, lastAttemptAt, attempts);

            // Verify the entry is in the queue
            expect(queue.getPendingCount()).toBe(1);

            // First flush — should process and delete the entry on success
            await queue.flush();

            // PROPERTY: Entry was deleted after successful retry
            expect(queue.getPendingCount()).toBe(0);

            // Verify the correct SspClient method was called
            if (operationType === 'proof_of_play') {
              expect(mockClient.proofOfPlay).toHaveBeenCalledWith(printId);
            } else {
              expect(mockClient.expireAd).toHaveBeenCalledWith(printId);
            }

            // Second flush — should be a no-op (nothing to process)
            await queue.flush();

            // PROPERTY: Entry no longer appears in subsequent flush operations
            expect(queue.getPendingCount()).toBe(0);
          } finally {
            db.close();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Property 5: Failed retry increments attempts ---

/**
 * Tag: Feature: 07-player-reingenieria-estabilizacion, Property 5: Failed retry increments attempts
 *
 * **Validates: Requirements 2.4**
 *
 * For any entry in the retry queue with N attempts, when a retry fails with
 * a transient error, the entry's attempts field SHALL become N + 1 and its
 * last_attempt_at SHALL be updated.
 */
describe('Feature: 07-player-reingenieria-estabilizacion, Property 5: Failed retry increments attempts', () => {
  it('failed retry with transient error increments attempts and updates last_attempt_at', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPrintId,
        arbOperationType,
        arbUrl,
        arbAttempts,
        arb5xx,
        async (printId, operationType, url, attempts, statusCode) => {
          const db = createTestDb();

          try {
            // Create a mock SspClient that throws a transient error (5xx)
            const error = httpError(statusCode);

            const mockClient = createMockSspClient({
              proofOfPlay: vi.fn().mockRejectedValue(error),
              expireAd: vi.fn().mockRejectedValue(error),
            });

            // Create queue with small backoff to ensure entries are eligible
            const queue = new SspRetryQueue(db, mockClient, {
              baseBackoffMs: 1,
              maxBackoffMs: 1,
            });

            // Insert a row with the generated attempts value and last_attempt_at in the past
            const pastTime = '2020-01-01 00:00:00';
            db.prepare(`
              INSERT INTO ssp_retry_queue (print_id, operation_type, url, created_at, last_attempt_at, attempts)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(printId, operationType, url, pastTime, pastTime, attempts);

            // Record last_attempt_at before flush
            const rowBefore = db.prepare('SELECT last_attempt_at FROM ssp_retry_queue WHERE print_id = ?').get(printId) as { last_attempt_at: string };
            const lastAttemptBefore = rowBefore.last_attempt_at;

            // Call flush — should attempt retry and fail with transient error
            await queue.flush();

            // Assert entry still exists (not deleted)
            expect(queue.getPendingCount()).toBe(1);

            // Assert attempts incremented by 1
            const rowAfter = db.prepare('SELECT attempts, last_attempt_at FROM ssp_retry_queue WHERE print_id = ?').get(printId) as { attempts: number; last_attempt_at: string };
            expect(rowAfter.attempts).toBe(attempts + 1);

            // Assert last_attempt_at was updated (different from before)
            expect(rowAfter.last_attempt_at).not.toBe(lastAttemptBefore);
          } finally {
            db.close();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


// --- Property 6: No TTL — entries persist indefinitely ---

/**
 * Tag: Feature: 07-player-reingenieria-estabilizacion, Property 6: No TTL — entries persist indefinitely
 *
 * **Validates: Requirements 3.1, 3.3**
 *
 * For any entry in the retry queue regardless of its attempt count or age (created_at),
 * the entry SHALL remain in the queue and be eligible for retry processing as long as
 * no success or permanent error occurs.
 */
describe('Feature: 07-player-reingenieria-estabilizacion, Property 6: No TTL — entries persist indefinitely', () => {
  const arbHighAttempts = fc.integer({ min: 1, max: 100 });
  const arbDaysAgo = fc.integer({ min: 1, max: 365 });

  it('entries with high attempt counts and very old created_at persist and are retried without expiration', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPrintId,
        arbOperationType,
        arbUrl,
        arbHighAttempts,
        arbDaysAgo,
        async (printId, operationType, url, attempts, daysAgo) => {
          const db = createTestDb();

          try {
            // Mock SspClient that always throws a transient error (5xx)
            const mockClient = createMockSspClient({
              proofOfPlay: vi.fn().mockRejectedValue(httpError(503)),
              expireAd: vi.fn().mockRejectedValue(httpError(503)),
            });

            // Create queue with very small backoff (1ms) so entries are always eligible
            const queue = new SspRetryQueue(db, mockClient, {
              baseBackoffMs: 1,
              maxBackoffMs: 1,
            });

            // Create a very old created_at (days to months ago)
            const createdAtDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
            const createdAt = createdAtDate.toISOString().replace('T', ' ').slice(0, 19);

            // Set last_attempt_at far in the past so backoff is elapsed
            const lastAttemptAt = createdAt;

            // Insert a row with very high attempts value and very old created_at
            db.prepare(`
              INSERT INTO ssp_retry_queue (print_id, operation_type, url, created_at, last_attempt_at, attempts)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(printId, operationType, url, createdAt, lastAttemptAt, attempts);

            // Verify entry exists before flush
            expect(queue.getPendingCount()).toBe(1);

            // Call flush — entry should be processed (retried) and remain in queue
            await queue.flush();

            // PROPERTY: Entry still exists (not expired, not deleted by any TTL)
            expect(queue.getPendingCount()).toBe(1);

            // PROPERTY: Attempts was incremented (entry was processed, not ignored/TTL'd)
            const row = db
              .prepare('SELECT attempts FROM ssp_retry_queue WHERE print_id = ?')
              .get(printId) as { attempts: number };
            expect(row.attempts).toBe(attempts + 1);
          } finally {
            db.close();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


// --- Property 8: Any 4xx response discards entry without retry ---

/**
 * Tag: Feature: 07-player-reingenieria-estabilizacion, Property 8: Any 4xx response discards entry without retry
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
 *
 * For any entry in the retry queue and any HTTP response with status code in the
 * range [400, 499], the SspRetryQueue SHALL delete that entry from SQLite immediately
 * without further retry attempts.
 */
describe('Feature: 07-player-reingenieria-estabilizacion, Property 8: Any 4xx response discards entry without retry', () => {
  it('any 4xx status code causes immediate deletion of the entry without retry', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPrintId,
        arbOperationType,
        arbUrl,
        arbAttempts,
        arb4xx,
        async (printId, operationType, url, attempts, statusCode) => {
          const db = createTestDb();

          try {
            // Create a mock SspClient that throws an error with the generated 4xx statusCode
            const error = httpError(statusCode);
            const mockClient = createMockSspClient({
              proofOfPlay: vi.fn().mockRejectedValue(error),
              expireAd: vi.fn().mockRejectedValue(error),
            });

            // Create queue with small backoff (1ms) to ensure entry is eligible for processing
            const queue = new SspRetryQueue(db, mockClient, {
              baseBackoffMs: 1,
              maxBackoffMs: 1,
            });

            // Insert a row with the generated data and last_attempt_at in the past
            const pastTime = '2020-01-01 00:00:00';
            db.prepare(`
              INSERT INTO ssp_retry_queue (print_id, operation_type, url, created_at, last_attempt_at, attempts)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(printId, operationType, url, pastTime, pastTime, attempts);

            // Verify the entry exists before flush
            expect(queue.getPendingCount()).toBe(1);

            // Call flush — should attempt retry, get 4xx, and delete the entry
            await queue.flush();

            // PROPERTY: Entry was deleted (pending count is 0)
            expect(queue.getPendingCount()).toBe(0);

            // PROPERTY: The row does NOT exist in SQLite anymore
            const row = db
              .prepare('SELECT * FROM ssp_retry_queue WHERE print_id = ?')
              .get(printId);
            expect(row).toBeUndefined();
          } finally {
            db.close();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


// --- Property 7: Queue survives restart (round-trip persistence) ---

/**
 * Tag: Feature: 07-player-reingenieria-estabilizacion, Property 7: Queue survives restart (round-trip persistence)
 *
 * **Validates: Requirements 3.2**
 *
 * For any set of queue entries persisted in SQLite, creating a new SspRetryQueue
 * instance with the same database SHALL recover all entries with their original
 * print_id, operation_type, url, created_at, and attempts values intact.
 */
describe('Feature: 07-player-reingenieria-estabilizacion, Property 7: Queue survives restart (round-trip persistence)', () => {
  it('all entries persist across SspRetryQueue instances (simulating player restart)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            printId: arbPrintId,
            operationType: arbOperationType,
            url: arbUrl,
            attempts: arbAttempts,
          }),
          { minLength: 1, maxLength: 10 }
        ),
        async (entries) => {
          const db = createTestDb();

          try {
            const mockClient = createMockSspClient();

            // Instance #1: creates the table
            const _instance1 = new SspRetryQueue(db, mockClient);

            // Insert N rows directly into SQLite with generated data
            const insertStmt = db.prepare(`
              INSERT INTO ssp_retry_queue (print_id, operation_type, url, created_at, last_attempt_at, attempts)
              VALUES (?, ?, ?, ?, ?, ?)
            `);

            const insertedRows: Array<{
              print_id: string;
              operation_type: string;
              url: string;
              created_at: string;
              attempts: number;
            }> = [];

            for (let i = 0; i < entries.length; i++) {
              const entry = entries[i];
              // Use a deterministic created_at based on index to ensure uniqueness
              const createdAt = `2024-01-01 00:00:${String(i).padStart(2, '0')}`;
              const lastAttemptAt = createdAt;

              insertStmt.run(
                entry.printId,
                entry.operationType,
                entry.url,
                createdAt,
                lastAttemptAt,
                entry.attempts
              );

              insertedRows.push({
                print_id: entry.printId,
                operation_type: entry.operationType,
                url: entry.url,
                created_at: createdAt,
                attempts: entry.attempts,
              });
            }

            // Instance #2: simulating restart with the SAME database
            const instance2 = new SspRetryQueue(db, mockClient);

            // PROPERTY: instance2 recovers all N entries
            expect(instance2.getPendingCount()).toBe(entries.length);

            // Read all rows from DB and compare with original inserted rows
            const recoveredRows = db
              .prepare('SELECT print_id, operation_type, url, created_at, attempts FROM ssp_retry_queue ORDER BY created_at ASC')
              .all() as Array<{
                print_id: string;
                operation_type: string;
                url: string;
                created_at: string;
                attempts: number;
              }>;

            // PROPERTY: All rows recovered match original inserted rows exactly
            expect(recoveredRows).toHaveLength(insertedRows.length);

            for (let i = 0; i < insertedRows.length; i++) {
              expect(recoveredRows[i].print_id).toBe(insertedRows[i].print_id);
              expect(recoveredRows[i].operation_type).toBe(insertedRows[i].operation_type);
              expect(recoveredRows[i].url).toBe(insertedRows[i].url);
              expect(recoveredRows[i].created_at).toBe(insertedRows[i].created_at);
              expect(recoveredRows[i].attempts).toBe(insertedRows[i].attempts);
            }
          } finally {
            db.close();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


// --- Property 9: FIFO processing by timestamp regardless of type ---

/**
 * Tag: Feature: 07-player-reingenieria-estabilizacion, Property 9: FIFO processing by timestamp regardless of type
 *
 * **Validates: Requirements 5.1, 5.2**
 *
 * For any set of queue entries with distinct created_at timestamps and mixed operation types,
 * the flush SHALL process them in ascending created_at order, with operation_type having no
 * effect on ordering.
 */
describe('Feature: 07-player-reingenieria-estabilizacion, Property 9: FIFO processing by timestamp regardless of type', () => {
  it('flush processes entries in ascending created_at order regardless of operation_type or insertion order', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 10 }),
        fc.infiniteStream(fc.constantFrom<'proof_of_play' | 'expiration'>('proof_of_play', 'expiration')),
        async (entryCount, operationTypeStream) => {
          const db = createTestDb();

          try {
            // Track the order of calls made by flush
            const callOrder: string[] = [];

            // Generate entries with distinct timestamps
            const baseTime = new Date('2024-01-01T00:00:00Z').getTime();
            const entries: Array<{ printId: string; operationType: 'proof_of_play' | 'expiration'; createdAt: string }> = [];

            for (let i = 0; i < entryCount; i++) {
              const createdAtMs = baseTime + i * 60_000; // 60s apart for distinct timestamps
              const createdAt = new Date(createdAtMs).toISOString().replace('T', ' ').slice(0, 19);
              const operationType = operationTypeStream.next().value!;
              entries.push({
                printId: `print-${i}-${Date.now()}`,
                operationType,
                createdAt,
              });
            }

            // Expected order is by ascending created_at (which is the original index order)
            const expectedOrder = entries.map((e) => e.printId);

            // Shuffle entries before inserting to prove ordering comes from created_at, not insertion order
            const shuffled = [...entries];
            for (let i = shuffled.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }

            // Create a mock SspClient that records the order of calls by printId
            const mockClient = createMockSspClient({
              proofOfPlay: vi.fn().mockImplementation(async (printId: string) => {
                callOrder.push(printId);
              }),
              expireAd: vi.fn().mockImplementation(async (printId: string) => {
                callOrder.push(printId);
              }),
            });

            // Create queue with minimal backoff (1ms) so all entries are eligible
            const queue = new SspRetryQueue(db, mockClient, {
              baseBackoffMs: 1,
              maxBackoffMs: 1,
            });

            // Insert entries in shuffled order with last_attempt_at far in the past (backoff elapsed)
            const farPast = '2020-01-01 00:00:00';
            for (const entry of shuffled) {
              db.prepare(`
                INSERT INTO ssp_retry_queue (print_id, operation_type, url, created_at, last_attempt_at, attempts)
                VALUES (?, ?, ?, ?, ?, 1)
              `).run(entry.printId, entry.operationType, `https://ssp.example.com/${entry.printId}`, entry.createdAt, farPast);
            }

            // Call flush — should process all entries
            await queue.flush();

            // PROPERTY: The call order matches ascending created_at order, NOT insertion order
            expect(callOrder).toEqual(expectedOrder);

            // PROPERTY: All entries were processed (queue is empty after success)
            expect(queue.getPendingCount()).toBe(0);
          } finally {
            db.close();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
