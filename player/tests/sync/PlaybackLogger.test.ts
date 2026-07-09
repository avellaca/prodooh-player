import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { PlaybackLogger } from '../../src/sync/PlaybackLogger';
import type { PlaybackEvent, PlaybackLogRow, PlaybackLogSyncClient } from '../../src/sync/PlaybackLogger';

/**
 * Tests for PlaybackLogger — Local recording + batch sync.
 * Validates: Requirements 18.1, 18.2, 18.5
 */

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

function makeEvent(overrides?: Partial<PlaybackEvent>): PlaybackEvent {
  return {
    contentId: 'content-001',
    source: 'prodooh',
    startedAt: new Date('2024-06-01T10:00:00Z'),
    endedAt: new Date('2024-06-01T10:00:10Z'),
    durationSeconds: 10,
    result: 'success',
    ...overrides,
  };
}

function createMockClient(response?: { ok: boolean; status: number; data: unknown }): PlaybackLogSyncClient {
  return {
    post: vi.fn().mockResolvedValue(response ?? { ok: true, status: 200, data: { received: 1, ack_ids: [] } }),
  };
}

describe('PlaybackLogger', () => {
  let db: Database.Database;
  let logger: PlaybackLogger;

  beforeEach(() => {
    db = createTestDb();
    logger = new PlaybackLogger(db);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    logger.stopPeriodicSync();
    db.close();
  });

  describe('record', () => {
    it('should persist a playback event to SQLite immediately', () => {
      const id = logger.record(makeEvent());

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);

      const row = db.prepare('SELECT * FROM playback_log WHERE id = ?').get(id) as PlaybackLogRow;
      expect(row).toBeDefined();
      expect(row.content_id).toBe('content-001');
      expect(row.source).toBe('prodooh');
      expect(row.started_at).toBe('2024-06-01T10:00:00.000Z');
      expect(row.ended_at).toBe('2024-06-01T10:00:10.000Z');
      expect(row.duration_seconds).toBe(10);
      expect(row.result).toBe('success');
      expect(row.failure_reason).toBeNull();
      expect(row.synced).toBe(0);
    });

    it('should record all required fields per Req 18.1', () => {
      const event: PlaybackEvent = {
        contentId: 'ad-xyz',
        source: 'gam',
        startedAt: new Date('2024-06-01T12:00:00Z'),
        endedAt: new Date('2024-06-01T12:00:30Z'),
        durationSeconds: 30,
        result: 'failed',
        failureReason: 'Timeout loading VAST',
      };

      const id = logger.record(event);
      const row = db.prepare('SELECT * FROM playback_log WHERE id = ?').get(id) as PlaybackLogRow;

      expect(row.content_id).toBe('ad-xyz');
      expect(row.source).toBe('gam');
      expect(row.started_at).toBe('2024-06-01T12:00:00.000Z');
      expect(row.ended_at).toBe('2024-06-01T12:00:30.000Z');
      expect(row.duration_seconds).toBe(30);
      expect(row.result).toBe('failed');
      expect(row.failure_reason).toBe('Timeout loading VAST');
    });

    it('should generate unique IDs for each record', () => {
      const id1 = logger.record(makeEvent());
      const id2 = logger.record(makeEvent());
      const id3 = logger.record(makeEvent());

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it('should mark entries as unsynced (synced=0) by default', () => {
      const id = logger.record(makeEvent());
      const row = db.prepare('SELECT synced FROM playback_log WHERE id = ?').get(id) as { synced: number };
      expect(row.synced).toBe(0);
    });

    it('should support all source types', () => {
      const sources: Array<'prodooh' | 'gam' | 'url' | 'playlist'> = ['prodooh', 'gam', 'url', 'playlist'];
      for (const source of sources) {
        const id = logger.record(makeEvent({ source }));
        const row = db.prepare('SELECT source FROM playback_log WHERE id = ?').get(id) as { source: string };
        expect(row.source).toBe(source);
      }
    });

    it('should handle failure_reason as optional (null when absent)', () => {
      const id = logger.record(makeEvent({ failureReason: undefined }));
      const row = db.prepare('SELECT failure_reason FROM playback_log WHERE id = ?').get(id) as { failure_reason: string | null };
      expect(row.failure_reason).toBeNull();
    });
  });

  describe('getUnsynced', () => {
    it('should return empty array when no unsynced entries', () => {
      expect(logger.getUnsynced()).toEqual([]);
    });

    it('should return unsynced entries in order of started_at', () => {
      logger.record(makeEvent({ contentId: 'c2', startedAt: new Date('2024-06-01T10:00:20Z') }));
      logger.record(makeEvent({ contentId: 'c1', startedAt: new Date('2024-06-01T10:00:10Z') }));
      logger.record(makeEvent({ contentId: 'c3', startedAt: new Date('2024-06-01T10:00:30Z') }));

      const unsynced = logger.getUnsynced();
      expect(unsynced).toHaveLength(3);
      expect(unsynced[0]!.content_id).toBe('c1');
      expect(unsynced[1]!.content_id).toBe('c2');
      expect(unsynced[2]!.content_id).toBe('c3');
    });

    it('should not return entries already synced', () => {
      const id = logger.record(makeEvent());
      logger.markSynced([id]);

      expect(logger.getUnsynced()).toHaveLength(0);
    });

    it('should respect the batch size limit', () => {
      for (let i = 0; i < 10; i++) {
        logger.record(makeEvent({ contentId: `content-${i}` }));
      }

      const unsynced = logger.getUnsynced(3);
      expect(unsynced).toHaveLength(3);
    });
  });

  describe('getUnsyncedCount', () => {
    it('should return 0 when no entries', () => {
      expect(logger.getUnsyncedCount()).toBe(0);
    });

    it('should return the count of unsynced entries', () => {
      logger.record(makeEvent());
      logger.record(makeEvent());
      expect(logger.getUnsyncedCount()).toBe(2);
    });

    it('should not count synced entries', () => {
      const id1 = logger.record(makeEvent());
      logger.record(makeEvent());
      logger.markSynced([id1]);
      expect(logger.getUnsyncedCount()).toBe(1);
    });
  });

  describe('markSynced', () => {
    it('should mark specified entries as synced', () => {
      const id1 = logger.record(makeEvent());
      const id2 = logger.record(makeEvent());

      logger.markSynced([id1]);

      const row1 = db.prepare('SELECT synced FROM playback_log WHERE id = ?').get(id1) as { synced: number };
      const row2 = db.prepare('SELECT synced FROM playback_log WHERE id = ?').get(id2) as { synced: number };
      expect(row1.synced).toBe(1);
      expect(row2.synced).toBe(0);
    });

    it('should handle empty ids array gracefully', () => {
      logger.record(makeEvent());
      logger.markSynced([]);
      expect(logger.getUnsyncedCount()).toBe(1);
    });

    it('should only mark entries present in ack_ids (Req 18.5)', () => {
      const id1 = logger.record(makeEvent());
      const id2 = logger.record(makeEvent());
      const id3 = logger.record(makeEvent());

      // Backend only acknowledges id1 and id3
      logger.markSynced([id1, id3]);

      const row1 = db.prepare('SELECT synced FROM playback_log WHERE id = ?').get(id1) as { synced: number };
      const row2 = db.prepare('SELECT synced FROM playback_log WHERE id = ?').get(id2) as { synced: number };
      const row3 = db.prepare('SELECT synced FROM playback_log WHERE id = ?').get(id3) as { synced: number };
      expect(row1.synced).toBe(1);
      expect(row2.synced).toBe(0);
      expect(row3.synced).toBe(1);
    });
  });

  describe('sync', () => {
    it('should return -1 when no client is configured', async () => {
      logger.record(makeEvent());
      const result = await logger.sync();
      expect(result).toBe(-1);
    });

    it('should return 0 when no unsynced entries exist', async () => {
      const client = createMockClient();
      const loggerWithClient = new PlaybackLogger(db, client);
      const result = await loggerWithClient.sync();
      expect(result).toBe(0);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('should POST unsynced entries to the backend', async () => {
      const client = createMockClient({
        ok: true,
        status: 200,
        data: { received: 1, ack_ids: [] },
      });
      const loggerWithClient = new PlaybackLogger(db, client);
      loggerWithClient.record(makeEvent({ contentId: 'test-content' }));

      await loggerWithClient.sync();

      expect(client.post).toHaveBeenCalledTimes(1);
      const callArgs = (client.post as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(callArgs[0]).toBe('/api/device/playback-logs');
      const body = callArgs[1] as { logs: Array<Record<string, unknown>> };
      expect(body.logs).toHaveLength(1);
      expect(body.logs[0]!.content_id).toBe('test-content');
      expect(body.logs[0]!.source).toBe('prodooh');
    });

    it('should mark entries synced only after backend acknowledgment (Req 18.5)', async () => {
      const id1 = 'will-be-set';
      const client = createMockClient();
      const loggerWithClient = new PlaybackLogger(db, client);

      const recordedId = loggerWithClient.record(makeEvent());

      // Backend acknowledges the entry
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        data: { received: 1, ack_ids: [recordedId] },
      });

      await loggerWithClient.sync();

      const row = db.prepare('SELECT synced FROM playback_log WHERE id = ?').get(recordedId) as { synced: number };
      expect(row.synced).toBe(1);
    });

    it('should NOT mark entries synced if backend does not acknowledge them', async () => {
      const client = createMockClient({
        ok: true,
        status: 200,
        data: { received: 0, ack_ids: [] },
      });
      const loggerWithClient = new PlaybackLogger(db, client);
      const recordedId = loggerWithClient.record(makeEvent());

      await loggerWithClient.sync();

      const row = db.prepare('SELECT synced FROM playback_log WHERE id = ?').get(recordedId) as { synced: number };
      expect(row.synced).toBe(0);
    });

    it('should return -1 on network failure (entries remain unsynced)', async () => {
      const client: PlaybackLogSyncClient = {
        post: vi.fn().mockRejectedValue(new Error('Network error')),
      };
      const loggerWithClient = new PlaybackLogger(db, client);
      loggerWithClient.record(makeEvent());

      const result = await loggerWithClient.sync();
      expect(result).toBe(-1);
      expect(loggerWithClient.getUnsyncedCount()).toBe(1);
    });

    it('should return -1 on non-ok response', async () => {
      const client = createMockClient({ ok: false, status: 500, data: null });
      const loggerWithClient = new PlaybackLogger(db, client);
      loggerWithClient.record(makeEvent());

      const result = await loggerWithClient.sync();
      expect(result).toBe(-1);
      expect(loggerWithClient.getUnsyncedCount()).toBe(1);
    });

    it('should send entries in correct API format', async () => {
      const client = createMockClient({
        ok: true,
        status: 200,
        data: { received: 1, ack_ids: [] },
      });
      const loggerWithClient = new PlaybackLogger(db, client);
      loggerWithClient.record(makeEvent({
        contentId: 'content-abc',
        source: 'gam',
        startedAt: new Date('2024-06-15T08:00:00Z'),
        endedAt: new Date('2024-06-15T08:00:15Z'),
        durationSeconds: 15,
        result: 'failed',
        failureReason: 'VAST timeout',
      }));

      await loggerWithClient.sync();

      const body = (client.post as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {
        logs: Array<Record<string, unknown>>;
      };
      const log = body.logs[0]!;
      expect(log.content_id).toBe('content-abc');
      expect(log.source).toBe('gam');
      expect(log.started_at).toBe('2024-06-15T08:00:00.000Z');
      expect(log.ended_at).toBe('2024-06-15T08:00:15.000Z');
      expect(log.duration_seconds).toBe(15);
      expect(log.result).toBe('failed');
      expect(log.failure_reason).toBe('VAST timeout');
    });

    it('should not include failure_reason when absent', async () => {
      const client = createMockClient({
        ok: true,
        status: 200,
        data: { received: 1, ack_ids: [] },
      });
      const loggerWithClient = new PlaybackLogger(db, client);
      loggerWithClient.record(makeEvent({ result: 'success', failureReason: undefined }));

      await loggerWithClient.sync();

      const body = (client.post as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {
        logs: Array<Record<string, unknown>>;
      };
      expect(body.logs[0]).not.toHaveProperty('failure_reason');
    });

    it('should respect batch size limit when syncing', async () => {
      const client = createMockClient({
        ok: true,
        status: 200,
        data: { received: 3, ack_ids: [] },
      });
      const loggerWithClient = new PlaybackLogger(db, client, { batchSize: 3 });

      for (let i = 0; i < 5; i++) {
        loggerWithClient.record(makeEvent({ contentId: `content-${i}` }));
      }

      await loggerWithClient.sync();

      const body = (client.post as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {
        logs: Array<Record<string, unknown>>;
      };
      expect(body.logs).toHaveLength(3);
    });

    it('should persist locally BEFORE network attempt (Req 18.2)', async () => {
      // The record() call is synchronous and persists immediately.
      // The sync is a separate async step that reads from SQLite.
      const client: PlaybackLogSyncClient = {
        post: vi.fn().mockImplementation(async () => {
          // At the time of the network call, the entry should already be in SQLite
          const count = db.prepare('SELECT COUNT(*) as count FROM playback_log').get() as { count: number };
          expect(count.count).toBe(1);
          return { ok: true, status: 200, data: { received: 1, ack_ids: [] } };
        }),
      };
      const loggerWithClient = new PlaybackLogger(db, client);

      // Record persists synchronously
      loggerWithClient.record(makeEvent());

      // Verify already in DB before sync
      const countBefore = db.prepare('SELECT COUNT(*) as count FROM playback_log').get() as { count: number };
      expect(countBefore.count).toBe(1);

      // Now sync (network call)
      await loggerWithClient.sync();
    });
  });

  describe('periodic sync', () => {
    it('should start periodic sync', () => {
      vi.useFakeTimers();
      const client = createMockClient();
      const loggerWithClient = new PlaybackLogger(db, client, { syncIntervalMs: 1000 });

      loggerWithClient.startPeriodicSync();
      expect(loggerWithClient.isSyncing()).toBe(true);

      loggerWithClient.stopPeriodicSync();
      vi.useRealTimers();
    });

    it('should stop periodic sync', () => {
      vi.useFakeTimers();
      const client = createMockClient();
      const loggerWithClient = new PlaybackLogger(db, client, { syncIntervalMs: 1000 });

      loggerWithClient.startPeriodicSync();
      loggerWithClient.stopPeriodicSync();
      expect(loggerWithClient.isSyncing()).toBe(false);

      vi.useRealTimers();
    });

    it('should not start multiple timers if called twice', () => {
      vi.useFakeTimers();
      const client = createMockClient();
      const loggerWithClient = new PlaybackLogger(db, client, { syncIntervalMs: 1000 });

      loggerWithClient.startPeriodicSync();
      loggerWithClient.startPeriodicSync(); // second call should be no-op
      expect(loggerWithClient.isSyncing()).toBe(true);

      loggerWithClient.stopPeriodicSync();
      vi.useRealTimers();
    });

    it('should call sync at the configured interval', async () => {
      vi.useFakeTimers();
      const client = createMockClient({
        ok: true,
        status: 200,
        data: { received: 0, ack_ids: [] },
      });
      const loggerWithClient = new PlaybackLogger(db, client, { syncIntervalMs: 5000 });

      loggerWithClient.startPeriodicSync();

      // Advance time by 5 seconds
      vi.advanceTimersByTime(5000);

      // The sync should have been called once
      expect(client.post).not.toHaveBeenCalled(); // no unsynced entries, so no POST

      // Record an entry then advance
      loggerWithClient.record(makeEvent());
      vi.advanceTimersByTime(5000);

      // Now it should have attempted to sync
      expect(client.post).toHaveBeenCalledTimes(1);

      loggerWithClient.stopPeriodicSync();
      vi.useRealTimers();
    });
  });

  describe('getTotalCount', () => {
    it('should return 0 when empty', () => {
      expect(logger.getTotalCount()).toBe(0);
    });

    it('should count all entries regardless of sync status', () => {
      const id1 = logger.record(makeEvent());
      logger.record(makeEvent());
      logger.markSynced([id1]);
      expect(logger.getTotalCount()).toBe(2);
    });
  });
});
