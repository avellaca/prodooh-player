import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BackendApi } from '../../src/api/BackendApi';
import { BackendApiClient } from '../../src/api/BackendApiClient';
import { HeartbeatService } from '../../src/sync/HeartbeatService';
import type { DeviceStatusProvider, CommandHandler, DeviceCommand } from '../../src/sync/HeartbeatService';
import { PlaybackLogger } from '../../src/sync/PlaybackLogger';
import type { PlaybackLogSyncClient } from '../../src/sync/PlaybackLogger';
import { PlaylistSyncManager } from '../../src/sync/PlaylistSyncManager';
import type { MediaDownloader, PlaylistManifest } from '../../src/sync/PlaylistSyncManager';
import type { TokenStore } from '../../src/api/BackendApi';
import Database from 'better-sqlite3';

/**
 * Integration tests for player ↔ backend communication.
 * Tests the full communication lifecycle: auth → config sync → heartbeat →
 * playlist sync → playback logs. Also tests offline behavior including
 * queue accumulation and eventual delivery.
 *
 * Validates: Requirements 1.2, 8.1, 9.2, 18.2
 */

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createTestJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const signature = btoa('fake-signature');
  return `${header}.${body}.${signature}`;
}

function createJwtWithExp(expSeconds: number): string {
  return createTestJwt({ sub: 'screen-123', tenant_id: 'tenant-001', exp: expSeconds });
}

function createMemoryTokenStore(): TokenStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get(key: string): string | null {
      return data.get(key) ?? null;
    },
    set(key: string, value: string): void {
      data.set(key, value);
    },
  };
}

function createMockStatusProvider(): DeviceStatusProvider {
  return {
    getVenueId: () => 'venue-001',
    getCurrentContent: () => ({ id: 'content-abc', source: 'playlist' as const }),
    getStorageStatus: () => ({ total_mb: 32000, available_mb: 15000, percent_used: 53 }),
    getUptimeSeconds: () => 7200,
    getPlaylistVersion: () => 'v2.0.0',
  };
}

function createMockDownloader(): MediaDownloader {
  return {
    download: vi.fn(async (_url: string, itemId: string) => `/media/${itemId}.mp4`),
    computeChecksum: vi.fn(async () => 'abc123checksum'),
  };
}

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS playlist (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS playlist_items (
      id TEXT PRIMARY KEY,
      playlist_id TEXT NOT NULL,
      type TEXT NOT NULL,
      media_path TEXT,
      url TEXT,
      duration_seconds INTEGER,
      position INTEGER NOT NULL,
      rotation INTEGER DEFAULT 0,
      refresh_interval INTEGER,
      checksum TEXT,
      download_status TEXT DEFAULT 'pending'
    );
    CREATE TABLE IF NOT EXISTS playback_log (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL,
      source TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      duration_seconds REAL NOT NULL,
      result TEXT NOT NULL,
      failure_reason TEXT,
      synced INTEGER DEFAULT 0
    );
  `);
  return db;
}

// ─── Mock fetch router ───────────────────────────────────────────────────────

interface MockRoute {
  method: string;
  path: string;
  handler: (body?: unknown, headers?: Record<string, string>) => {
    status: number;
    data: unknown;
  };
}

class MockBackendServer {
  private routes: MockRoute[] = [];
  private _callLog: Array<{ method: string; path: string; body: unknown; headers: Record<string, string> }> = [];
  private _online = true;

  get callLog() {
    return this._callLog;
  }

  setOnline(online: boolean) {
    this._online = online;
  }

  addRoute(method: string, path: string, handler: MockRoute['handler']) {
    // Replace existing route if one exists for the same method+path
    const existingIndex = this.routes.findIndex(r => r.method === method && r.path === path);
    if (existingIndex >= 0) {
      this.routes[existingIndex] = { method, path, handler };
    } else {
      this.routes.push({ method, path, handler });
    }
  }

  createFetchMock() {
    return async (url: string, init?: RequestInit): Promise<Response> => {
      if (!this._online) {
        throw new TypeError('Failed to fetch');
      }

      const method = init?.method ?? 'GET';
      const urlPath = new URL(url).pathname;
      let body: unknown = undefined;
      if (init?.body) {
        body = JSON.parse(init.body as string);
      }
      const headers: Record<string, string> = {};
      if (init?.headers && typeof init.headers === 'object') {
        for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
          headers[k.toLowerCase()] = v;
        }
      }

      this._callLog.push({ method, path: urlPath, body, headers });

      const route = this.routes.find(r => r.method === method && r.path === urlPath);
      if (!route) {
        return new Response(JSON.stringify({ error: 'Not Found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }

      const result = route.handler(body, headers);
      return new Response(JSON.stringify(result.data), {
        status: result.status,
        headers: { 'content-type': 'application/json' },
      });
    };
  }
}

// ─── Integration Tests ───────────────────────────────────────────────────────

describe('Player ↔ Backend Communication Integration', () => {
  let server: MockBackendServer;
  let db: Database.Database;
  let jwt: string;
  const expTime = Math.floor(Date.now() / 1000) + 3600;

  beforeEach(() => {
    server = new MockBackendServer();
    db = createTestDb();
    jwt = createJwtWithExp(expTime);
    vi.useFakeTimers();
    vi.stubGlobal('fetch', server.createFetchMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    db.close();
  });

  // ─── Full Communication Lifecycle ──────────────────────────────────────────

  describe('Full communication lifecycle (Req 1.2, 8.1, 9.2, 18.2)', () => {
    it('should complete auth → config sync → heartbeat → playlist sync → playback logs', async () => {
      // 1. Setup mock routes for the entire flow
      server.addRoute('POST', '/api/device/auth', (body) => {
        const b = body as { device_token: string; venue_id: string };
        if (b.device_token === 'valid-token' && b.venue_id === 'venue-001') {
          return { status: 200, data: { access_token: jwt, expires_in: 3600 } };
        }
        return { status: 401, data: { error: 'Unauthorized' } };
      });

      server.addRoute('GET', '/api/device/config', () => ({
        status: 200,
        data: {
          venue_id: 'venue-001',
          tenant_id: 'tenant-001',
          loop: {
            slots: [
              { position: 0, source: 'prodooh', duration: 10 },
              { position: 1, source: 'gam', duration: 10 },
              { position: 2, source: 'url', duration: 10 },
              { position: 3, source: 'playlist', duration: 10 },
            ],
            total_duration: 40,
          },
          sources: {
            prodooh: { enabled: true, api_key: 'key-1', network_id: 'net-1' },
            gam: { enabled: true, ad_tag_url: 'https://pubads.g.doubleclick.net/test' },
            url: { enabled: true, urls: [{ url: 'https://example.com', duration: 10 }] },
            playlist: { enabled: true },
          },
          display: { resolution: { width: 1920, height: 1080 }, orientation: 'landscape', transition: { type: 'fade', duration_ms: 500 } },
          schedule: null,
          content_duration: { default_seconds: 10, source: 'tenant' },
          sync_interval_seconds: 300,
          heartbeat_interval_seconds: 60,
        },
      }));

      server.addRoute('POST', '/api/device/heartbeat', () => ({
        status: 200,
        data: { ack: true, pending_commands: [] },
      }));

      server.addRoute('GET', '/api/device/playlist', () => ({
        status: 200,
        data: {
          version: 'v2.0.0',
          etag: 'etag-v2',
          items: [
            { id: 'item-1', type: 'image', url: 'https://cdn.example.com/img1.jpg', duration: 10, checksum: 'abc123checksum' },
            { id: 'item-2', type: 'video', url: 'https://cdn.example.com/vid1.mp4', duration: 15, checksum: 'abc123checksum' },
          ],
        },
      }));

      server.addRoute('POST', '/api/device/playlist/confirm', () => ({
        status: 200,
        data: { ack: true },
      }));

      server.addRoute('POST', '/api/device/playback-logs', (body) => {
        const b = body as { logs: Array<{ id: string }> };
        return {
          status: 200,
          data: { received: b.logs.length, ack_ids: b.logs.map(l => l.id) },
        };
      });

      // 2. AUTH: Authenticate with backend
      const api = new BackendApi({
        baseUrl: 'http://localhost:8000',
        venueId: 'venue-001',
        deviceToken: 'valid-token',
      });
      const authResult = await api.authenticate();
      expect(authResult).toBe(true);
      expect(api.isAuthenticated()).toBe(true);

      // 3. CONFIG SYNC: Fetch device config using authenticated client
      const client = api.getClient();
      const configResponse = await client.get('/api/device/config');
      expect(configResponse.ok).toBe(true);
      expect(configResponse.status).toBe(200);
      expect((configResponse.data as any).venue_id).toBe('venue-001');
      expect((configResponse.data as any).loop.slots).toHaveLength(4);

      // 4. HEARTBEAT: Send heartbeat with device status
      const statusProvider = createMockStatusProvider();
      const heartbeatService = new HeartbeatService({ client, statusProvider });
      const heartbeatResult = await heartbeatService.sendHeartbeat();
      expect(heartbeatResult).toEqual([]);

      // 5. PLAYLIST SYNC: Sync playlist from backend
      const downloader = createMockDownloader();
      const syncManager = new PlaylistSyncManager(client, db, downloader);
      const syncResult = await syncManager.sync();
      expect(syncResult).toBe(true);

      // Verify playlist was stored locally
      const items = syncManager.getPlaylistItems();
      expect(items).toHaveLength(2);
      expect(items[0]!.id).toBe('item-1');
      expect(items[1]!.id).toBe('item-2');

      // 6. PLAYBACK LOGS: Record events and batch sync
      const logger = new PlaybackLogger(db, client as PlaybackLogSyncClient);
      const logId1 = logger.record({
        contentId: 'item-1',
        source: 'playlist',
        startedAt: new Date('2024-06-15T10:00:00Z'),
        endedAt: new Date('2024-06-15T10:00:10Z'),
        durationSeconds: 10,
        result: 'success',
      });
      const logId2 = logger.record({
        contentId: 'item-2',
        source: 'playlist',
        startedAt: new Date('2024-06-15T10:00:10Z'),
        endedAt: new Date('2024-06-15T10:00:25Z'),
        durationSeconds: 15,
        result: 'success',
      });

      expect(logger.getUnsyncedCount()).toBe(2);

      const syncedCount = await logger.sync();
      expect(syncedCount).toBe(2);
      expect(logger.getUnsyncedCount()).toBe(0);

      // 7. Verify the full call sequence
      const authCalls = server.callLog.filter(c => c.path === '/api/device/auth');
      const configCalls = server.callLog.filter(c => c.path === '/api/device/config');
      const heartbeatCalls = server.callLog.filter(c => c.path === '/api/device/heartbeat');
      const playlistCalls = server.callLog.filter(c => c.path === '/api/device/playlist');
      const confirmCalls = server.callLog.filter(c => c.path === '/api/device/playlist/confirm');
      const logCalls = server.callLog.filter(c => c.path === '/api/device/playback-logs');

      expect(authCalls).toHaveLength(1);
      expect(configCalls).toHaveLength(1);
      expect(heartbeatCalls).toHaveLength(1);
      expect(playlistCalls).toHaveLength(1);
      expect(confirmCalls).toHaveLength(1);
      expect(logCalls).toHaveLength(1);
    });

    it('should attach Bearer token to all authenticated requests after auth', async () => {
      server.addRoute('POST', '/api/device/auth', () => ({
        status: 200,
        data: { access_token: jwt, expires_in: 3600 },
      }));
      server.addRoute('GET', '/api/device/config', () => ({
        status: 200,
        data: { venue_id: 'venue-001' },
      }));
      server.addRoute('POST', '/api/device/heartbeat', () => ({
        status: 200,
        data: { ack: true, pending_commands: [] },
      }));

      const api = new BackendApi({
        baseUrl: 'http://localhost:8000',
        venueId: 'venue-001',
        deviceToken: 'valid-token',
      });
      await api.authenticate();

      const client = api.getClient();
      await client.get('/api/device/config');
      await client.post('/api/device/heartbeat', { venue_id: 'venue-001' });

      // All requests after auth should have the authorization header
      const authenticatedCalls = server.callLog.filter(c => c.path !== '/api/device/auth');
      for (const call of authenticatedCalls) {
        expect(call.headers['authorization']).toBe(`Bearer ${jwt}`);
      }
    });
  });

  // ─── Auth Flow Tests (Req 1.2) ─────────────────────────────────────────────

  describe('Auth flow (Req 1.2)', () => {
    it('should reject invalid credentials and prevent subsequent operations', async () => {
      server.addRoute('POST', '/api/device/auth', () => ({
        status: 401,
        data: { error: 'Invalid device_token or venue_id' },
      }));

      const api = new BackendApi({
        baseUrl: 'http://localhost:8000',
        venueId: 'venue-001',
        deviceToken: 'wrong-token',
      });
      const result = await api.authenticate();

      expect(result).toBe(false);
      expect(api.isAuthenticated()).toBe(false);
      expect(api.getToken()).toBeNull();
    });

    it('should persist token across sessions via TokenStore', async () => {
      server.addRoute('POST', '/api/device/auth', () => ({
        status: 200,
        data: { access_token: jwt, expires_in: 3600 },
      }));

      const store = createMemoryTokenStore();
      const api1 = new BackendApi({
        baseUrl: 'http://localhost:8000',
        venueId: 'venue-001',
        deviceToken: 'valid-token',
      }, store);
      await api1.authenticate();

      // Simulate restart: create new instance with same store
      const api2 = new BackendApi({
        baseUrl: 'http://localhost:8000',
        venueId: 'venue-001',
        deviceToken: 'valid-token',
      }, store);

      // Should be authenticated without a network call
      expect(api2.isAuthenticated()).toBe(true);
      expect(api2.getToken()).toBe(jwt);
    });
  });

  // ─── Config Sync Tests (Req 8.1) ───────────────────────────────────────────

  describe('Config sync (Req 8.1)', () => {
    it('should fetch full device configuration after authentication', async () => {
      server.addRoute('POST', '/api/device/auth', () => ({
        status: 200,
        data: { access_token: jwt, expires_in: 3600 },
      }));
      server.addRoute('GET', '/api/device/config', () => ({
        status: 200,
        data: {
          venue_id: 'venue-001',
          tenant_id: 'tenant-001',
          loop: { slots: [{ position: 0, source: 'playlist', duration: 10 }], total_duration: 10 },
          sources: { playlist: { enabled: true } },
          display: { resolution: { width: 1920, height: 1080 }, orientation: 'landscape', transition: { type: 'cut', duration_ms: 0 } },
          schedule: { timezone: 'America/Bogota', rules: [{ days: [1, 2, 3, 4, 5], start: '06:00', end: '22:00' }] },
          content_duration: { default_seconds: 10, source: 'tenant' },
          sync_interval_seconds: 300,
          heartbeat_interval_seconds: 60,
        },
      }));

      const api = new BackendApi({
        baseUrl: 'http://localhost:8000',
        venueId: 'venue-001',
        deviceToken: 'valid-token',
      });
      await api.authenticate();
      const config = await api.getClient().get('/api/device/config');

      expect(config.ok).toBe(true);
      const data = config.data as any;
      expect(data.venue_id).toBe('venue-001');
      expect(data.schedule.timezone).toBe('America/Bogota');
      expect(data.heartbeat_interval_seconds).toBe(60);
    });
  });

  // ─── Heartbeat Tests (Req 8.1) ─────────────────────────────────────────────

  describe('Heartbeat (Req 8.1)', () => {
    it('should deliver pending commands from heartbeat response', async () => {
      const screenshotCommand: DeviceCommand = {
        id: 'cmd-screenshot-1',
        type: 'screenshot',
        payload: { quality: 80 },
      };

      server.addRoute('POST', '/api/device/heartbeat', () => ({
        status: 200,
        data: { ack: true, pending_commands: [screenshotCommand] },
      }));

      const client = new BackendApiClient('http://localhost:8000');
      client.setToken(jwt);

      const receivedCommands: DeviceCommand[] = [];
      const commandHandler: CommandHandler = {
        handleCommand: async (cmd) => { receivedCommands.push(cmd); },
      };
      const statusProvider = createMockStatusProvider();
      const service = new HeartbeatService({ client, statusProvider, commandHandler });

      await service.sendHeartbeat();

      expect(receivedCommands).toHaveLength(1);
      expect(receivedCommands[0]!.type).toBe('screenshot');
      expect(receivedCommands[0]!.payload).toEqual({ quality: 80 });
    });

    it('should include storage status and playlist version in heartbeat', async () => {
      let capturedBody: any = null;
      server.addRoute('POST', '/api/device/heartbeat', (body) => {
        capturedBody = body;
        return { status: 200, data: { ack: true, pending_commands: [] } };
      });

      const client = new BackendApiClient('http://localhost:8000');
      client.setToken(jwt);
      const statusProvider = createMockStatusProvider();
      const service = new HeartbeatService({ client, statusProvider });

      await service.sendHeartbeat();

      expect(capturedBody.storage).toEqual({ total_mb: 32000, available_mb: 15000, percent_used: 53 });
      expect(capturedBody.playlist_version).toBe('v2.0.0');
      expect(capturedBody.uptime_seconds).toBe(7200);
    });
  });

  // ─── Playlist Sync Tests (Req 9.2) ─────────────────────────────────────────

  describe('Playlist sync (Req 9.2)', () => {
    it('should adopt new playlist and confirm to backend', async () => {
      let confirmPayload: any = null;
      server.addRoute('GET', '/api/device/playlist', () => ({
        status: 200,
        data: {
          version: 'v3.0.0',
          etag: 'etag-v3',
          items: [
            { id: 'new-item-1', type: 'image', url: 'https://cdn.example.com/new1.jpg', duration: 10, checksum: 'abc123checksum' },
          ],
        },
      }));
      server.addRoute('POST', '/api/device/playlist/confirm', (body) => {
        confirmPayload = body;
        return { status: 200, data: { ack: true } };
      });

      const client = new BackendApiClient('http://localhost:8000');
      client.setToken(jwt);
      const downloader = createMockDownloader();
      const syncManager = new PlaylistSyncManager(client, db, downloader);

      const result = await syncManager.sync();

      expect(result).toBe(true);
      expect(confirmPayload).toEqual({ version: 'v3.0.0', status: 'adopted' });
      expect(syncManager.getPlaylistVersion()).toBe('v3.0.0');
    });

    it('should not update playlist when backend returns 304 (no changes)', async () => {
      // First sync to establish a version
      server.addRoute('GET', '/api/device/playlist', () => ({
        status: 200,
        data: {
          version: 'v1.0.0',
          etag: 'etag-v1',
          items: [{ id: 'item-a', type: 'image', url: 'https://cdn.example.com/a.jpg', duration: 10, checksum: 'abc123checksum' }],
        },
      }));
      server.addRoute('POST', '/api/device/playlist/confirm', () => ({
        status: 200,
        data: { ack: true },
      }));

      const client = new BackendApiClient('http://localhost:8000');
      client.setToken(jwt);
      const downloader = createMockDownloader();
      const syncManager = new PlaylistSyncManager(client, db, downloader);

      await syncManager.sync(); // first sync

      // Change route to return 304
      server.addRoute('GET', '/api/device/playlist', (_body, headers) => {
        if (headers?.['if-none-match'] === 'etag-v1') {
          return { status: 304, data: null };
        }
        return { status: 200, data: { version: 'v1.0.0', etag: 'etag-v1', items: [] } };
      });

      const result = await syncManager.sync();
      expect(result).toBe(false); // No update
      expect(syncManager.getPlaylistVersion()).toBe('v1.0.0'); // Still same version
    });

    it('should revert playlist when confirmation fails (Req 9.3)', async () => {
      // Seed initial playlist
      db.prepare('INSERT INTO playlist (id, version, synced_at) VALUES (?, ?, ?)').run('v1', 'v1.0.0', new Date().toISOString());
      db.prepare('INSERT INTO playlist_items (id, playlist_id, type, media_path, url, duration_seconds, position, rotation, refresh_interval, checksum, download_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        'old-item', 'v1', 'image', '/media/old.jpg', null, 10, 0, 0, null, null, 'ready'
      );

      server.addRoute('GET', '/api/device/playlist', () => ({
        status: 200,
        data: {
          version: 'v2.0.0',
          etag: 'etag-v2',
          items: [{ id: 'new-item', type: 'image', url: 'https://cdn.example.com/new.jpg', duration: 10, checksum: 'abc123checksum' }],
        },
      }));
      // Confirmation fails
      server.addRoute('POST', '/api/device/playlist/confirm', () => ({
        status: 500,
        data: { error: 'Internal Server Error' },
      }));

      const client = new BackendApiClient('http://localhost:8000');
      client.setToken(jwt);
      const downloader = createMockDownloader();
      const syncManager = new PlaylistSyncManager(client, db, downloader);

      const result = await syncManager.sync();

      expect(result).toBe(false);
      // Should have reverted to the old playlist
      const items = syncManager.getPlaylistItems();
      expect(items).toHaveLength(1);
      expect(items[0]!.id).toBe('old-item');
    });
  });

  // ─── Playback Log Batch Tests (Req 18.2) ───────────────────────────────────

  describe('Playback log batch sync (Req 18.2)', () => {
    it('should batch multiple playback events and sync to backend', async () => {
      let receivedLogs: any[] = [];
      server.addRoute('POST', '/api/device/playback-logs', (body) => {
        const b = body as { logs: any[] };
        receivedLogs = b.logs;
        return { status: 200, data: { received: b.logs.length, ack_ids: b.logs.map((l: any) => l.id) } };
      });

      const client = new BackendApiClient('http://localhost:8000');
      client.setToken(jwt);
      const logger = new PlaybackLogger(db, client as PlaybackLogSyncClient);

      // Record several events
      logger.record({ contentId: 'c1', source: 'prodooh', startedAt: new Date('2024-06-15T10:00:00Z'), endedAt: new Date('2024-06-15T10:00:10Z'), durationSeconds: 10, result: 'success' });
      logger.record({ contentId: 'c2', source: 'gam', startedAt: new Date('2024-06-15T10:00:10Z'), endedAt: new Date('2024-06-15T10:00:20Z'), durationSeconds: 10, result: 'success' });
      logger.record({ contentId: 'c3', source: 'playlist', startedAt: new Date('2024-06-15T10:00:20Z'), endedAt: new Date('2024-06-15T10:00:30Z'), durationSeconds: 10, result: 'failed', failureReason: 'decode_error' });

      expect(logger.getUnsyncedCount()).toBe(3);

      const synced = await logger.sync();
      expect(synced).toBe(3);
      expect(logger.getUnsyncedCount()).toBe(0);

      // Verify backend received all fields
      expect(receivedLogs).toHaveLength(3);
      expect(receivedLogs[2].failure_reason).toBe('decode_error');
      expect(receivedLogs[0].source).toBe('prodooh');
    });

    it('should only mark acknowledged entries as synced', async () => {
      server.addRoute('POST', '/api/device/playback-logs', (body) => {
        const b = body as { logs: Array<{ id: string }> };
        // Only acknowledge first entry
        return { status: 200, data: { received: 1, ack_ids: [b.logs[0]!.id] } };
      });

      const client = new BackendApiClient('http://localhost:8000');
      client.setToken(jwt);
      const logger = new PlaybackLogger(db, client as PlaybackLogSyncClient);

      logger.record({ contentId: 'c1', source: 'playlist', startedAt: new Date(), endedAt: new Date(), durationSeconds: 10, result: 'success' });
      logger.record({ contentId: 'c2', source: 'playlist', startedAt: new Date(), endedAt: new Date(), durationSeconds: 10, result: 'success' });

      await logger.sync();

      // Only 1 acknowledged, 1 still unsynced
      expect(logger.getUnsyncedCount()).toBe(1);
    });
  });

  // ─── Offline Behavior Tests (Req 1.2, 18.2) ───────────────────────────────

  describe('Offline behavior: queue accumulation and eventual delivery', () => {
    it('should accumulate playback logs while offline and deliver when back online', async () => {
      let receivedLogs: any[] = [];
      server.addRoute('POST', '/api/device/playback-logs', (body) => {
        const b = body as { logs: any[] };
        receivedLogs = b.logs;
        return { status: 200, data: { received: b.logs.length, ack_ids: b.logs.map((l: any) => l.id) } };
      });

      const client = new BackendApiClient('http://localhost:8000');
      client.setToken(jwt);
      const logger = new PlaybackLogger(db, client as PlaybackLogSyncClient);

      // Go offline
      server.setOnline(false);

      // Record events while offline
      logger.record({ contentId: 'offline-1', source: 'playlist', startedAt: new Date('2024-06-15T10:00:00Z'), endedAt: new Date('2024-06-15T10:00:10Z'), durationSeconds: 10, result: 'success' });
      logger.record({ contentId: 'offline-2', source: 'playlist', startedAt: new Date('2024-06-15T10:00:10Z'), endedAt: new Date('2024-06-15T10:00:20Z'), durationSeconds: 10, result: 'success' });
      logger.record({ contentId: 'offline-3', source: 'prodooh', startedAt: new Date('2024-06-15T10:00:20Z'), endedAt: new Date('2024-06-15T10:00:30Z'), durationSeconds: 10, result: 'success' });

      // Events are persisted locally
      expect(logger.getUnsyncedCount()).toBe(3);
      expect(logger.getTotalCount()).toBe(3);

      // Attempt sync while offline — should fail gracefully
      const offlineResult = await logger.sync();
      expect(offlineResult).toBe(-1);
      expect(logger.getUnsyncedCount()).toBe(3); // Still unsynced

      // Come back online
      server.setOnline(true);

      // Sync now succeeds and delivers all accumulated logs
      const onlineResult = await logger.sync();
      expect(onlineResult).toBe(3);
      expect(logger.getUnsyncedCount()).toBe(0);
      expect(receivedLogs).toHaveLength(3);
      expect(receivedLogs.map((l: any) => l.content_id)).toEqual(['offline-1', 'offline-2', 'offline-3']);
    });

    it('should handle auth failure gracefully when offline (Req 1.2)', async () => {
      server.setOnline(false);

      const api = new BackendApi({
        baseUrl: 'http://localhost:8000',
        venueId: 'venue-001',
        deviceToken: 'valid-token',
      });

      const result = await api.authenticate();
      expect(result).toBe(false);
      expect(api.isAuthenticated()).toBe(false);
      // Player can still operate with cached config (graceful degradation)
    });

    it('should resume heartbeat delivery after connectivity restored', async () => {
      let heartbeatCount = 0;
      server.addRoute('POST', '/api/device/heartbeat', () => {
        heartbeatCount++;
        return { status: 200, data: { ack: true, pending_commands: [] } };
      });

      const client = new BackendApiClient('http://localhost:8000');
      client.setToken(jwt);
      const statusProvider = createMockStatusProvider();
      const service = new HeartbeatService({ client, statusProvider, intervalMs: 5000 });

      // Start offline
      server.setOnline(false);
      service.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(heartbeatCount).toBe(0); // Failed silently

      // Advance one interval while offline
      await vi.advanceTimersByTimeAsync(5000);
      expect(heartbeatCount).toBe(0);

      // Come back online
      server.setOnline(true);
      await vi.advanceTimersByTimeAsync(5000);
      expect(heartbeatCount).toBe(1); // Successfully delivered

      service.stop();
    });

    it('should keep playlist unchanged when sync fails due to network error', async () => {
      // Seed initial playlist
      db.prepare('INSERT INTO playlist (id, version, synced_at) VALUES (?, ?, ?)').run('v1', 'v1.0.0', new Date().toISOString());
      db.prepare('INSERT INTO playlist_items (id, playlist_id, type, media_path, url, duration_seconds, position, rotation, refresh_interval, checksum, download_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        'existing-item', 'v1', 'image', '/media/existing.jpg', null, 10, 0, 0, null, null, 'ready'
      );

      const client = new BackendApiClient('http://localhost:8000');
      client.setToken(jwt);
      const downloader = createMockDownloader();
      const syncManager = new PlaylistSyncManager(client, db, downloader);

      // Go offline
      server.setOnline(false);

      const result = await syncManager.sync();
      expect(result).toBe(false);

      // Playlist unchanged
      const items = syncManager.getPlaylistItems();
      expect(items).toHaveLength(1);
      expect(items[0]!.id).toBe('existing-item');
    });

    it('should accumulate multiple sync batches offline and deliver all when reconnected', async () => {
      const receivedBatches: any[][] = [];
      server.addRoute('POST', '/api/device/playback-logs', (body) => {
        const b = body as { logs: any[] };
        receivedBatches.push(b.logs);
        return { status: 200, data: { received: b.logs.length, ack_ids: b.logs.map((l: any) => l.id) } };
      });

      const client = new BackendApiClient('http://localhost:8000');
      client.setToken(jwt);
      const logger = new PlaybackLogger(db, client as PlaybackLogSyncClient, { batchSize: 2 });

      // Record 5 events while offline
      server.setOnline(false);
      for (let i = 0; i < 5; i++) {
        const startMin = Math.floor(i * 10 / 60);
        const startSec = (i * 10) % 60;
        const endMin = Math.floor((i * 10 + 10) / 60);
        const endSec = (i * 10 + 10) % 60;
        logger.record({
          contentId: `batch-${i}`,
          source: 'playlist',
          startedAt: new Date(`2024-06-15T10:${String(startMin).padStart(2, '0')}:${String(startSec).padStart(2, '0')}Z`),
          endedAt: new Date(`2024-06-15T10:${String(endMin).padStart(2, '0')}:${String(endSec).padStart(2, '0')}Z`),
          durationSeconds: 10,
          result: 'success',
        });
      }
      expect(logger.getUnsyncedCount()).toBe(5);

      // Fail to sync
      const failedSync = await logger.sync();
      expect(failedSync).toBe(-1);

      // Come back online
      server.setOnline(true);

      // First batch (size 2)
      const firstSync = await logger.sync();
      expect(firstSync).toBe(2);
      expect(logger.getUnsyncedCount()).toBe(3);

      // Second batch (size 2)
      const secondSync = await logger.sync();
      expect(secondSync).toBe(2);
      expect(logger.getUnsyncedCount()).toBe(1);

      // Third batch (remaining 1)
      const thirdSync = await logger.sync();
      expect(thirdSync).toBe(1);
      expect(logger.getUnsyncedCount()).toBe(0);

      // All 5 events delivered across 3 batches
      const totalDelivered = receivedBatches.reduce((sum, batch) => sum + batch.length, 0);
      expect(totalDelivered).toBe(5);
    });
  });
});
