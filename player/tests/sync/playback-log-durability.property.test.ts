/**
 * Property-based test: Playback Log Durability
 *
 * Simulates random playback events and random sync failure patterns,
 * verifying that no log entries are ever lost regardless of sync outcome.
 * When sync fails (network error or non-ok response), entries remain
 * unsynced and are never deleted. Only entries explicitly acknowledged
 * via ack_ids get marked as synced.
 *
 * **Validates: Requirements 18.5**
 *
 * Requirement 18.5: Batch sync to backend periodically; mark entries as
 *                   synced only after backend acknowledgment. Unsynced entries
 *                   must never be lost even on sync failures.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import Database from 'better-sqlite3';
import { PlaybackLogger } from '../../src/sync/PlaybackLogger';
import type { PlaybackEvent, PlaybackLogSyncClient, PlaybackLogsResponse } from '../../src/sync/PlaybackLogger';

// --- Helpers ---

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS playback_log (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('prodooh', 'gam', 'url', 'playlist')),
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      duration_seconds REAL NOT NULL,
      result TEXT NOT NULL CHECK(result IN ('success', 'failed')),
      failure_reason TEXT,
      synced INTEGER DEFAULT 0
    );
  `);
  return db;
}

/** Arbitrary for source types */
const sourceTypeArb = fc.constantFrom('prodooh' as const, 'gam' as const, 'url' as const, 'playlist' as const);

/** Arbitrary for playback result */
const resultArb = fc.constantFrom('success' as const, 'failed' as const);

/** Arbitrary for a valid Date (no NaN) in 2024 */
const validDateArb = fc.integer({
  min: new Date('2024-01-01T00:00:00Z').getTime(),
  max: new Date('2024-12-31T23:59:59Z').getTime(),
}).map((ts) => new Date(ts));

/** Arbitrary for a single PlaybackEvent with guaranteed valid dates */
const playbackEventArb: fc.Arbitrary<PlaybackEvent> = fc.record({
  contentId: fc.stringMatching(/^[a-z0-9-]{1,20}$/),
  source: sourceTypeArb,
  startedAt: validDateArb,
  endedAt: validDateArb,
  durationSeconds: fc.double({ min: 1, max: 300, noNaN: true }),
  result: resultArb,
  failureReason: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
});

/**
 * Represents a sync failure pattern:
 * - 'network_error': throws an exception (simulates connectivity failure)
 * - 'server_error': returns { ok: false, status: 500 }
 * - 'partial_ack': returns ok but only acknowledges a subset of entries
 * - 'empty_ack': returns ok but acknowledges nothing
 * - 'full_ack': returns ok and acknowledges all entries sent
 */
type SyncOutcome = 'network_error' | 'server_error' | 'partial_ack' | 'empty_ack' | 'full_ack';

const syncOutcomeArb: fc.Arbitrary<SyncOutcome> = fc.constantFrom(
  'network_error',
  'server_error',
  'partial_ack',
  'empty_ack',
  'full_ack'
);

/**
 * Creates a mock sync client that behaves according to a predetermined outcome.
 * Tracks which IDs were sent to it so we can verify durability.
 */
function createOutcomeClient(
  outcome: SyncOutcome
): PlaybackLogSyncClient & { sentIds: string[] } {
  const sentIds: string[] = [];

  const client: PlaybackLogSyncClient & { sentIds: string[] } = {
    sentIds,
    post: async <T>(_path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T | null }> => {
      const logs = (body as { logs: Array<{ id: string }> })?.logs ?? [];
      sentIds.push(...logs.map((l) => l.id));

      switch (outcome) {
        case 'network_error':
          throw new Error('Network timeout');

        case 'server_error':
          return { ok: false, status: 500, data: null };

        case 'partial_ack': {
          // Acknowledge only the first half
          const halfIds = logs.slice(0, Math.max(1, Math.floor(logs.length / 2))).map((l) => l.id);
          return {
            ok: true,
            status: 200,
            data: { received: logs.length, ack_ids: halfIds } as unknown as T,
          };
        }

        case 'empty_ack':
          return {
            ok: true,
            status: 200,
            data: { received: logs.length, ack_ids: [] } as unknown as T,
          };

        case 'full_ack':
          return {
            ok: true,
            status: 200,
            data: { received: logs.length, ack_ids: logs.map((l) => l.id) } as unknown as T,
          };
      }
    },
  };

  return client;
}

describe('Property 21: Playback Log Durability', () => {
  it('no log entries are lost regardless of sync failure patterns', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate 1-20 playback events
        fc.array(playbackEventArb, { minLength: 1, maxLength: 20 }),
        // Generate a sequence of 1-5 sync outcomes (simulating multiple sync attempts)
        fc.array(syncOutcomeArb, { minLength: 1, maxLength: 5 }),
        async (events, syncOutcomes) => {
          const db = createTestDb();

          try {
            // Record all events first (local-first persistence)
            const recordedIds: string[] = [];
            const logger = new PlaybackLogger(db, null); // no client initially

            for (const event of events) {
              const id = logger.record(event);
              recordedIds.push(id);
            }

            // Verify all events are persisted locally
            const totalAfterRecord = logger.getTotalCount();
            expect(totalAfterRecord).toBe(events.length);

            // Now simulate multiple sync attempts with varying outcomes
            for (const outcome of syncOutcomes) {
              const client = createOutcomeClient(outcome);
              const syncLogger = new PlaybackLogger(db, client);
              await syncLogger.sync();
            }

            // PROPERTY: Total entries in the database must ALWAYS equal the number
            // of recorded events. No entries are ever deleted.
            const totalAfterSync = db
              .prepare('SELECT COUNT(*) as count FROM playback_log')
              .get() as { count: number };
            expect(totalAfterSync.count).toBe(events.length);

            // PROPERTY: Every recorded ID must still exist in the database
            for (const id of recordedIds) {
              const row = db.prepare('SELECT id FROM playback_log WHERE id = ?').get(id);
              expect(row).toBeDefined();
            }

            // PROPERTY: Unsynced count + synced count = total count (conservation)
            const unsyncedCount = db
              .prepare('SELECT COUNT(*) as count FROM playback_log WHERE synced = 0')
              .get() as { count: number };
            const syncedCount = db
              .prepare('SELECT COUNT(*) as count FROM playback_log WHERE synced = 1')
              .get() as { count: number };
            expect(unsyncedCount.count + syncedCount.count).toBe(events.length);
          } finally {
            db.close();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('entries remain unsynced after network errors (never lost on failure)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(playbackEventArb, { minLength: 1, maxLength: 15 }),
        // Only failure outcomes
        fc.array(
          fc.constantFrom('network_error' as const, 'server_error' as const),
          { minLength: 1, maxLength: 5 }
        ),
        async (events, failureOutcomes) => {
          const db = createTestDb();

          try {
            const logger = new PlaybackLogger(db, null);
            const recordedIds: string[] = [];

            for (const event of events) {
              recordedIds.push(logger.record(event));
            }

            // Attempt multiple syncs, all of which fail
            for (const outcome of failureOutcomes) {
              const client = createOutcomeClient(outcome);
              const syncLogger = new PlaybackLogger(db, client);
              await syncLogger.sync();
            }

            // PROPERTY: After only failures, ALL entries must remain unsynced
            const unsyncedCount = db
              .prepare('SELECT COUNT(*) as count FROM playback_log WHERE synced = 0')
              .get() as { count: number };
            expect(unsyncedCount.count).toBe(events.length);

            // PROPERTY: No entries were deleted
            expect(logger.getTotalCount()).toBe(events.length);
          } finally {
            db.close();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('only explicitly acknowledged entries get marked as synced (partial ack preserves rest)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(playbackEventArb, { minLength: 2, maxLength: 20 }),
        async (events) => {
          const db = createTestDb();

          try {
            const logger = new PlaybackLogger(db, null);

            for (const event of events) {
              logger.record(event);
            }

            // Create a client that acknowledges only the first half of what it receives
            const client = createOutcomeClient('partial_ack');
            const syncLogger = new PlaybackLogger(db, client);
            await syncLogger.sync();

            // PROPERTY: Total count is unchanged (no entries lost)
            const totalCount = db
              .prepare('SELECT COUNT(*) as count FROM playback_log')
              .get() as { count: number };
            expect(totalCount.count).toBe(events.length);

            // PROPERTY: Synced entries count is at most half of what was sent
            const syncedRows = db
              .prepare('SELECT id FROM playback_log WHERE synced = 1')
              .all() as { id: string }[];
            const batchSize = Math.min(events.length, 50); // default batch
            const expectedAckCount = Math.max(1, Math.floor(batchSize / 2));
            expect(syncedRows.length).toBe(expectedAckCount);

            // PROPERTY: Conservation — synced + unsynced = total
            const unsyncedRows = db
              .prepare('SELECT id FROM playback_log WHERE synced = 0')
              .all() as { id: string }[];
            expect(unsyncedRows.length + syncedRows.length).toBe(events.length);
          } finally {
            db.close();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('interleaved record and sync operations never lose entries', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a sequence of operations: either record an event or attempt a sync
        fc.array(
          fc.oneof(
            { weight: 3, arbitrary: playbackEventArb.map((e) => ({ type: 'record' as const, event: e })) },
            { weight: 2, arbitrary: syncOutcomeArb.map((o) => ({ type: 'sync' as const, outcome: o })) }
          ),
          { minLength: 3, maxLength: 30 }
        ),
        async (operations) => {
          const db = createTestDb();

          try {
            let totalRecorded = 0;
            const allIds: string[] = [];

            for (const op of operations) {
              if (op.type === 'record') {
                const logger = new PlaybackLogger(db, null);
                const id = logger.record(op.event);
                allIds.push(id);
                totalRecorded++;
              } else {
                const client = createOutcomeClient(op.outcome);
                const syncLogger = new PlaybackLogger(db, client);
                await syncLogger.sync();
              }
            }

            // PROPERTY: Total entries in DB equals total recorded (never lost)
            const totalCount = db
              .prepare('SELECT COUNT(*) as count FROM playback_log')
              .get() as { count: number };
            expect(totalCount.count).toBe(totalRecorded);

            // PROPERTY: Every ID we recorded still exists
            for (const id of allIds) {
              const row = db.prepare('SELECT id FROM playback_log WHERE id = ?').get(id);
              expect(row).toBeDefined();
            }

            // PROPERTY: Conservation law holds
            const unsynced = db
              .prepare('SELECT COUNT(*) as count FROM playback_log WHERE synced = 0')
              .get() as { count: number };
            const synced = db
              .prepare('SELECT COUNT(*) as count FROM playback_log WHERE synced = 1')
              .get() as { count: number };
            expect(unsynced.count + synced.count).toBe(totalRecorded);
          } finally {
            db.close();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
