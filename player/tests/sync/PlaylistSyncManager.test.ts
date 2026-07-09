import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { PlaylistSyncManager } from '../../src/sync/PlaylistSyncManager';
import type {
  MediaDownloader,
  PlaylistManifest,
  PlaylistManifestItem,
} from '../../src/sync/PlaylistSyncManager';
import type { BackendApiClient, HttpResponse } from '../../src/api/BackendApiClient';

/**
 * Unit tests for PlaylistSyncManager.
 * Validates: Requirements 4.4, 9.1, 9.2, 9.3
 */

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS playlist (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlist_items (
      id TEXT PRIMARY KEY,
      playlist_id TEXT NOT NULL REFERENCES playlist(id),
      type TEXT NOT NULL CHECK(type IN ('image', 'video', 'url')),
      media_path TEXT,
      url TEXT,
      duration_seconds INTEGER,
      position INTEGER NOT NULL,
      rotation INTEGER DEFAULT 0,
      refresh_interval INTEGER,
      checksum TEXT,
      download_status TEXT DEFAULT 'pending' CHECK(download_status IN ('pending', 'downloading', 'ready', 'failed'))
    );
  `);
  return db;
}

function createMockClient(overrides?: Partial<BackendApiClient>): BackendApiClient {
  return {
    get: vi.fn().mockResolvedValue({ ok: false, status: 0, data: null }),
    post: vi.fn().mockResolvedValue({ ok: true, status: 200, data: { ack: true } }),
    setToken: vi.fn(),
    getToken: vi.fn().mockReturnValue('test-token'),
    ...overrides,
  } as unknown as BackendApiClient;
}

function createMockDownloader(overrides?: Partial<MediaDownloader>): MediaDownloader {
  return {
    download: vi.fn().mockResolvedValue('/media/test-file.jpg'),
    computeChecksum: vi.fn().mockResolvedValue('abc123'),
    ...overrides,
  };
}

function createSampleManifest(items?: PlaylistManifestItem[]): PlaylistManifest {
  return {
    version: 'v2',
    etag: 'etag-v2',
    items: items ?? [
      { id: 'item-1', type: 'image', url: 'https://cdn.example.com/img1.jpg', duration: 10, checksum: 'abc123' },
      { id: 'item-2', type: 'video', url: 'https://cdn.example.com/vid1.mp4', duration: 15, checksum: 'def456' },
    ],
  };
}

function seedPlaylist(db: Database.Database, version: string = 'v1'): void {
  db.prepare('INSERT INTO playlist (id, version, synced_at) VALUES (?, ?, ?)')
    .run(version, version, new Date().toISOString());
  db.prepare(
    `INSERT INTO playlist_items (id, playlist_id, type, media_path, url, duration_seconds, position, rotation, checksum, download_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('old-item-1', version, 'image', '/media/old.jpg', null, 10, 0, 0, 'old-checksum', 'ready');
}

describe('PlaylistSyncManager', () => {
  let db: Database.Database;
  let client: BackendApiClient;
  let downloader: MediaDownloader;
  let manager: PlaylistSyncManager;

  beforeEach(() => {
    db = createTestDb();
    client = createMockClient();
    downloader = createMockDownloader();
    manager = new PlaylistSyncManager(client, db, downloader);
  });

  afterEach(() => {
    db.close();
  });

  describe('constructor', () => {
    it('should restore ETag from existing playlist version', () => {
      const db2 = createTestDb();
      seedPlaylist(db2, 'v1');
      const mgr = new PlaylistSyncManager(client, db2, downloader);
      expect(mgr.getEtag()).toBe('v1');
      db2.close();
    });

    it('should set ETag to null when no playlist exists', () => {
      expect(manager.getEtag()).toBeNull();
    });
  });

  describe('fetchPlaylistManifest', () => {
    it('should return null on 304 Not Modified', async () => {
      const mockClient = createMockClient({
        get: vi.fn().mockResolvedValue({ ok: false, status: 304, data: null }),
      });
      const mgr = new PlaylistSyncManager(mockClient, db, downloader);

      const result = await mgr.fetchPlaylistManifest();
      expect(result).toBeNull();
    });

    it('should return manifest data on 200 OK', async () => {
      const manifest = createSampleManifest();
      const mockClient = createMockClient({
        get: vi.fn().mockResolvedValue({ ok: true, status: 200, data: manifest }),
      });
      const mgr = new PlaylistSyncManager(mockClient, db, downloader);

      const result = await mgr.fetchPlaylistManifest();
      expect(result).toEqual(manifest);
    });

    it('should send If-None-Match header when ETag is set', async () => {
      const db2 = createTestDb();
      seedPlaylist(db2, 'v1');
      const getMock = vi.fn().mockResolvedValue({ ok: false, status: 304, data: null });
      const mockClient = createMockClient({ get: getMock });
      const mgr = new PlaylistSyncManager(mockClient, db2, downloader);

      await mgr.fetchPlaylistManifest();

      expect(getMock).toHaveBeenCalledWith('/api/device/playlist', { 'If-None-Match': 'v1' });
      db2.close();
    });

    it('should not send If-None-Match when no ETag exists', async () => {
      const getMock = vi.fn().mockResolvedValue({ ok: false, status: 0, data: null });
      const mockClient = createMockClient({ get: getMock });
      const mgr = new PlaylistSyncManager(mockClient, db, downloader);

      await mgr.fetchPlaylistManifest();

      expect(getMock).toHaveBeenCalledWith('/api/device/playlist', {});
    });

    it('should return null on network error (status 0)', async () => {
      const mockClient = createMockClient({
        get: vi.fn().mockResolvedValue({ ok: false, status: 0, data: null }),
      });
      const mgr = new PlaylistSyncManager(mockClient, db, downloader);

      const result = await mgr.fetchPlaylistManifest();
      expect(result).toBeNull();
    });
  });

  describe('downloadNewMedia', () => {
    it('should download image and video items', async () => {
      const items: PlaylistManifestItem[] = [
        { id: 'item-1', type: 'image', url: 'https://cdn.example.com/img.jpg', checksum: 'abc123' },
        { id: 'item-2', type: 'video', url: 'https://cdn.example.com/vid.mp4', checksum: 'abc123' },
      ];

      const result = await manager.downloadNewMedia(items);

      expect(result.success).toBe(true);
      expect(result.failedCount).toBe(0);
      expect(result.downloadedPaths.size).toBe(2);
      expect(downloader.download).toHaveBeenCalledTimes(2);
    });

    it('should skip URL items (no download needed)', async () => {
      const items: PlaylistManifestItem[] = [
        { id: 'item-1', type: 'url', url: 'https://example.com/page' },
      ];

      const result = await manager.downloadNewMedia(items);

      expect(result.success).toBe(true);
      expect(result.failedCount).toBe(0);
      expect(result.downloadedPaths.size).toBe(0);
      expect(downloader.download).not.toHaveBeenCalled();
    });

    it('should report failure when download fails', async () => {
      const failDownloader = createMockDownloader({
        download: vi.fn().mockResolvedValue(null),
      });
      const mgr = new PlaylistSyncManager(client, db, failDownloader);

      const items: PlaylistManifestItem[] = [
        { id: 'item-1', type: 'image', url: 'https://cdn.example.com/img.jpg' },
      ];

      const result = await mgr.downloadNewMedia(items);

      expect(result.success).toBe(false);
      expect(result.failedCount).toBe(1);
    });

    it('should report failure when checksum does not match', async () => {
      const badChecksumDownloader = createMockDownloader({
        download: vi.fn().mockResolvedValue('/media/img.jpg'),
        computeChecksum: vi.fn().mockResolvedValue('wrong-checksum'),
      });
      const mgr = new PlaylistSyncManager(client, db, badChecksumDownloader);

      const items: PlaylistManifestItem[] = [
        { id: 'item-1', type: 'image', url: 'https://cdn.example.com/img.jpg', checksum: 'expected-checksum' },
      ];

      const result = await mgr.downloadNewMedia(items);

      expect(result.success).toBe(false);
      expect(result.failedCount).toBe(1);
    });

    it('should succeed without checksum validation when no checksum provided', async () => {
      const items: PlaylistManifestItem[] = [
        { id: 'item-1', type: 'image', url: 'https://cdn.example.com/img.jpg' },
      ];

      const result = await manager.downloadNewMedia(items);

      expect(result.success).toBe(true);
      expect(downloader.computeChecksum).not.toHaveBeenCalled();
    });
  });

  describe('confirmPlaylist', () => {
    it('should send adoption confirmation to backend', async () => {
      const postMock = vi.fn().mockResolvedValue({ ok: true, status: 200, data: { ack: true } });
      const mockClient = createMockClient({ post: postMock });
      const mgr = new PlaylistSyncManager(mockClient, db, downloader);

      const result = await mgr.confirmPlaylist({ version: 'v2', status: 'adopted' });

      expect(result).toBe(true);
      expect(postMock).toHaveBeenCalledWith('/api/device/playlist/confirm', {
        version: 'v2',
        status: 'adopted',
      });
    });

    it('should send failure confirmation with error message', async () => {
      const postMock = vi.fn().mockResolvedValue({ ok: true, status: 200, data: { ack: true } });
      const mockClient = createMockClient({ post: postMock });
      const mgr = new PlaylistSyncManager(mockClient, db, downloader);

      const result = await mgr.confirmPlaylist({
        version: 'v2',
        status: 'failed',
        error: 'Download failed',
      });

      expect(result).toBe(true);
      expect(postMock).toHaveBeenCalledWith('/api/device/playlist/confirm', {
        version: 'v2',
        status: 'failed',
        error: 'Download failed',
      });
    });

    it('should return false when backend responds without ack', async () => {
      const postMock = vi.fn().mockResolvedValue({ ok: true, status: 200, data: { ack: false } });
      const mockClient = createMockClient({ post: postMock });
      const mgr = new PlaylistSyncManager(mockClient, db, downloader);

      const result = await mgr.confirmPlaylist({ version: 'v2', status: 'adopted' });
      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      const postMock = vi.fn().mockResolvedValue({ ok: false, status: 0, data: null });
      const mockClient = createMockClient({ post: postMock });
      const mgr = new PlaylistSyncManager(mockClient, db, downloader);

      const result = await mgr.confirmPlaylist({ version: 'v2', status: 'adopted' });
      expect(result).toBe(false);
    });
  });

  describe('backupCurrentPlaylist and revertPlaylist', () => {
    it('should backup and restore playlist correctly', () => {
      seedPlaylist(db, 'v1');
      manager = new PlaylistSyncManager(client, db, downloader);

      manager.backupCurrentPlaylist();

      // Replace with new data
      db.exec('DELETE FROM playlist_items');
      db.exec('DELETE FROM playlist');
      db.prepare('INSERT INTO playlist (id, version, synced_at) VALUES (?, ?, ?)')
        .run('v2', 'v2', new Date().toISOString());

      // Revert
      manager.revertPlaylist();

      const playlist = db.prepare('SELECT * FROM playlist').get() as { id: string; version: string };
      expect(playlist.version).toBe('v1');

      const items = db.prepare('SELECT * FROM playlist_items').all() as Array<{ id: string }>;
      expect(items).toHaveLength(1);
      expect(items[0]!.id).toBe('old-item-1');
    });

    it('should not crash when reverting without a backup', () => {
      expect(() => manager.revertPlaylist()).not.toThrow();
    });

    it('should restore ETag to backup version after revert', () => {
      seedPlaylist(db, 'v1');
      manager = new PlaylistSyncManager(client, db, downloader);

      manager.backupCurrentPlaylist();

      // Replace
      db.exec('DELETE FROM playlist_items');
      db.exec('DELETE FROM playlist');
      db.prepare('INSERT INTO playlist (id, version, synced_at) VALUES (?, ?, ?)')
        .run('v2', 'v2', new Date().toISOString());

      manager.revertPlaylist();

      expect(manager.getEtag()).toBe('v1');
    });
  });

  describe('replacePlaylist', () => {
    it('should atomically replace playlist in database', () => {
      seedPlaylist(db, 'v1');
      manager = new PlaylistSyncManager(client, db, downloader);

      const manifest = createSampleManifest();
      const paths = new Map<string, string>([
        ['item-1', '/media/img1.jpg'],
        ['item-2', '/media/vid1.mp4'],
      ]);

      manager.replacePlaylist(manifest, paths);

      const playlist = db.prepare('SELECT * FROM playlist').get() as { version: string };
      expect(playlist.version).toBe('v2');

      const items = db.prepare('SELECT * FROM playlist_items ORDER BY position').all() as Array<{
        id: string;
        type: string;
        media_path: string | null;
        download_status: string;
      }>;
      expect(items).toHaveLength(2);
      expect(items[0]!.id).toBe('item-1');
      expect(items[0]!.type).toBe('image');
      expect(items[0]!.media_path).toBe('/media/img1.jpg');
      expect(items[0]!.download_status).toBe('ready');
      expect(items[1]!.id).toBe('item-2');
      expect(items[1]!.media_path).toBe('/media/vid1.mp4');
    });

    it('should handle URL items without media_path', () => {
      const manifest: PlaylistManifest = {
        version: 'v2',
        etag: 'etag-v2',
        items: [
          { id: 'url-1', type: 'url', url: 'https://example.com/page', duration: 10, refresh_interval: 60 },
        ],
      };

      manager.replacePlaylist(manifest, new Map());

      const items = db.prepare('SELECT * FROM playlist_items').all() as Array<{
        id: string;
        type: string;
        url: string | null;
        media_path: string | null;
        download_status: string;
      }>;
      expect(items).toHaveLength(1);
      expect(items[0]!.type).toBe('url');
      expect(items[0]!.url).toBe('https://example.com/page');
      expect(items[0]!.media_path).toBeNull();
      expect(items[0]!.download_status).toBe('ready');
    });
  });

  describe('sync (full cycle)', () => {
    it('should return false when no update available (304)', async () => {
      const mockClient = createMockClient({
        get: vi.fn().mockResolvedValue({ ok: false, status: 304, data: null }),
      });
      const mgr = new PlaylistSyncManager(mockClient, db, downloader);

      const result = await mgr.sync();
      expect(result).toBe(false);
    });

    it('should adopt new playlist when all steps succeed', async () => {
      seedPlaylist(db, 'v1');
      const manifest = createSampleManifest([
        { id: 'item-1', type: 'image', url: 'https://cdn.example.com/img1.jpg', duration: 10, checksum: 'abc123' },
        { id: 'item-2', type: 'video', url: 'https://cdn.example.com/vid1.mp4', duration: 15, checksum: 'abc123' },
      ]);

      const mockClient = createMockClient({
        get: vi.fn().mockResolvedValue({ ok: true, status: 200, data: manifest }),
        post: vi.fn().mockResolvedValue({ ok: true, status: 200, data: { ack: true } }),
      });
      const mockDownloader = createMockDownloader({
        download: vi.fn().mockResolvedValue('/media/new-file.jpg'),
        computeChecksum: vi.fn().mockResolvedValue('abc123'),
      });
      const mgr = new PlaylistSyncManager(mockClient, db, mockDownloader);

      const result = await mgr.sync();

      expect(result).toBe(true);
      expect(mgr.getPlaylistVersion()).toBe('v2');
      expect(mgr.getEtag()).toBe('etag-v2');
    });

    it('should report failure and keep current playlist when download fails', async () => {
      seedPlaylist(db, 'v1');
      const manifest = createSampleManifest();

      const postMock = vi.fn().mockResolvedValue({ ok: true, status: 200, data: { ack: true } });
      const mockClient = createMockClient({
        get: vi.fn().mockResolvedValue({ ok: true, status: 200, data: manifest }),
        post: postMock,
      });
      const failDownloader = createMockDownloader({
        download: vi.fn().mockResolvedValue(null),
      });
      const mgr = new PlaylistSyncManager(mockClient, db, failDownloader);

      const result = await mgr.sync();

      expect(result).toBe(false);
      expect(mgr.getPlaylistVersion()).toBe('v1'); // Unchanged
      expect(postMock).toHaveBeenCalledWith('/api/device/playlist/confirm', {
        version: 'v2',
        status: 'failed',
        error: 'Failed to download 2 items',
      });
    });

    it('should revert on adoption confirmation failure (Requirement 9.3)', async () => {
      seedPlaylist(db, 'v1');
      const manifest = createSampleManifest();

      const mockClient = createMockClient({
        get: vi.fn().mockResolvedValue({ ok: true, status: 200, data: manifest }),
        post: vi.fn().mockResolvedValue({ ok: false, status: 0, data: null }), // Confirmation fails
      });
      const mockDownloader = createMockDownloader({
        download: vi.fn().mockResolvedValue('/media/new-file.jpg'),
        computeChecksum: vi.fn().mockResolvedValue('abc123'),
      });
      const mgr = new PlaylistSyncManager(mockClient, db, mockDownloader);

      const result = await mgr.sync();

      expect(result).toBe(false);
      // Should have reverted to v1
      expect(mgr.getPlaylistVersion()).toBe('v1');
      expect(mgr.getEtag()).toBe('v1');
    });

    it('should revert when confirmation returns ack: false (Requirement 9.3)', async () => {
      seedPlaylist(db, 'v1');
      const manifest = createSampleManifest();

      const mockClient = createMockClient({
        get: vi.fn().mockResolvedValue({ ok: true, status: 200, data: manifest }),
        post: vi.fn().mockResolvedValue({ ok: true, status: 200, data: { ack: false } }),
      });
      const mockDownloader = createMockDownloader({
        download: vi.fn().mockResolvedValue('/media/new-file.jpg'),
        computeChecksum: vi.fn().mockResolvedValue('abc123'),
      });
      const mgr = new PlaylistSyncManager(mockClient, db, mockDownloader);

      const result = await mgr.sync();

      expect(result).toBe(false);
      expect(mgr.getPlaylistVersion()).toBe('v1');
    });

    it('should update ETag after successful sync', async () => {
      const manifest: PlaylistManifest = {
        version: 'v2',
        etag: 'etag-v2',
        items: [
          { id: 'item-1', type: 'image', url: 'https://cdn.example.com/img.jpg', checksum: 'abc123' },
        ],
      };

      const mockClient = createMockClient({
        get: vi.fn().mockResolvedValue({ ok: true, status: 200, data: manifest }),
        post: vi.fn().mockResolvedValue({ ok: true, status: 200, data: { ack: true } }),
      });
      const mockDownloader = createMockDownloader({
        download: vi.fn().mockResolvedValue('/media/new-file.jpg'),
        computeChecksum: vi.fn().mockResolvedValue('abc123'),
      });
      const mgr = new PlaylistSyncManager(mockClient, db, mockDownloader);

      await mgr.sync();

      expect(mgr.getEtag()).toBe('etag-v2');
    });

    it('should handle sync with mixed item types (media + url)', async () => {
      const manifest: PlaylistManifest = {
        version: 'v3',
        etag: 'etag-v3',
        items: [
          { id: 'img-1', type: 'image', url: 'https://cdn.example.com/img.jpg', checksum: 'abc123' },
          { id: 'url-1', type: 'url', url: 'https://example.com/page', duration: 15 },
          { id: 'vid-1', type: 'video', url: 'https://cdn.example.com/vid.mp4', checksum: 'abc123' },
        ],
      };

      const mockClient = createMockClient({
        get: vi.fn().mockResolvedValue({ ok: true, status: 200, data: manifest }),
        post: vi.fn().mockResolvedValue({ ok: true, status: 200, data: { ack: true } }),
      });
      const mockDownloader = createMockDownloader({
        download: vi.fn().mockResolvedValue('/media/downloaded.file'),
        computeChecksum: vi.fn().mockResolvedValue('abc123'),
      });
      const mgr = new PlaylistSyncManager(mockClient, db, mockDownloader);

      const result = await mgr.sync();

      expect(result).toBe(true);
      const items = mgr.getPlaylistItems();
      expect(items).toHaveLength(3);
      // URL item should not have media_path
      expect(items[1]!.url).toBe('https://example.com/page');
      expect(items[1]!.media_path).toBeNull();
      // Media items should have paths
      expect(items[0]!.media_path).toBe('/media/downloaded.file');
      expect(items[2]!.media_path).toBe('/media/downloaded.file');
      // Only media items should have triggered download
      expect(mockDownloader.download).toHaveBeenCalledTimes(2);
    });

    it('should handle checksum validation failure for one item gracefully', async () => {
      const manifest: PlaylistManifest = {
        version: 'v3',
        etag: 'etag-v3',
        items: [
          { id: 'img-1', type: 'image', url: 'https://cdn.example.com/img.jpg', checksum: 'correct-hash' },
          { id: 'img-2', type: 'image', url: 'https://cdn.example.com/img2.jpg', checksum: 'another-hash' },
        ],
      };

      let callCount = 0;
      const mockDownloader = createMockDownloader({
        download: vi.fn().mockResolvedValue('/media/downloaded.file'),
        computeChecksum: vi.fn().mockImplementation(async () => {
          callCount++;
          return callCount === 1 ? 'wrong-hash' : 'another-hash'; // First fails, second passes
        }),
      });
      const postMock = vi.fn().mockResolvedValue({ ok: true, status: 200, data: { ack: true } });
      const mockClient = createMockClient({
        get: vi.fn().mockResolvedValue({ ok: true, status: 200, data: manifest }),
        post: postMock,
      });
      const mgr = new PlaylistSyncManager(mockClient, db, mockDownloader);

      const result = await mgr.sync();

      expect(result).toBe(false);
      // Should have reported failure
      expect(postMock).toHaveBeenCalledWith('/api/device/playlist/confirm', expect.objectContaining({
        status: 'failed',
      }));
    });
  });

  describe('getPlaylistVersion', () => {
    it('should return null when no playlist exists', () => {
      expect(manager.getPlaylistVersion()).toBeNull();
    });

    it('should return current version', () => {
      seedPlaylist(db, 'v1');
      manager = new PlaylistSyncManager(client, db, downloader);
      expect(manager.getPlaylistVersion()).toBe('v1');
    });
  });

  describe('getPlaylistItems', () => {
    it('should return empty array when no items exist', () => {
      expect(manager.getPlaylistItems()).toEqual([]);
    });

    it('should return items ordered by position', () => {
      seedPlaylist(db, 'v1');
      db.prepare(
        `INSERT INTO playlist_items (id, playlist_id, type, media_path, url, duration_seconds, position, rotation, checksum, download_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('item-2', 'v1', 'video', '/media/vid.mp4', null, 15, 1, 0, 'hash2', 'ready');

      manager = new PlaylistSyncManager(client, db, downloader);
      const items = manager.getPlaylistItems();

      expect(items).toHaveLength(2);
      expect(items[0]!.position).toBe(0);
      expect(items[1]!.position).toBe(1);
    });
  });
});
