import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ManifestSyncManager } from '../../src/sync/ManifestSyncManager';
import type { LoopTemplateResponse } from '../../src/sync/ManifestSyncManager';
import { BackendApiClient } from '../../src/api/BackendApiClient';
import { JwtRenewer } from '../../src/api/JwtRenewer';
import type { MediaDownloader } from '../../src/sync/types';

/**
 * Unit tests for ManifestSyncManager — Loop Template format.
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.11
 */

function createTestDb(): Database.Database {
  return new Database(':memory:');
}

function createSampleTemplate(overrides?: Partial<LoopTemplateResponse>): LoopTemplateResponse {
  return {
    version: 'sha256:abc123def456',
    generated_at: '2025-01-15T10:30:00Z',
    loop_config: {
      num_slots: 10,
      slot_duration_seconds: 10,
      loop_duration_seconds: 100,
      loops_per_day: 576,
    },
    slots: [
      {
        position: 0,
        type: 'ad',
        strategy: 'fixed',
        candidates: [{
          order_line_id: 'ol-uuid-001',
          creative_id: 'cr-uuid-001',
          asset_url: '/api/device/content/uuid-1/file',
          checksum_sha256: 'checksum_aaa111',
        }],
      },
      {
        position: 1,
        type: 'ad',
        strategy: 'round_robin',
        candidates: [
          {
            order_line_id: 'ol-uuid-002',
            creative_id: 'cr-uuid-002',
            asset_url: '/api/device/content/uuid-2/file',
            checksum_sha256: 'checksum_bbb222',
            frequency: '1/2',
          },
          {
            order_line_id: 'ol-uuid-003',
            creative_id: 'cr-uuid-003',
            asset_url: '/api/device/content/uuid-3/file',
            checksum_sha256: 'checksum_ccc333',
            frequency: '1/2',
          },
        ],
      },
      {
        position: 7,
        type: 'ssp',
        strategy: 'fixed',
        provider: 'prodooh',
        config: { api_key: 'key', network_id: 'net-1', venue_id: 'venue-1' },
        candidates: [],
      },
      {
        position: 9,
        type: 'playlist',
        strategy: 'round_robin',
        candidates: [{
          playlist_item_id: 'pl-uuid-001',
          asset_url: '/api/device/content/uuid-pl-1/file',
          checksum_sha256: 'checksum_ddd444',
        }],
      },
    ],
    sync_interval_seconds: 120,
    cache_flush_interval_hours: 24,
    ...overrides,
  };
}

function createMockDownloader(overrides?: Partial<MediaDownloader>): MediaDownloader {
  return {
    download: vi.fn().mockResolvedValue('/media/downloaded-file'),
    computeChecksum: vi.fn().mockImplementation(async () => 'default-checksum'),
    ...overrides,
  };
}

describe('ManifestSyncManager (Loop Template format)', () => {
  let db: Database.Database;
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: BackendApiClient;
  let jwtRenewer: JwtRenewer;
  let downloader: MediaDownloader;
  let manager: ManifestSyncManager;

  let blobCounter = 0;

  beforeEach(() => {
    blobCounter = 0;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // Stub URL.createObjectURL for jsdom environment
    if (!URL.createObjectURL) {
      URL.createObjectURL = vi.fn();
    }
    vi.spyOn(URL, 'createObjectURL').mockImplementation(
      () => `blob:test-${++blobCounter}`,
    );

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

  /** Helper: mock a fetch response for GET (manifest poll) */
  function mockFetchGetResponse(status: number, data: unknown = null): void {
    fetchMock.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => data,
      blob: async () => new Blob(['fake-content'], { type: 'video/mp4' }),
    });
  }

  /** Helper: mock a fetch response for asset download */
  function mockAssetDownload(contentType = 'video/mp4'): void {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': contentType }),
      blob: async () => new Blob(['fake-asset'], { type: contentType }),
    });
  }

  /** Helper: mock failed asset download */
  function mockAssetDownloadFailure(): void {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers({}),
    });
  }

  /** Helper: setup downloader to return matching checksums for a template */
  function setupChecksumMatching(template: LoopTemplateResponse): void {
    const checksums: string[] = [];
    for (const slot of template.slots) {
      for (const candidate of slot.candidates) {
        if (candidate.asset_url && candidate.checksum_sha256) {
          checksums.push(candidate.checksum_sha256);
        }
      }
    }
    const mock = downloader.computeChecksum as ReturnType<typeof vi.fn>;
    for (const checksum of checksums) {
      mock.mockResolvedValueOnce(checksum);
    }
  }

  describe('HTTP 304 — no change detection (Req 7.2)', () => {
    it('should return false and not trigger downloads when backend returns 304', async () => {
      mockFetchGetResponse(304);

      const result = await manager.sync();

      expect(result).toBe(false);
      expect(manager.getTemplate()).toBeNull();
    });

    it('should not change the current template on 304', async () => {
      // First sync: apply a template
      const template = createSampleTemplate();
      mockFetchGetResponse(200, template);
      // Mock asset downloads (4 unique assets)
      mockAssetDownload(); mockAssetDownload(); mockAssetDownload(); mockAssetDownload();
      setupChecksumMatching(template);

      await manager.sync();
      expect(manager.getManifestVersion()).toBe('sha256:abc123def456');

      // Second sync: 304 no change
      mockFetchGetResponse(304);
      const result = await manager.sync();

      expect(result).toBe(false);
      expect(manager.getManifestVersion()).toBe('sha256:abc123def456');
    });
  });

  describe('ETag/If-None-Match support (Req 7.2)', () => {
    it('should send If-None-Match header with current version', async () => {
      // First sync to set a version
      const template = createSampleTemplate();
      mockFetchGetResponse(200, template);
      mockAssetDownload(); mockAssetDownload(); mockAssetDownload(); mockAssetDownload();
      setupChecksumMatching(template);

      await manager.sync();

      // Second sync should include If-None-Match
      mockFetchGetResponse(304);
      await manager.sync();

      // Check the second GET call has If-None-Match header
      const secondGetCall = fetchMock.mock.calls[5]!; // 1 GET + 4 downloads = 5, so idx 5 is 2nd GET
      const headers = secondGetCall[1].headers as Record<string, string>;
      expect(headers['If-None-Match']).toBe('sha256:abc123def456');
    });

    it('should not send If-None-Match when no version exists', async () => {
      mockFetchGetResponse(304);
      await manager.sync();

      const firstGetCall = fetchMock.mock.calls[0]!;
      const headers = firstGetCall[1].headers as Record<string, string>;
      expect(headers['If-None-Match']).toBeUndefined();
    });
  });

  describe('Parse Loop Template JSON format (Req 7.3)', () => {
    it('should parse and store a Loop Template response', async () => {
      const template = createSampleTemplate();
      mockFetchGetResponse(200, template);
      mockAssetDownload(); mockAssetDownload(); mockAssetDownload(); mockAssetDownload();
      setupChecksumMatching(template);

      const result = await manager.sync();

      expect(result).toBe(true);
      expect(manager.getTemplate()).toEqual(template);
      expect(manager.getManifestVersion()).toBe('sha256:abc123def456');
    });

    it('should also produce a legacy manifest for backward compatibility', async () => {
      const template = createSampleTemplate();
      mockFetchGetResponse(200, template);
      mockAssetDownload(); mockAssetDownload(); mockAssetDownload(); mockAssetDownload();
      setupChecksumMatching(template);

      await manager.sync();

      const legacy = manager.getManifest();
      expect(legacy).not.toBeNull();
      expect(legacy!.version).toBe(template.version);
      expect(legacy!.generated_at).toBe(template.generated_at);
      expect(legacy!.items.length).toBe(template.slots.length);
    });
  });

  describe('Differential asset download by checksum (Req 7.4)', () => {
    it('should download only new assets whose checksum is not locally cached', async () => {
      // First sync: downloads all 4 unique assets
      const template = createSampleTemplate();
      mockFetchGetResponse(200, template);
      mockAssetDownload(); mockAssetDownload(); mockAssetDownload(); mockAssetDownload();
      setupChecksumMatching(template);

      await manager.sync();

      // Second sync: same template with one new asset added
      const template2 = createSampleTemplate({
        version: 'sha256:newversion789',
        slots: [
          ...template.slots,
          {
            position: 2,
            type: 'ad',
            strategy: 'fixed',
            candidates: [{
              order_line_id: 'ol-new',
              creative_id: 'cr-new',
              asset_url: '/api/device/content/uuid-new/file',
              checksum_sha256: 'checksum_new999',
            }],
          },
        ],
      });

      mockFetchGetResponse(200, template2);
      // Only the NEW asset should be downloaded (1 download)
      mockAssetDownload();
      (downloader.computeChecksum as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('checksum_new999');

      const result = await manager.sync();
      expect(result).toBe(true);

      // The fetch for downloads: 1 GET + 1 asset download = 2 calls in second sync
      // Total calls: first sync (1 GET + 4 downloads) + second sync (1 GET + 1 download) = 7
      const totalFetchCalls = fetchMock.mock.calls.length;
      expect(totalFetchCalls).toBe(7);
    });

    it('should not re-download assets with same checksum even if URL changed', async () => {
      // First sync: download asset with checksum_aaa111
      const template = createSampleTemplate();
      mockFetchGetResponse(200, template);
      mockAssetDownload(); mockAssetDownload(); mockAssetDownload(); mockAssetDownload();
      setupChecksumMatching(template);

      await manager.sync();

      // Second sync: same checksum, different URL — should NOT re-download
      const template2 = createSampleTemplate({
        version: 'sha256:v2',
        slots: [{
          position: 0,
          type: 'ad',
          strategy: 'fixed',
          candidates: [{
            order_line_id: 'ol-uuid-001',
            creative_id: 'cr-uuid-001',
            asset_url: '/api/device/content/uuid-1-new-url/file',
            checksum_sha256: 'checksum_aaa111', // same checksum!
          }],
        }],
      });

      mockFetchGetResponse(200, template2);
      // No new downloads expected (checksum already cached)

      const result = await manager.sync();
      expect(result).toBe(true);
      // Total: first (1 GET + 4 downloads) + second (1 GET + 0 downloads) = 6
      expect(fetchMock.mock.calls.length).toBe(6);
    });
  });

  describe('Download failure keeps previous template (Req 7.5)', () => {
    it('should return false and keep previous template when download fails', async () => {
      // First sync succeeds
      const template = createSampleTemplate();
      mockFetchGetResponse(200, template);
      mockAssetDownload(); mockAssetDownload(); mockAssetDownload(); mockAssetDownload();
      setupChecksumMatching(template);

      await manager.sync();
      expect(manager.getManifestVersion()).toBe('sha256:abc123def456');

      // Second sync: new template with a new asset that fails to download
      const template2 = createSampleTemplate({
        version: 'sha256:v2failed',
        slots: [{
          position: 0,
          type: 'ad',
          strategy: 'fixed',
          candidates: [{
            order_line_id: 'ol-new',
            creative_id: 'cr-new',
            asset_url: '/api/device/content/uuid-fail/file',
            checksum_sha256: 'checksum_fail_xxx',
          }],
        }],
      });

      mockFetchGetResponse(200, template2);
      mockAssetDownloadFailure(); // Download fails

      const result = await manager.sync();
      expect(result).toBe(false);
      // Previous template is still active
      expect(manager.getManifestVersion()).toBe('sha256:abc123def456');
      expect(manager.getTemplate()).toEqual(template);
    });

    it('should return false when checksum validation fails', async () => {
      const template = createSampleTemplate();
      mockFetchGetResponse(200, template);
      mockAssetDownload(); // first download succeeds
      // But checksum doesn't match
      (downloader.computeChecksum as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('wrong-checksum');

      const result = await manager.sync();
      expect(result).toBe(false);
      expect(manager.getManifestVersion()).toBeNull();
    });
  });

  describe('LRU eligibility for removed assets (Req 7.6)', () => {
    it('should mark assets no longer in template as LRU eligible', async () => {
      // First sync with 4 assets
      const template = createSampleTemplate();
      mockFetchGetResponse(200, template);
      mockAssetDownload(); mockAssetDownload(); mockAssetDownload(); mockAssetDownload();
      setupChecksumMatching(template);

      await manager.sync();
      expect(manager.getLruEligibleChecksums().size).toBe(0);

      // Second sync: only 1 asset remains (checksum_aaa111)
      const template2 = createSampleTemplate({
        version: 'sha256:v2-reduced',
        slots: [{
          position: 0,
          type: 'ad',
          strategy: 'fixed',
          candidates: [{
            order_line_id: 'ol-uuid-001',
            creative_id: 'cr-uuid-001',
            asset_url: '/api/device/content/uuid-1/file',
            checksum_sha256: 'checksum_aaa111',
          }],
        }],
      });

      mockFetchGetResponse(200, template2);
      // No new downloads (checksum_aaa111 already cached)

      await manager.sync();

      // 3 assets should be LRU eligible (removed from template)
      const eligible = manager.getLruEligibleChecksums();
      expect(eligible.size).toBe(3);
      expect(eligible.has('checksum_bbb222')).toBe(true);
      expect(eligible.has('checksum_ccc333')).toBe(true);
      expect(eligible.has('checksum_ddd444')).toBe(true);
      // The remaining asset should NOT be eligible
      expect(eligible.has('checksum_aaa111')).toBe(false);
    });
  });

  describe('Active template assets protected from LRU (Req 7.7)', () => {
    it('should protect active template assets from LRU cleanup', async () => {
      const template = createSampleTemplate();
      mockFetchGetResponse(200, template);
      mockAssetDownload(); mockAssetDownload(); mockAssetDownload(); mockAssetDownload();
      setupChecksumMatching(template);

      await manager.sync();

      const active = manager.getActiveAssetChecksums();
      expect(active.has('checksum_aaa111')).toBe(true);
      expect(active.has('checksum_bbb222')).toBe(true);
      expect(active.has('checksum_ccc333')).toBe(true);
      expect(active.has('checksum_ddd444')).toBe(true);

      expect(manager.isAssetProtected('checksum_aaa111')).toBe(true);
      expect(manager.isAssetProtected('some-random-checksum')).toBe(false);
    });

    it('should re-protect an asset if it returns to the template', async () => {
      // First sync: 4 assets active
      const template = createSampleTemplate();
      mockFetchGetResponse(200, template);
      mockAssetDownload(); mockAssetDownload(); mockAssetDownload(); mockAssetDownload();
      setupChecksumMatching(template);
      await manager.sync();

      // Second sync: remove checksum_ddd444
      const template2 = createSampleTemplate({
        version: 'sha256:v2',
        slots: [
          template.slots[0]!, template.slots[1]!, template.slots[2]!,
        ],
      });
      mockFetchGetResponse(200, template2);
      await manager.sync();
      expect(manager.getLruEligibleChecksums().has('checksum_ddd444')).toBe(true);

      // Third sync: checksum_ddd444 is back
      const template3 = createSampleTemplate({
        version: 'sha256:v3',
      });
      mockFetchGetResponse(200, template3);
      await manager.sync();
      // Should no longer be LRU eligible
      expect(manager.getLruEligibleChecksums().has('checksum_ddd444')).toBe(false);
      expect(manager.isAssetProtected('checksum_ddd444')).toBe(true);
    });
  });

  describe('sync_interval_seconds from template response (Req 7.1)', () => {
    it('should update sync interval from template response', async () => {
      const template = createSampleTemplate({ sync_interval_seconds: 60 });
      mockFetchGetResponse(200, template);
      mockAssetDownload(); mockAssetDownload(); mockAssetDownload(); mockAssetDownload();
      setupChecksumMatching(template);

      await manager.sync();

      expect(manager.getSyncIntervalMs()).toBe(60_000);
    });

    it('should use default 240s when starting fresh', () => {
      expect(manager.getSyncIntervalMs()).toBe(240_000);
    });
  });

  describe('Network error — continue with local template (Req 7.11)', () => {
    it('should return false on network error and keep current template', async () => {
      // First sync succeeds
      const template = createSampleTemplate();
      mockFetchGetResponse(200, template);
      mockAssetDownload(); mockAssetDownload(); mockAssetDownload(); mockAssetDownload();
      setupChecksumMatching(template);
      await manager.sync();

      // Second sync: network error
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await manager.sync();
      expect(result).toBe(false);
      expect(manager.getTemplate()).toEqual(template);
    });
  });

  describe('Template update callback (onTemplateUpdate)', () => {
    it('should fire template update callbacks on new template', async () => {
      const callback = vi.fn();
      manager.onTemplateUpdate(callback);

      const template = createSampleTemplate();
      mockFetchGetResponse(200, template);
      mockAssetDownload(); mockAssetDownload(); mockAssetDownload(); mockAssetDownload();
      setupChecksumMatching(template);

      await manager.sync();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(template);
    });

    it('should not fire callback on 304', async () => {
      const callback = vi.fn();
      manager.onTemplateUpdate(callback);

      mockFetchGetResponse(304);
      await manager.sync();

      expect(callback).not.toHaveBeenCalled();
    });

    it('should not fire callback on download failure', async () => {
      const callback = vi.fn();
      manager.onTemplateUpdate(callback);

      const template = createSampleTemplate();
      mockFetchGetResponse(200, template);
      mockAssetDownloadFailure();

      await manager.sync();

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('Legacy onManifestUpdate callback', () => {
    it('should fire legacy callbacks with converted manifest format', async () => {
      const callback = vi.fn();
      manager.onManifestUpdate(callback);

      const template = createSampleTemplate();
      mockFetchGetResponse(200, template);
      mockAssetDownload(); mockAssetDownload(); mockAssetDownload(); mockAssetDownload();
      setupChecksumMatching(template);

      await manager.sync();

      expect(callback).toHaveBeenCalledTimes(1);
      const legacy = callback.mock.calls[0]![0];
      expect(legacy.version).toBe(template.version);
      expect(legacy.items).toBeDefined();
    });
  });

  describe('Persistence and state restore', () => {
    it('should restore Loop Template from SQLite on construction', async () => {
      const template = createSampleTemplate();
      mockFetchGetResponse(200, template);
      mockAssetDownload(); mockAssetDownload(); mockAssetDownload(); mockAssetDownload();
      setupChecksumMatching(template);

      await manager.sync();

      // New instance with same DB
      const newManager = new ManifestSyncManager(client, db, downloader, jwtRenewer);
      expect(newManager.getManifestVersion()).toBe('sha256:abc123def456');
      expect(newManager.getTemplate()).toEqual(template);
      // Sync interval restored
      expect(newManager.getSyncIntervalMs()).toBe(120_000);
      newManager.stopPeriodicSync();
    });

    it('should start with null when DB is empty', () => {
      const freshDb = createTestDb();
      const freshManager = new ManifestSyncManager(client, freshDb, downloader, jwtRenewer);
      expect(freshManager.getManifestVersion()).toBeNull();
      expect(freshManager.getTemplate()).toBeNull();
      freshManager.stopPeriodicSync();
      freshDb.close();
    });
  });
});
