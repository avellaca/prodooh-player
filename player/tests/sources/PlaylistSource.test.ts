import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { PlaylistSource } from '../../src/sources/PlaylistSource';
import { LocalConfigStore } from '../../src/storage/LocalConfigStore';

/**
 * Tests for PlaylistSource — local playlist content source.
 * Uses in-memory SQLite for fast, isolated tests.
 */
describe('PlaylistSource', () => {
  let db: Database.Database;
  let source: PlaylistSource;

  beforeEach(() => {
    // Create in-memory DB with schema via LocalConfigStore, then reuse the db
    const store = new LocalConfigStore(':memory:');
    db = (store as any).db;
    source = new PlaylistSource(db);
  });

  afterEach(() => {
    db.close();
  });

  /** Helper to insert a playlist and items */
  function seedPlaylist(items: Array<{
    id: string;
    type: 'image' | 'video' | 'url';
    media_path?: string;
    url?: string;
    duration_seconds?: number;
    position: number;
    rotation?: number;
    refresh_interval?: number;
    download_status?: string;
  }>): void {
    db.prepare(
      `INSERT INTO playlist (id, version, synced_at) VALUES ('pl-1', '1.0', '2024-01-01T00:00:00Z')`
    ).run();

    const stmt = db.prepare(`
      INSERT INTO playlist_items (id, playlist_id, type, media_path, url, duration_seconds, position, rotation, refresh_interval, download_status)
      VALUES (?, 'pl-1', ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      stmt.run(
        item.id,
        item.type,
        item.media_path ?? null,
        item.url ?? null,
        item.duration_seconds ?? null,
        item.position,
        item.rotation ?? 0,
        item.refresh_interval ?? null,
        item.download_status ?? 'ready'
      );
    }
  }

  describe('id', () => {
    it('should have id "playlist"', () => {
      expect(source.id).toBe('playlist');
    });
  });

  describe('isAvailable', () => {
    it('should return false when no playlist items exist', () => {
      expect(source.isAvailable()).toBe(false);
    });

    it('should return true when at least one ready item exists', () => {
      seedPlaylist([
        { id: 'img-1', type: 'image', media_path: '/media/img1.jpg', position: 0 },
      ]);
      expect(source.isAvailable()).toBe(true);
    });

    it('should return false when all items have pending download status', () => {
      seedPlaylist([
        { id: 'img-1', type: 'image', media_path: '/media/img1.jpg', position: 0, download_status: 'pending' },
        { id: 'img-2', type: 'image', media_path: '/media/img2.jpg', position: 1, download_status: 'downloading' },
      ]);
      expect(source.isAvailable()).toBe(false);
    });

    it('should return true for URL items regardless of download_status', () => {
      seedPlaylist([
        { id: 'url-1', type: 'url', url: 'https://example.com', position: 0, download_status: 'pending' },
      ]);
      expect(source.isAvailable()).toBe(true);
    });
  });

  describe('prefetch', () => {
    it('should return null when no items exist', async () => {
      const content = await source.prefetch();
      expect(content).toBeNull();
    });

    it('should return PreparedContent for an image item', async () => {
      seedPlaylist([
        { id: 'img-1', type: 'image', media_path: '/media/img1.jpg', duration_seconds: 15, position: 0, rotation: 90 },
      ]);

      const content = await source.prefetch();
      expect(content).not.toBeNull();
      expect(content!.id).toBe('img-1');
      expect(content!.type).toBe('image');
      expect(content!.source).toBe('playlist');
      expect(content!.mediaUrl).toBe('/media/img1.jpg');
      expect(content!.duration).toBe(15);
      expect(content!.metadata).toEqual({
        playlist_id: 'pl-1',
        position: 0,
        rotation: 90,
        refresh_interval: null,
      });
    });

    it('should return PreparedContent for a video item', async () => {
      seedPlaylist([
        { id: 'vid-1', type: 'video', media_path: '/media/vid1.mp4', duration_seconds: 30, position: 0 },
      ]);

      const content = await source.prefetch();
      expect(content).not.toBeNull();
      expect(content!.id).toBe('vid-1');
      expect(content!.type).toBe('video');
      expect(content!.mediaUrl).toBe('/media/vid1.mp4');
      expect(content!.duration).toBe(30);
    });

    it('should return PreparedContent for a URL item', async () => {
      seedPlaylist([
        { id: 'url-1', type: 'url', url: 'https://example.com/page', duration_seconds: 20, position: 0, refresh_interval: 60 },
      ]);

      const content = await source.prefetch();
      expect(content).not.toBeNull();
      expect(content!.id).toBe('url-1');
      expect(content!.type).toBe('url');
      expect(content!.mediaUrl).toBe('https://example.com/page');
      expect(content!.duration).toBe(20);
      expect(content!.metadata.refresh_interval).toBe(60);
    });

    it('should use default duration (10s) when duration_seconds is null', async () => {
      seedPlaylist([
        { id: 'img-1', type: 'image', media_path: '/media/img1.jpg', position: 0 },
      ]);

      const content = await source.prefetch();
      expect(content!.duration).toBe(10);
    });

    it('should cycle through items sequentially by position', async () => {
      seedPlaylist([
        { id: 'img-1', type: 'image', media_path: '/media/img1.jpg', position: 0 },
        { id: 'vid-1', type: 'video', media_path: '/media/vid1.mp4', position: 1 },
        { id: 'url-1', type: 'url', url: 'https://example.com', position: 2 },
      ]);

      const first = await source.prefetch();
      const second = await source.prefetch();
      const third = await source.prefetch();

      expect(first!.id).toBe('img-1');
      expect(second!.id).toBe('vid-1');
      expect(third!.id).toBe('url-1');
    });

    it('should wrap to the beginning after reaching the last item', async () => {
      seedPlaylist([
        { id: 'img-1', type: 'image', media_path: '/media/img1.jpg', position: 0 },
        { id: 'vid-1', type: 'video', media_path: '/media/vid1.mp4', position: 1 },
      ]);

      const first = await source.prefetch();
      const second = await source.prefetch();
      const third = await source.prefetch(); // should wrap

      expect(first!.id).toBe('img-1');
      expect(second!.id).toBe('vid-1');
      expect(third!.id).toBe('img-1');
    });

    it('should skip items that are not ready (pending/downloading/failed)', async () => {
      seedPlaylist([
        { id: 'img-1', type: 'image', media_path: '/media/img1.jpg', position: 0, download_status: 'pending' },
        { id: 'img-2', type: 'image', media_path: '/media/img2.jpg', position: 1, download_status: 'ready' },
        { id: 'img-3', type: 'image', media_path: '/media/img3.jpg', position: 2, download_status: 'failed' },
      ]);

      const first = await source.prefetch();
      const second = await source.prefetch();

      expect(first!.id).toBe('img-2');
      expect(second!.id).toBe('img-2'); // wraps since only one ready item
    });

    it('should respect position ordering', async () => {
      seedPlaylist([
        { id: 'img-3', type: 'image', media_path: '/media/img3.jpg', position: 2 },
        { id: 'img-1', type: 'image', media_path: '/media/img1.jpg', position: 0 },
        { id: 'img-2', type: 'image', media_path: '/media/img2.jpg', position: 1 },
      ]);

      const first = await source.prefetch();
      const second = await source.prefetch();
      const third = await source.prefetch();

      expect(first!.id).toBe('img-1');
      expect(second!.id).toBe('img-2');
      expect(third!.id).toBe('img-3');
    });
  });

  describe('confirmPlay', () => {
    it('should be a no-op and not throw', async () => {
      const content = {
        id: 'img-1',
        type: 'image' as const,
        source: 'playlist' as const,
        mediaUrl: '/media/img1.jpg',
        duration: 10,
        metadata: {},
      };

      await expect(source.confirmPlay(content)).resolves.toBeUndefined();
    });
  });

  describe('reportFailure', () => {
    it('should log the error without throwing', async () => {
      const content = {
        id: 'vid-1',
        type: 'video' as const,
        source: 'playlist' as const,
        mediaUrl: '/media/vid1.mp4',
        duration: 30,
        metadata: {},
      };

      await expect(
        source.reportFailure(content, 'Decode error')
      ).resolves.toBeUndefined();
    });
  });

  describe('dynamic playlist changes', () => {
    it('should reflect newly added items on next prefetch cycle', async () => {
      seedPlaylist([
        { id: 'img-1', type: 'image', media_path: '/media/img1.jpg', position: 0 },
      ]);

      // With 1 item, prefetch returns it and wraps index back to 0
      const first = await source.prefetch();
      expect(first!.id).toBe('img-1');

      // Add a new item to the database
      db.prepare(`
        INSERT INTO playlist_items (id, playlist_id, type, media_path, position, download_status)
        VALUES ('img-2', 'pl-1', 'image', '/media/img2.jpg', 1, 'ready')
      `).run();

      // Now there are 2 items; index wrapped to 0, so first item again
      const second = await source.prefetch();
      expect(second!.id).toBe('img-1');

      // Third call gets the newly added item
      const third = await source.prefetch();
      expect(third!.id).toBe('img-2');
    });

    it('should reset index when items are removed and index exceeds length', async () => {
      seedPlaylist([
        { id: 'img-1', type: 'image', media_path: '/media/img1.jpg', position: 0 },
        { id: 'img-2', type: 'image', media_path: '/media/img2.jpg', position: 1 },
        { id: 'img-3', type: 'image', media_path: '/media/img3.jpg', position: 2 },
      ]);

      // Advance index to 2
      await source.prefetch(); // index becomes 1
      await source.prefetch(); // index becomes 2

      // Remove last two items
      db.prepare(`DELETE FROM playlist_items WHERE id IN ('img-2', 'img-3')`).run();

      // Next call: currentIndex=2, items.length=1 → should wrap to 0
      const content = await source.prefetch();
      expect(content!.id).toBe('img-1');
    });
  });
});
