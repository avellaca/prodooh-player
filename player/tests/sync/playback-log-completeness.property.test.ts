/**
 * Property-based test: Playback Log Completeness
 *
 * Generates random playback events with varied parameters and verifies that
 * all required fields are present, non-null, and have the correct types in
 * every persisted log entry.
 *
 * **Validates: Requirements 18.1**
 *
 * Requirement 18.1: Record each playback event with all required fields:
 * content_id, source, timestamps (started_at, ended_at), duration_seconds, and result.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import Database from 'better-sqlite3';
import { PlaybackLogger } from '../../src/sync/PlaybackLogger';
import type { PlaybackEvent, PlaybackLogRow, SourceType, PlaybackResult } from '../../src/sync/PlaybackLogger';

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

/** Arbitrary for a valid SourceType */
const sourceArb: fc.Arbitrary<SourceType> = fc.constantFrom('prodooh', 'gam', 'url', 'playlist');

/** Arbitrary for a valid PlaybackResult */
const resultArb: fc.Arbitrary<PlaybackResult> = fc.constantFrom('success', 'failed');

/** Arbitrary for a non-empty content_id string */
const contentIdArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 100 });

/** Arbitrary for a valid duration in seconds (positive number) */
const durationArb: fc.Arbitrary<number> = fc.double({ min: 0.1, max: 3600, noNaN: true });

/** Arbitrary for a valid timestamp (reasonable range, always valid Date) */
const timestampArb: fc.Arbitrary<Date> = fc.integer({
  min: new Date('2020-01-01T00:00:00Z').getTime(),
  max: new Date('2030-12-31T23:59:59Z').getTime(),
}).map((ms) => new Date(ms));

/** Arbitrary for a complete PlaybackEvent */
const playbackEventArb: fc.Arbitrary<PlaybackEvent> = fc.record({
  contentId: contentIdArb,
  source: sourceArb,
  startedAt: timestampArb,
  endedAt: timestampArb,
  durationSeconds: durationArb,
  result: resultArb,
  failureReason: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
});

describe('Property 20: Playback Log Completeness', () => {
  let db: Database.Database;
  let logger: PlaybackLogger;

  beforeEach(() => {
    db = createTestDb();
    logger = new PlaybackLogger(db);
  });

  afterEach(() => {
    db.close();
  });

  it('every recorded playback event has all required fields present and non-null', () => {
    fc.assert(
      fc.property(playbackEventArb, (event) => {
        const id = logger.record(event);

        // Retrieve the persisted row
        const row = db.prepare('SELECT * FROM playback_log WHERE id = ?').get(id) as PlaybackLogRow;

        // id must be present and non-empty
        expect(row.id).toBeDefined();
        expect(row.id).not.toBeNull();
        expect(row.id.length).toBeGreaterThan(0);

        // content_id must be present and match input
        expect(row.content_id).toBeDefined();
        expect(row.content_id).not.toBeNull();
        expect(row.content_id).toBe(event.contentId);

        // source must be present and be one of the valid source types
        expect(row.source).toBeDefined();
        expect(row.source).not.toBeNull();
        expect(['prodooh', 'gam', 'url', 'playlist']).toContain(row.source);
        expect(row.source).toBe(event.source);

        // started_at must be present and be a valid ISO timestamp
        expect(row.started_at).toBeDefined();
        expect(row.started_at).not.toBeNull();
        expect(new Date(row.started_at).toISOString()).toBe(row.started_at);

        // ended_at must be present and be a valid ISO timestamp
        expect(row.ended_at).toBeDefined();
        expect(row.ended_at).not.toBeNull();
        expect(new Date(row.ended_at).toISOString()).toBe(row.ended_at);

        // duration_seconds must be present and be a positive number
        expect(row.duration_seconds).toBeDefined();
        expect(row.duration_seconds).not.toBeNull();
        expect(typeof row.duration_seconds).toBe('number');
        expect(row.duration_seconds).toBeGreaterThan(0);

        // result must be present and be 'success' or 'failed'
        expect(row.result).toBeDefined();
        expect(row.result).not.toBeNull();
        expect(['success', 'failed']).toContain(row.result);
        expect(row.result).toBe(event.result);
      }),
      { numRuns: 200 }
    );
  });

  it('every recorded event is retrievable via getUnsynced with correct types', () => {
    fc.assert(
      fc.property(
        fc.array(playbackEventArb, { minLength: 1, maxLength: 20 }),
        (events) => {
          // Clear DB for fresh run
          db.exec('DELETE FROM playback_log');

          // Record all events
          const ids = events.map((event) => logger.record(event));

          // Get all unsynced entries
          const unsynced = logger.getUnsynced(events.length);

          // Must have exactly the same number of entries
          expect(unsynced).toHaveLength(events.length);

          // Verify each entry has all required fields with correct types
          for (const row of unsynced) {
            // id: string, non-empty
            expect(typeof row.id).toBe('string');
            expect(row.id.length).toBeGreaterThan(0);

            // content_id: string, non-empty
            expect(typeof row.content_id).toBe('string');
            expect(row.content_id.length).toBeGreaterThan(0);

            // source: one of the valid types
            expect(typeof row.source).toBe('string');
            expect(['prodooh', 'gam', 'url', 'playlist']).toContain(row.source);

            // started_at: valid ISO 8601 string
            expect(typeof row.started_at).toBe('string');
            expect(row.started_at.length).toBeGreaterThan(0);
            const parsedStart = Date.parse(row.started_at);
            expect(Number.isNaN(parsedStart)).toBe(false);

            // ended_at: valid ISO 8601 string
            expect(typeof row.ended_at).toBe('string');
            expect(row.ended_at.length).toBeGreaterThan(0);
            const parsedEnd = Date.parse(row.ended_at);
            expect(Number.isNaN(parsedEnd)).toBe(false);

            // duration_seconds: positive number
            expect(typeof row.duration_seconds).toBe('number');
            expect(row.duration_seconds).toBeGreaterThan(0);

            // result: 'success' or 'failed'
            expect(typeof row.result).toBe('string');
            expect(['success', 'failed']).toContain(row.result);
          }

          // All recorded IDs should appear in the results
          const returnedIds = new Set(unsynced.map((r) => r.id));
          for (const id of ids) {
            expect(returnedIds.has(id)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('generated log IDs are always unique across all recorded events', () => {
    fc.assert(
      fc.property(
        fc.array(playbackEventArb, { minLength: 2, maxLength: 50 }),
        (events) => {
          db.exec('DELETE FROM playback_log');

          const ids = events.map((event) => logger.record(event));

          // All IDs must be unique
          const uniqueIds = new Set(ids);
          expect(uniqueIds.size).toBe(ids.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
