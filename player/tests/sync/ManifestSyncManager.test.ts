import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ManifestSyncManager } from '../../src/sync/ManifestSyncManager';
import type { Manifest, ManifestItem } from '../../src/sync/ManifestSyncManager';
import { BackendApiClient } from '../../src/api/BackendApiClient';
import { JwtRenewer } from '../../src/api/JwtRenewer';
import type { MediaDownloader } from '../../src/sync/types';

/**
 * Unit tests for ManifestSyncManager.
 * Validates: Requirements 7.2, 8.1, 8.3
 */

function createTestDb(): Database.Database {
  return new Database(':memory:');
}

function createSampleManifest(overrides?: Partial<Manifest>): Manifest {
  return {
    version: 'sha256-abc123',
    generated_at: '2026-07-09T06:00:00-06:00',
    items: [
      {
        position: 0,
        type: 'order_line_creative',
        duration_seconds: 10,
        asset_url: 'https://cdn.example.com/content/xyz.mp4',
        checksum_sha256: 'a1b2c3d4e5f6',
        order_line_id: 'ol-uuid-001',
        creative_id: 'cr-uuid-001',
      },
      {
        position: 1,
        type: 'prodooh_ssp_call',
        duration_seconds: 10,
      },
      {
        position: 2,
        type: 'playlist_item',
        duration_seconds: 10,
        asset_url: 'https://cdn.example.com/content/abc.jpg',
        checksum_sha256: 'd4e5f6a7b8c9',
        playlist_item_id: 'pl-uuid-001',
      },
    ],
    ...overrides,
  };
}

function createMockDownloader(overrides?: Partial<MediaDownloader>): MediaDownloader {
  return {
    download: vi.fn().mockResolvedValue('/media/downloaded-file'),
    computeChecksum: vi.fn().mockResolvedValue('a1b2c3d4e5f6'),
    ...overrides,
  };
}

describe('ManifestSyncManager', () => {
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

  /** Helper: mock a fetch response */
  function mockFetchResponse(status: number, data: unknown = null): void {
    fetchMock.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => data,
    });
  }

  describe('sync returns false on 304 (no download triggered)', () => {
    it('should return false and not trigger downloads when backend returns 304', async () => {
      mockFetchResponse(304);

      const result = await manager.sync();

      expect(result).toBe(false);
      expect(downloader.download).not.toHaveBeenCalled();
      expect(manager.getManifest()).toBeNull();
    });

    it('should not change the current manifest on 304', async () => {
      // First sync: apply a manifest
      const manifest = createSampleManifest();
      mockFetchResponse(200, manifest);
      // Mock downloads that match checksums
      (downloader.computeChecksum as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('a1b2c3d4e5f6')  // first item
        .mockResolvedValueOnce('d4e5f6a7b8c9');  // third item
      mockFetchResponse(200, { ok: true }); // confirm

      await manager.sync();
      expect(manager.getManifestVersion()).toBe('sha256-abc123');

      // Second sync: 304 no change
      mockFetchResponse(304);
      const result = await manager.sync();

      expect(result).toBe(false);
      expect(manager.getManifestVersion()).toBe('sha256-abc123');
    });
  });

  describe('sync 200 triggers download + checksum validation + confirm', () => {
    it('should download assets, validate checksums, confirm, and return true', async () => {
      const manifest = createSampleManifest();
      mockFetchResponse(200, manifest);

      // computeChecksum should match the manifest checksums
      (downloader.computeChecksum as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('a1b2c3d4e5f6')  // matches item[0] checksum
        .mockResolvedValueOnce('d4e5f6a7b8c9');  // matches item[2] checksum

      // confirm POST
      mockFetchResponse(200, { ok: true });

      const result = await manager.sync();

      expect(result).toBe(true);
      expect(manager.getManifestVersion()).toBe('sha256-abc123');
      expect(manager.getManifest()).toEqual(manifest);

      // Only items with asset_url should be downloaded (position 0 and 2, not SSP)
      expect(downloader.download).toHaveBeenCalledTimes(2);
      expect(downloader.download).toHaveBeenCalledWith(
        'https://cdn.example.com/content/xyz.mp4',
        'cr-uuid-001',
      );
      expect(downloader.download).toHaveBeenCalledWith(
        'https://cdn.example.com/content/abc.jpg',
        'pl-uuid-001',
      );

      // Checksums validated
      expect(downloader.computeChecksum).toHaveBeenCalledTimes(2);

      // Confirm POST sent with version
      expect(fetchMock).toHaveBeenCalledTimes(2); // GET manifest + POST confirm
      const confirmCall = fetchMock.mock.calls[1]!;
      expect(confirmCall[0]).toBe('http://localhost:8000/api/device/manifest/confirm');
      const confirmBody = JSON.parse(confirmCall[1].body as string);
      expect(confirmBody).toEqual({ version: 'sha256-abc123' });
    });

    it('should fail if checksum does not match', async () => {
      const manifest = createSampleManifest();
      mockFetchResponse(200, manifest);

      // First checksum mismatch
      (downloader.computeChecksum as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('wrong-checksum');

      const result = await manager.sync();

      expect(result).toBe(false);
      expect(manager.getManifestVersion()).toBeNull();
    });
  });

  describe('keeps new manifest if confirm fails', () => {
    it('should return true and keep manifest even when confirm POST fails (500)', async () => {
      const manifest = createSampleManifest();
      mockFetchResponse(200, manifest);

      (downloader.computeChecksum as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('a1b2c3d4e5f6')
        .mockResolvedValueOnce('d4e5f6a7b8c9');

      // Confirm fails with 500
      mockFetchResponse(500);

      const result = await manager.sync();

      // Still returns true — no rollback on confirm failure (deliberate design)
      expect(result).toBe(true);
      expect(manager.getManifestVersion()).toBe('sha256-abc123');
      expect(manager.getManifest()).toEqual(manifest);
    });

    it('should return true and keep manifest when confirm POST has network error', async () => {
      const manifest = createSampleManifest();
      mockFetchResponse(200, manifest);

      (downloader.computeChecksum as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('a1b2c3d4e5f6')
        .mockResolvedValueOnce('d4e5f6a7b8c9');

      // Network error on confirm
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await manager.sync();

      expect(result).toBe(true);
      expect(manager.getManifestVersion()).toBe('sha256-abc123');
    });
  });

  describe('download failure aborts sync', () => {
    it('should return false and not update manifest when download fails', async () => {
      const manifest = createSampleManifest();
      mockFetchResponse(200, manifest);

      // Download fails for first item
      (downloader.download as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const result = await manager.sync();

      expect(result).toBe(false);
      expect(manager.getManifestVersion()).toBeNull();
      expect(manager.getManifest()).toBeNull();
    });
  });

  describe('If-None-Match header sent when version exists', () => {
    it('should include If-None-Match header with current version', async () => {
      // First sync to set a version
      const manifest = createSampleManifest();
      mockFetchResponse(200, manifest);
      (downloader.computeChecksum as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('a1b2c3d4e5f6')
        .mockResolvedValueOnce('d4e5f6a7b8c9');
      mockFetchResponse(200, { ok: true }); // confirm

      await manager.sync();

      // Second sync should include If-None-Match
      mockFetchResponse(304);

      await manager.sync();

      // Check the second GET call has If-None-Match header
      const secondGetCall = fetchMock.mock.calls[2]!; // calls[0]=GET, calls[1]=POST confirm, calls[2]=second GET
      const headers = secondGetCall[1].headers as Record<string, string>;
      expect(headers['If-None-Match']).toBe('sha256-abc123');
    });

    it('should not include If-None-Match header when no version exists', async () => {
      mockFetchResponse(304);

      await manager.sync();

      const firstGetCall = fetchMock.mock.calls[0]!;
      const headers = firstGetCall[1].headers as Record<string, string>;
      expect(headers['If-None-Match']).toBeUndefined();
    });
  });

  describe('onManifestUpdate callback fires', () => {
    it('should call registered callbacks when a new manifest is applied', async () => {
      const callback = vi.fn();
      manager.onManifestUpdate(callback);

      const manifest = createSampleManifest();
      mockFetchResponse(200, manifest);
      (downloader.computeChecksum as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('a1b2c3d4e5f6')
        .mockResolvedValueOnce('d4e5f6a7b8c9');
      mockFetchResponse(200, { ok: true }); // confirm

      await manager.sync();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(manifest);
    });

    it('should not call callback on 304 (no update)', async () => {
      const callback = vi.fn();
      manager.onManifestUpdate(callback);

      mockFetchResponse(304);

      await manager.sync();

      expect(callback).not.toHaveBeenCalled();
    });

    it('should not call callback when download fails', async () => {
      const callback = vi.fn();
      manager.onManifestUpdate(callback);

      const manifest = createSampleManifest();
      mockFetchResponse(200, manifest);
      (downloader.download as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      await manager.sync();

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('restores state from SQLite on construction', () => {
    it('should restore version and manifest from SQLite when creating a new instance', async () => {
      // First instance: sync and persist manifest
      const manifest = createSampleManifest();
      mockFetchResponse(200, manifest);
      (downloader.computeChecksum as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('a1b2c3d4e5f6')
        .mockResolvedValueOnce('d4e5f6a7b8c9');
      mockFetchResponse(200, { ok: true }); // confirm

      await manager.sync();
      expect(manager.getManifestVersion()).toBe('sha256-abc123');

      // Create a new instance with the same DB — should restore state
      const newManager = new ManifestSyncManager(client, db, downloader, jwtRenewer);

      expect(newManager.getManifestVersion()).toBe('sha256-abc123');
      expect(newManager.getManifest()).toEqual(manifest);

      newManager.stopPeriodicSync();
    });

    it('should start with null version when DB is empty', () => {
      const freshDb = createTestDb();
      const freshManager = new ManifestSyncManager(client, freshDb, downloader, jwtRenewer);

      expect(freshManager.getManifestVersion()).toBeNull();
      expect(freshManager.getManifest()).toBeNull();

      freshManager.stopPeriodicSync();
      freshDb.close();
    });
  });
});
