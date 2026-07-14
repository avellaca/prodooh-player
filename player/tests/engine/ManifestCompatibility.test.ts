/**
 * Tests for Player compatibility with the new manifest format from spec 09
 * (creativos por pantalla).
 *
 * Verifies:
 * - The Player tolerates the additional `target_id` field without breaking parsing
 * - The Player does not need local resolution validation (done by backend)
 * - When no `order_line_creative` items exist, the Player reproduces
 *   `playlist_item` and `prodooh_ssp_call` items correctly
 * - The Player handles gracefully the absence of `order_line_creative` items
 *
 * Validates: Requirements 14.1, 14.2, 14.3, 14.4
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ManifestSyncManager } from '../../src/sync/ManifestSyncManager';
import type { Manifest, ManifestItem } from '../../src/sync/ManifestSyncManager';
import { ManifestEngine, type PlaybackResult } from '../../src/engine/ManifestEngine';
import { BackendApiClient } from '../../src/api/BackendApiClient';
import { JwtRenewer } from '../../src/api/JwtRenewer';
import type { MediaDownloader } from '../../src/sync/types';

// --- Helpers ---

function createTestDb(): Database.Database {
  return new Database(':memory:');
}

function createMockDownloader(): MediaDownloader {
  return {
    download: vi.fn().mockResolvedValue('/media/downloaded-file'),
    computeChecksum: vi.fn().mockResolvedValue('checksum-match'),
  };
}

function createManifest(items: ManifestItem[]): Manifest {
  return {
    version: 'compat-test-v1',
    generated_at: '2026-01-01T00:00:00Z',
    items,
  };
}

// --- Tests ---

describe('Player manifest compatibility with creativos-por-pantalla (Req 14.1–14.4)', () => {
  describe('target_id field tolerance (Req 14.1, 14.4)', () => {
    let db: Database.Database;
    let fetchMock: ReturnType<typeof vi.fn>;
    let client: BackendApiClient;
    let jwtRenewer: JwtRenewer;
    let downloader: MediaDownloader;
    let manager: ManifestSyncManager;

    beforeEach(() => {
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      db = createTestDb();
      client = new BackendApiClient('http://localhost:8000');
      client.setToken('test-token');
      jwtRenewer = new JwtRenewer(client, '/api/device/auth');
      downloader = createMockDownloader();
      manager = new ManifestSyncManager(client, db, downloader, jwtRenewer);
    });

    afterEach(() => {
      manager.stopPeriodicSync();
      db.close();
      vi.unstubAllGlobals();
    });

    it('should parse and sync a manifest with target_id field on order_line_creative items', async () => {
      const manifestWithTargetId: Manifest = {
        version: 'v-with-target',
        generated_at: '2026-01-15T10:00:00Z',
        items: [
          {
            position: 0,
            type: 'order_line_creative',
            duration_seconds: 10,
            asset_url: 'https://cdn.example.com/creative1.mp4',
            checksum_sha256: 'checksum-match',
            order_line_id: 'ol-001',
            creative_id: 'cr-001',
            target_id: 'target-uuid-001',
          },
          {
            position: 1,
            type: 'order_line_creative',
            duration_seconds: 15,
            asset_url: 'https://cdn.example.com/creative2.jpg',
            checksum_sha256: 'checksum-match',
            order_line_id: 'ol-002',
            creative_id: 'cr-002',
            target_id: 'target-uuid-002',
          },
          {
            position: 2,
            type: 'playlist_item',
            duration_seconds: 10,
            asset_url: 'https://cdn.example.com/playlist.jpg',
            checksum_sha256: 'checksum-match',
            playlist_item_id: 'pl-001',
          },
        ],
      };

      // Mock fetch for GET manifest
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => manifestWithTargetId,
      });
      // Mock fetch for POST confirm
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ ok: true }),
      });

      const result = await manager.sync();

      expect(result).toBe(true);
      expect(manager.getManifestVersion()).toBe('v-with-target');

      const manifest = manager.getManifest()!;
      expect(manifest.items).toHaveLength(3);
      expect(manifest.items[0]!.target_id).toBe('target-uuid-001');
      expect(manifest.items[1]!.target_id).toBe('target-uuid-002');
      // playlist_item doesn't have target_id
      expect(manifest.items[2]!.target_id).toBeUndefined();
    });

    it('should play order_line_creative items with target_id without errors', async () => {
      const itemWithTarget: ManifestItem = {
        position: 0,
        type: 'order_line_creative',
        duration_seconds: 10,
        asset_url: 'https://cdn.example.com/creative.mp4',
        checksum_sha256: 'abc123',
        order_line_id: 'ol-001',
        creative_id: 'cr-001',
        target_id: 'target-uuid-001',
      };

      const manifest = createManifest([itemWithTarget]);
      const onItemComplete = vi.fn();
      const onItemStart = vi.fn();

      let playCount = 0;
      const engine = new ManifestEngine({
        manifest,
        onItemStart,
        onItemComplete,
        playbackFn: async () => {
          playCount++;
          if (playCount >= 1) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      expect(onItemStart).toHaveBeenCalledTimes(1);
      expect(onItemComplete).toHaveBeenCalledTimes(1);

      // The item passed to callbacks should contain the target_id
      const startedItem = onItemStart.mock.calls[0]![0] as ManifestItem;
      expect(startedItem.target_id).toBe('target-uuid-001');
      expect(startedItem.order_line_id).toBe('ol-001');
      expect(startedItem.creative_id).toBe('cr-001');
    });
  });

  describe('No resolution validation needed in Player (Req 14.2)', () => {
    it('should play items regardless of any resolution metadata — Player trusts backend', async () => {
      // The Player simply plays what it receives. Resolution validation occurs at
      // assignment time in the backend, NOT at playback time. This test confirms
      // the engine doesn't perform any resolution-based filtering or rejection.
      const items: ManifestItem[] = [
        {
          position: 0,
          type: 'order_line_creative',
          duration_seconds: 10,
          asset_url: 'https://cdn.example.com/1920x1080.mp4',
          order_line_id: 'ol-1',
          creative_id: 'cr-1',
          target_id: 'target-1',
        },
        {
          position: 1,
          type: 'order_line_creative',
          duration_seconds: 15,
          asset_url: 'https://cdn.example.com/1080x1920.jpg',
          order_line_id: 'ol-2',
          creative_id: 'cr-2',
          target_id: 'target-2',
        },
      ];

      const manifest = createManifest(items);
      const playedItems: ManifestItem[] = [];
      let playCount = 0;

      const engine = new ManifestEngine({
        manifest,
        playbackFn: async (item) => {
          playedItems.push(item);
          playCount++;
          if (playCount >= 2) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      // Both items were played without any filtering
      expect(playedItems).toHaveLength(2);
      expect(playedItems[0]!.asset_url).toBe('https://cdn.example.com/1920x1080.mp4');
      expect(playedItems[1]!.asset_url).toBe('https://cdn.example.com/1080x1920.jpg');
    });
  });

  describe('Graceful handling when no order_line_creative items exist (Req 14.3)', () => {
    it('should play playlist_item and prodooh_ssp_call items when no order_line_creative items exist', async () => {
      const items: ManifestItem[] = [
        {
          position: 0,
          type: 'playlist_item',
          duration_seconds: 10,
          asset_url: 'https://cdn.example.com/default-content.jpg',
          checksum_sha256: 'abc',
          playlist_item_id: 'pl-001',
        },
        {
          position: 1,
          type: 'prodooh_ssp_call',
          duration_seconds: 10,
        },
        {
          position: 2,
          type: 'playlist_item',
          duration_seconds: 8,
          asset_url: 'https://cdn.example.com/filler.mp4',
          checksum_sha256: 'def',
          playlist_item_id: 'pl-002',
        },
      ];

      const manifest = createManifest(items);
      const playedItems: ManifestItem[] = [];
      const onItemComplete = vi.fn();
      let playCount = 0;

      const engine = new ManifestEngine({
        manifest,
        onItemComplete,
        playbackFn: async (item) => {
          playedItems.push(item);
          playCount++;
          if (playCount >= 3) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      // All items were played in order
      expect(playedItems).toHaveLength(3);
      expect(playedItems[0]!.type).toBe('playlist_item');
      expect(playedItems[1]!.type).toBe('playlist_item'); // SSP fallback (no prefetcher)
      expect(playedItems[2]!.type).toBe('playlist_item');

      // No impressions emitted (onItemComplete not called for playlist_item)
      expect(onItemComplete).not.toHaveBeenCalled();
    });

    it('should loop playlist_item items indefinitely when no order_line_creative items exist', async () => {
      const items: ManifestItem[] = [
        {
          position: 0,
          type: 'playlist_item',
          duration_seconds: 10,
          asset_url: 'https://cdn.example.com/content-a.jpg',
          playlist_item_id: 'pl-a',
        },
        {
          position: 1,
          type: 'playlist_item',
          duration_seconds: 8,
          asset_url: 'https://cdn.example.com/content-b.mp4',
          playlist_item_id: 'pl-b',
        },
      ];

      const manifest = createManifest(items);
      const playedPositions: number[] = [];
      let playCount = 0;
      const totalPlays = 6; // 3 full loops

      const engine = new ManifestEngine({
        manifest,
        playbackFn: async (item) => {
          playedPositions.push(item.position);
          playCount++;
          if (playCount >= totalPlays) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      expect(playedPositions).toHaveLength(totalPlays);
      // Verify correct looping: 0, 1, 0, 1, 0, 1
      for (let i = 0; i < totalPlays; i++) {
        expect(playedPositions[i]).toBe(i % 2);
      }
    });

    it('should handle empty manifest (no items at all) without crashing', async () => {
      const manifest = createManifest([]);
      let iterations = 0;

      const engine = new ManifestEngine({
        manifest,
        playbackFn: async () => {
          iterations++;
          return 'success';
        },
      });

      // Run briefly and stop — the engine should be sleeping on empty manifest
      setTimeout(() => engine.stop(), 50);
      await engine.run();

      // No items were played (engine waits on empty manifest)
      expect(iterations).toBe(0);
    });
  });

  describe('Mixed manifest with and without target_id (backward compat)', () => {
    it('should handle manifests where some items have target_id and others do not', async () => {
      const items: ManifestItem[] = [
        {
          position: 0,
          type: 'order_line_creative',
          duration_seconds: 10,
          asset_url: 'https://cdn.example.com/new-creative.mp4',
          order_line_id: 'ol-new',
          creative_id: 'cr-new',
          target_id: 'target-uuid-new', // New format with target_id
        },
        {
          position: 1,
          type: 'playlist_item',
          duration_seconds: 10,
          asset_url: 'https://cdn.example.com/playlist.jpg',
          playlist_item_id: 'pl-001',
          // No target_id (not applicable for playlist items)
        },
        {
          position: 2,
          type: 'prodooh_ssp_call',
          duration_seconds: 10,
          // No target_id (not applicable for SSP calls)
        },
      ];

      const manifest = createManifest(items);
      const playedItems: ManifestItem[] = [];
      let playCount = 0;

      const engine = new ManifestEngine({
        manifest,
        playbackFn: async (item) => {
          playedItems.push(item);
          playCount++;
          if (playCount >= 3) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      expect(playedItems).toHaveLength(3);
      expect(playedItems[0]!.target_id).toBe('target-uuid-new');
      expect(playedItems[1]!.target_id).toBeUndefined();
      expect(playedItems[2]!.target_id).toBeUndefined();
    });
  });
});
