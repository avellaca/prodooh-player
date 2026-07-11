import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ImpressionReporter, ImpressionRecord } from '../../src/sync/ImpressionReporter';
import { BackendApiClient } from '../../src/api/BackendApiClient';
import { JwtRenewer } from '../../src/api/JwtRenewer';

/**
 * Unit tests for ImpressionReporter — local queue + batch flush with backoff.
 * Validates: Requirements 9.3, 9.6
 */

function createTestDb(): Database.Database {
  return new Database(':memory:');
}

function makeImpression(overrides?: Partial<ImpressionRecord>): ImpressionRecord {
  return {
    order_line_id: 'ol-uuid-001',
    creative_id: 'cr-uuid-001',
    started_at: '2024-07-09T12:00:00.000Z',
    ended_at: '2024-07-09T12:00:10.000Z',
    duration_seconds: 10,
    result: 'success',
    ...overrides,
  };
}

describe('ImpressionReporter', () => {
  let db: Database.Database;
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: BackendApiClient;
  let jwtRenewer: JwtRenewer;
  let reporter: ImpressionReporter;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    db = createTestDb();
    client = new BackendApiClient('http://localhost:8000');
    client.setToken('test-token');
    jwtRenewer = new JwtRenewer(client, '/api/device/auth');
    reporter = new ImpressionReporter(client, db, jwtRenewer, {
      baseBackoffMs: 5000,
      maxBackoffMs: 300_000,
    });
  });

  afterEach(() => {
    reporter.stopPeriodicFlush();
    db.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Helper: mock a fetch response */
  function mockFetchResponse(status: number, data: unknown = null): void {
    fetchMock.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => data,
    });
  }

  describe('enqueue stores locally', () => {
    it('should increment getPendingCount after enqueue', () => {
      expect(reporter.getPendingCount()).toBe(0);

      reporter.enqueue(makeImpression());

      expect(reporter.getPendingCount()).toBe(1);
    });

    it('should store the impression data correctly in SQLite', () => {
      const impression = makeImpression({
        order_line_id: 'ol-xyz',
        creative_id: 'cr-abc',
        duration_seconds: 15,
        result: 'failed',
        failure_reason: 'Timeout',
      });

      reporter.enqueue(impression);

      const row = db.prepare('SELECT payload FROM pending_impressions').get() as { payload: string };
      const stored = JSON.parse(row.payload) as ImpressionRecord;
      expect(stored.order_line_id).toBe('ol-xyz');
      expect(stored.creative_id).toBe('cr-abc');
      expect(stored.duration_seconds).toBe(15);
      expect(stored.result).toBe('failed');
      expect(stored.failure_reason).toBe('Timeout');
    });

    it('should accumulate multiple impressions', () => {
      reporter.enqueue(makeImpression({ order_line_id: 'ol-1' }));
      reporter.enqueue(makeImpression({ order_line_id: 'ol-2' }));
      reporter.enqueue(makeImpression({ order_line_id: 'ol-3' }));

      expect(reporter.getPendingCount()).toBe(3);
    });
  });

  describe('flush sends batch and clears on success', () => {
    it('should send all pending impressions and clear queue on 201', async () => {
      reporter.enqueue(makeImpression({ order_line_id: 'ol-1' }));
      reporter.enqueue(makeImpression({ order_line_id: 'ol-2' }));
      reporter.enqueue(makeImpression({ order_line_id: 'ol-3' }));

      expect(reporter.getPendingCount()).toBe(3);

      // Mock 201 Created response
      mockFetchResponse(201, { received: 3 });

      await reporter.flush();

      expect(reporter.getPendingCount()).toBe(0);
    });

    it('should POST to /api/device/impressions with correct payload', async () => {
      reporter.enqueue(makeImpression({ order_line_id: 'ol-test' }));

      mockFetchResponse(201, { received: 1 });

      await reporter.flush();

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('http://localhost:8000/api/device/impressions');
      expect(init.method).toBe('POST');

      const body = JSON.parse(init.body as string);
      expect(body.impressions).toHaveLength(1);
      expect(body.impressions[0].order_line_id).toBe('ol-test');
    });

    it('should not make a request when queue is empty', async () => {
      await reporter.flush();

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('flush preserves on failure', () => {
    it('should keep impressions in queue on 500 response', async () => {
      reporter.enqueue(makeImpression());
      reporter.enqueue(makeImpression());

      mockFetchResponse(500, { error: 'Internal Server Error' });

      await reporter.flush();

      expect(reporter.getPendingCount()).toBe(2);
    });

    it('should keep impressions in queue on network error (status 0)', async () => {
      reporter.enqueue(makeImpression());

      // Simulate network error
      fetchMock.mockRejectedValueOnce(new Error('Network unreachable'));

      await reporter.flush();

      expect(reporter.getPendingCount()).toBe(1);
    });
  });

  describe('backoff exponential', () => {
    it('should start at baseBackoffMs (5000)', () => {
      expect(reporter.getBackoffMs()).toBe(5000);
    });

    it('should double after each failure', async () => {
      reporter.enqueue(makeImpression());

      // First failure
      mockFetchResponse(500, null);
      await reporter.flush();
      expect(reporter.getBackoffMs()).toBe(10000);

      // Second failure
      mockFetchResponse(500, null);
      await reporter.flush();
      expect(reporter.getBackoffMs()).toBe(20000);

      // Third failure
      mockFetchResponse(500, null);
      await reporter.flush();
      expect(reporter.getBackoffMs()).toBe(40000);
    });

    it('should cap at maxBackoffMs (300000)', async () => {
      reporter.enqueue(makeImpression());

      // Fail enough times to exceed max: 5000 → 10000 → 20000 → 40000 → 80000 → 160000 → 320000 → capped 300000
      for (let i = 0; i < 7; i++) {
        mockFetchResponse(500, null);
        await reporter.flush();
      }

      expect(reporter.getBackoffMs()).toBe(300_000);

      // One more failure should still be capped
      mockFetchResponse(500, null);
      await reporter.flush();
      expect(reporter.getBackoffMs()).toBe(300_000);
    });
  });

  describe('backoff resets on success', () => {
    it('should reset backoff to baseBackoffMs after successful flush', async () => {
      reporter.enqueue(makeImpression());

      // Fail a few times
      mockFetchResponse(500, null);
      await reporter.flush();
      expect(reporter.getBackoffMs()).toBe(10000);

      mockFetchResponse(500, null);
      await reporter.flush();
      expect(reporter.getBackoffMs()).toBe(20000);

      // Now succeed
      mockFetchResponse(201, { received: 1 });
      await reporter.flush();
      expect(reporter.getBackoffMs()).toBe(5000);
    });
  });

  describe('only order_line_creative data preserved', () => {
    it('should preserve all ImpressionRecord fields correctly', async () => {
      const impression: ImpressionRecord = {
        order_line_id: 'ol-unique-123',
        creative_id: 'cr-unique-456',
        started_at: '2024-07-09T14:30:00.000Z',
        ended_at: '2024-07-09T14:30:10.000Z',
        duration_seconds: 10,
        result: 'success',
      };

      reporter.enqueue(impression);
      mockFetchResponse(201, { received: 1 });

      await reporter.flush();

      const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      const sent = body.impressions[0];
      expect(sent.order_line_id).toBe('ol-unique-123');
      expect(sent.creative_id).toBe('cr-unique-456');
      expect(sent.started_at).toBe('2024-07-09T14:30:00.000Z');
      expect(sent.ended_at).toBe('2024-07-09T14:30:10.000Z');
      expect(sent.duration_seconds).toBe(10);
      expect(sent.result).toBe('success');
    });

    it('should preserve failure_reason when present', async () => {
      const impression = makeImpression({
        result: 'failed',
        failure_reason: 'Asset load timeout',
      });

      reporter.enqueue(impression);
      mockFetchResponse(201, { received: 1 });

      await reporter.flush();

      const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(body.impressions[0].failure_reason).toBe('Asset load timeout');
    });

    it('should only accept ImpressionRecord structure (order_line_id + creative_id required)', () => {
      // This test verifies the interface enforces order_line_creative data shape.
      // The type system ensures only ImpressionRecord can be passed to enqueue().
      const impression = makeImpression();
      reporter.enqueue(impression);

      const row = db.prepare('SELECT payload FROM pending_impressions').get() as { payload: string };
      const stored = JSON.parse(row.payload);
      expect(stored).toHaveProperty('order_line_id');
      expect(stored).toHaveProperty('creative_id');
      // No 'type' field — it's the caller's responsibility to only enqueue order_line_creative items
    });
  });

  describe('offline queue — enqueue multiple then flush all in one batch', () => {
    it('should send all queued impressions in a single batch on flush', async () => {
      // Simulate offline: enqueue several without flushing
      reporter.enqueue(makeImpression({ order_line_id: 'ol-1' }));
      reporter.enqueue(makeImpression({ order_line_id: 'ol-2' }));
      reporter.enqueue(makeImpression({ order_line_id: 'ol-3' }));
      reporter.enqueue(makeImpression({ order_line_id: 'ol-4' }));
      reporter.enqueue(makeImpression({ order_line_id: 'ol-5' }));

      expect(reporter.getPendingCount()).toBe(5);

      // Now "recover connection" — flush once
      mockFetchResponse(201, { received: 5 });
      await reporter.flush();

      // All sent in one batch
      expect(fetchMock).toHaveBeenCalledOnce();
      const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(body.impressions).toHaveLength(5);
      expect(body.impressions[0].order_line_id).toBe('ol-1');
      expect(body.impressions[4].order_line_id).toBe('ol-5');

      // Queue cleared
      expect(reporter.getPendingCount()).toBe(0);
    });

    it('should preserve order when flushing queued impressions', async () => {
      reporter.enqueue(makeImpression({ started_at: '2024-07-09T12:00:00.000Z', order_line_id: 'first' }));
      reporter.enqueue(makeImpression({ started_at: '2024-07-09T12:00:10.000Z', order_line_id: 'second' }));
      reporter.enqueue(makeImpression({ started_at: '2024-07-09T12:00:20.000Z', order_line_id: 'third' }));

      mockFetchResponse(201, { received: 3 });
      await reporter.flush();

      const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(body.impressions[0].order_line_id).toBe('first');
      expect(body.impressions[1].order_line_id).toBe('second');
      expect(body.impressions[2].order_line_id).toBe('third');
    });
  });

  describe('startPeriodicFlush / stopPeriodicFlush', () => {
    it('should start a periodic flush timer', () => {
      reporter.enqueue(makeImpression());
      mockFetchResponse(201, { received: 1 });

      reporter.startPeriodicFlush(10000);

      // Advance time to trigger the interval
      vi.advanceTimersByTime(10000);

      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('should stop the periodic flush timer', () => {
      reporter.enqueue(makeImpression());

      reporter.startPeriodicFlush(10000);
      reporter.stopPeriodicFlush();

      // Advance time — should NOT trigger flush
      vi.advanceTimersByTime(20000);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should not start multiple timers if called twice', () => {
      reporter.enqueue(makeImpression());
      mockFetchResponse(201, { received: 1 });
      mockFetchResponse(201, { received: 0 });

      reporter.startPeriodicFlush(10000);
      reporter.startPeriodicFlush(10000); // second call should be no-op

      vi.advanceTimersByTime(10000);

      // Only one flush triggered (not two)
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('should flush periodically at the configured interval', () => {
      reporter.enqueue(makeImpression({ order_line_id: 'ol-periodic' }));

      mockFetchResponse(201, { received: 1 });
      mockFetchResponse(201, { received: 0 });
      mockFetchResponse(201, { received: 0 });

      reporter.startPeriodicFlush(5000);

      vi.advanceTimersByTime(5000);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(5000);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(5000);
      expect(fetchMock).toHaveBeenCalledTimes(3);

      reporter.stopPeriodicFlush();
    });
  });
});
