/**
 * Property-based test for differential asset download by checksum (Property 16).
 *
 * Uses fast-check to generate random templates with overlapping and new assets,
 * validating that ManifestSyncManager downloads only assets whose checksum_sha256
 * in the new template does not match any asset stored locally.
 *
 * **Validates: Requirements 7.4**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import Database from 'better-sqlite3';
import { ManifestSyncManager } from '../../src/sync/ManifestSyncManager';
import type { LoopTemplateResponse, LoopSlotContract, CandidateContract } from '../../src/sync/ManifestSyncManager';
import { BackendApiClient } from '../../src/api/BackendApiClient';
import { JwtRenewer } from '../../src/api/JwtRenewer';
import type { MediaDownloader } from '../../src/sync/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  return new Database(':memory:');
}

function createMockDownloader(
  checksumMap: Map<string, string>,
): MediaDownloader {
  return {
    download: vi.fn().mockResolvedValue('/media/downloaded-file'),
    computeChecksum: vi.fn().mockImplementation(async (filePath: string) => {
      // Return the checksum associated with this blob URL from our tracking map
      return checksumMap.get(filePath) ?? 'unknown-checksum';
    }),
  };
}

/**
 * Build a valid LoopTemplateResponse from a list of assets (checksum + url pairs).
 * Places all assets as candidates in ad slots with round_robin strategy.
 */
function buildTemplate(
  assets: Array<{ checksum: string; url: string }>,
  version: string,
): LoopTemplateResponse {
  const slots: LoopSlotContract[] = [];

  // Create one ad slot per asset for simplicity
  for (let i = 0; i < assets.length; i++) {
    const candidate: CandidateContract = {
      order_line_id: `ol-${i}`,
      creative_id: `cr-${i}`,
      asset_url: assets[i].url,
      checksum_sha256: assets[i].checksum,
    };
    slots.push({
      position: i,
      type: 'ad',
      strategy: 'fixed',
      candidates: [candidate],
    });
  }

  return {
    version,
    generated_at: '2025-01-15T10:30:00Z',
    loop_config: {
      num_slots: Math.max(assets.length, 1),
      slot_duration_seconds: 10,
      loop_duration_seconds: Math.max(assets.length, 1) * 10,
      loops_per_day: 576,
    },
    slots,
    sync_interval_seconds: 240,
    cache_flush_interval_hours: 24,
  };
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a hex-like checksum string (64 chars, simulating SHA-256) */
const arbChecksum = fc.stringMatching(/^[a-f0-9]{64}$/);

/** Generate a unique asset URL */
const arbAssetUrl = fc.integer({ min: 1, max: 10000 }).map(
  (id) => `/api/device/content/uuid-${id}/file`,
);

/** Generate an asset entry (checksum + url) */
const arbAsset = fc.record({
  checksum: arbChecksum,
  url: arbAssetUrl,
});

/**
 * Generate a pair of templates (previous and new) for the same screen
 * with controlled overlap:
 * - sharedAssets: assets present in both templates (same checksum)
 * - oldOnlyAssets: assets only in the previous template (removed)
 * - newOnlyAssets: assets only in the new template (must be downloaded)
 */
const arbTemplatePair = fc
  .record({
    sharedAssets: fc.array(arbAsset, { minLength: 0, maxLength: 5 }),
    oldOnlyAssets: fc.array(arbAsset, { minLength: 0, maxLength: 5 }),
    newOnlyAssets: fc.array(arbAsset, { minLength: 0, maxLength: 5 }),
  })
  .filter(({ sharedAssets, oldOnlyAssets, newOnlyAssets }) => {
    // Ensure at least one asset in the new template
    if (sharedAssets.length + newOnlyAssets.length === 0) return false;
    // Ensure at least one asset in the old template
    if (sharedAssets.length + oldOnlyAssets.length === 0) return false;
    // Ensure all checksums are unique across all sets
    const allChecksums = [
      ...sharedAssets.map((a) => a.checksum),
      ...oldOnlyAssets.map((a) => a.checksum),
      ...newOnlyAssets.map((a) => a.checksum),
    ];
    if (new Set(allChecksums).size !== allChecksums.length) return false;
    // Ensure all URLs are unique across all sets to simplify fetch tracking
    const allUrls = [
      ...sharedAssets.map((a) => a.url),
      ...oldOnlyAssets.map((a) => a.url),
      ...newOnlyAssets.map((a) => a.url),
    ];
    return new Set(allUrls).size === allUrls.length;
  });

// ─── Property 16: Differential asset download by checksum ────────────────────

/**
 * Tag: Feature: 12-simil-ad-manager, Property 16: Differential asset download by checksum
 *
 * **Validates: Requirements 7.4**
 *
 * For any pair of Loop Templates (previous and new) for the same screen, the player
 * must download only the assets whose checksum_sha256 in the new template does not
 * match any asset stored locally. Assets with identical checksum must not be downloaded.
 */
describe('Feature: 12-simil-ad-manager, Property 16: Differential asset download by checksum', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let blobCounter: number;

  beforeEach(() => {
    blobCounter = 0;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    if (!URL.createObjectURL) {
      URL.createObjectURL = vi.fn();
    }
    vi.spyOn(URL, 'createObjectURL').mockImplementation(
      () => `blob:test-${++blobCounter}`,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('downloads only assets with new checksums, skips assets already stored locally', async () => {
    await fc.assert(
      fc.asyncProperty(arbTemplatePair, async ({ sharedAssets, oldOnlyAssets, newOnlyAssets }) => {
        const db = createTestDb();

        try {
          // Track which checksums the downloader will return for verification
          const checksumMap = new Map<string, string>();

          const downloader = createMockDownloader(checksumMap);
          const downloadFn = downloader.download as ReturnType<typeof vi.fn>;

          const client = new BackendApiClient('http://localhost:8000');
          client.setToken('test-token');
          const jwtRenewer = new JwtRenewer(client, '/api/device/auth');
          const manager = new ManifestSyncManager(client, db, downloader, jwtRenewer);

          // ─── Phase 1: Sync the "previous" template ─────────────────────

          const oldAssets = [...sharedAssets, ...oldOnlyAssets];
          const oldTemplate = buildTemplate(oldAssets, 'sha256:version-old');

          // Mock the GET /api/device/manifest response for old template
          fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => oldTemplate,
            blob: async () => new Blob(['content'], { type: 'video/mp4' }),
          });

          // Mock all asset downloads for old template
          for (const asset of oldAssets) {
            fetchMock.mockResolvedValueOnce({
              ok: true,
              status: 200,
              headers: new Headers({ 'content-type': 'video/mp4' }),
              blob: async () => new Blob(['asset-data'], { type: 'video/mp4' }),
            });
            // Map the blob URL that will be created to the expected checksum
            checksumMap.set(`blob:test-${blobCounter + 1 + oldAssets.indexOf(asset)}`, asset.checksum);
          }

          // Set up checksum validation for old template assets
          const computeChecksumFn = downloader.computeChecksum as ReturnType<typeof vi.fn>;
          for (const asset of oldAssets) {
            computeChecksumFn.mockResolvedValueOnce(asset.checksum);
          }

          await manager.sync();

          // Verify old template was applied
          expect(manager.getManifestVersion()).toBe('sha256:version-old');

          // ─── Phase 2: Record state before new sync ─────────────────────

          // Reset all mock call counts to track only new phase activity
          downloadFn.mockClear();
          fetchMock.mockReset();
          computeChecksumFn.mockClear();

          // ─── Phase 3: Sync the "new" template ──────────────────────────

          const newAssets = [...sharedAssets, ...newOnlyAssets];
          const newTemplate = buildTemplate(newAssets, 'sha256:version-new');

          // Mock the GET /api/device/manifest response for new template
          fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => newTemplate,
            blob: async () => new Blob(['content'], { type: 'video/mp4' }),
          });

          // Mock asset downloads for NEW assets only (shared ones shouldn't be requested)
          for (const asset of newOnlyAssets) {
            fetchMock.mockResolvedValueOnce({
              ok: true,
              status: 200,
              headers: new Headers({ 'content-type': 'video/mp4' }),
              blob: async () => new Blob(['new-asset-data'], { type: 'video/mp4' }),
            });
          }

          // Set up checksum validation for new assets (only new ones are downloaded)
          for (const asset of newOnlyAssets) {
            computeChecksumFn.mockResolvedValueOnce(asset.checksum);
          }

          await manager.sync();

          // ─── Assertions ────────────────────────────────────────────────

          // PROPERTY: New template was applied
          expect(manager.getManifestVersion()).toBe('sha256:version-new');

          // PROPERTY: Number of fetch calls = 1 (GET manifest) + newOnlyAssets.length (downloads)
          // Shared assets should NOT trigger any download
          const expectedFetchCalls = 1 + newOnlyAssets.length;
          expect(fetchMock).toHaveBeenCalledTimes(expectedFetchCalls);

          // PROPERTY: computeChecksum called exactly once per new asset downloaded
          // (shared assets are recognized by checksum and not re-downloaded)
          expect(computeChecksumFn).toHaveBeenCalledTimes(newOnlyAssets.length);

        } finally {
          db.close();
        }
      }),
      { numRuns: 100 },
    );
  });

  it('downloads zero assets when all checksums in new template match local storage', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbAsset, { minLength: 1, maxLength: 8 }).filter(
          (assets) => new Set(assets.map((a) => a.checksum)).size === assets.length,
        ),
        async (assets) => {
          const db = createTestDb();

          try {
            const checksumMap = new Map<string, string>();
            const downloader = createMockDownloader(checksumMap);
            const computeChecksumFn = downloader.computeChecksum as ReturnType<typeof vi.fn>;

            const client = new BackendApiClient('http://localhost:8000');
            client.setToken('test-token');
            const jwtRenewer = new JwtRenewer(client, '/api/device/auth');
            const manager = new ManifestSyncManager(client, db, downloader, jwtRenewer);

            // ─── Phase 1: Sync template (all assets downloaded) ──────────

            const templateV1 = buildTemplate(assets, 'sha256:version-1');

            fetchMock.mockResolvedValueOnce({
              ok: true,
              status: 200,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: async () => templateV1,
              blob: async () => new Blob(['content'], { type: 'video/mp4' }),
            });

            for (const asset of assets) {
              fetchMock.mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'video/mp4' }),
                blob: async () => new Blob(['asset-data'], { type: 'video/mp4' }),
              });
            }

            for (const asset of assets) {
              computeChecksumFn.mockResolvedValueOnce(asset.checksum);
            }

            await manager.sync();
            expect(manager.getManifestVersion()).toBe('sha256:version-1');

            // ─── Phase 2: Sync same assets with different version ─────────

            fetchMock.mockReset();
            computeChecksumFn.mockReset();

            // Same assets, different version (e.g., generated_at changed)
            const templateV2 = buildTemplate(assets, 'sha256:version-2');

            fetchMock.mockResolvedValueOnce({
              ok: true,
              status: 200,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: async () => templateV2,
              blob: async () => new Blob(['content'], { type: 'video/mp4' }),
            });

            await manager.sync();

            // PROPERTY: Only 1 fetch call (GET manifest), zero downloads
            expect(fetchMock).toHaveBeenCalledTimes(1);

            // PROPERTY: computeChecksum never called (no downloads to validate)
            expect(computeChecksumFn).not.toHaveBeenCalled();

            // PROPERTY: Template was updated despite no downloads
            expect(manager.getManifestVersion()).toBe('sha256:version-2');
          } finally {
            db.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('downloads all assets when no local assets match new template checksums', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          oldAssets: fc.array(arbAsset, { minLength: 1, maxLength: 5 }).filter(
            (a) => new Set(a.map((x) => x.checksum)).size === a.length,
          ),
          newAssets: fc.array(arbAsset, { minLength: 1, maxLength: 5 }).filter(
            (a) => new Set(a.map((x) => x.checksum)).size === a.length,
          ),
        }).filter(({ oldAssets, newAssets }) => {
          // Ensure no checksum overlap between old and new
          const oldChecksums = new Set(oldAssets.map((a) => a.checksum));
          return newAssets.every((a) => !oldChecksums.has(a.checksum));
        }),
        async ({ oldAssets, newAssets }) => {
          const db = createTestDb();

          try {
            const checksumMap = new Map<string, string>();
            const downloader = createMockDownloader(checksumMap);
            const computeChecksumFn = downloader.computeChecksum as ReturnType<typeof vi.fn>;

            const client = new BackendApiClient('http://localhost:8000');
            client.setToken('test-token');
            const jwtRenewer = new JwtRenewer(client, '/api/device/auth');
            const manager = new ManifestSyncManager(client, db, downloader, jwtRenewer);

            // ─── Phase 1: Sync old template ──────────────────────────────

            const oldTemplate = buildTemplate(oldAssets, 'sha256:version-old');

            fetchMock.mockResolvedValueOnce({
              ok: true,
              status: 200,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: async () => oldTemplate,
              blob: async () => new Blob(['content'], { type: 'video/mp4' }),
            });

            for (const asset of oldAssets) {
              fetchMock.mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'video/mp4' }),
                blob: async () => new Blob(['old-asset-data'], { type: 'video/mp4' }),
              });
            }

            for (const asset of oldAssets) {
              computeChecksumFn.mockResolvedValueOnce(asset.checksum);
            }

            await manager.sync();

            // ─── Phase 2: Sync completely new template ────────────────────

            fetchMock.mockReset();
            computeChecksumFn.mockReset();

            const newTemplate = buildTemplate(newAssets, 'sha256:version-new');

            fetchMock.mockResolvedValueOnce({
              ok: true,
              status: 200,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: async () => newTemplate,
              blob: async () => new Blob(['content'], { type: 'video/mp4' }),
            });

            for (const asset of newAssets) {
              fetchMock.mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'video/mp4' }),
                blob: async () => new Blob(['new-asset-data'], { type: 'video/mp4' }),
              });
            }

            for (const asset of newAssets) {
              computeChecksumFn.mockResolvedValueOnce(asset.checksum);
            }

            await manager.sync();

            // PROPERTY: fetch = 1 (GET manifest) + newAssets.length (all must download)
            expect(fetchMock).toHaveBeenCalledTimes(1 + newAssets.length);

            // PROPERTY: checksum validated for every new asset downloaded
            expect(computeChecksumFn).toHaveBeenCalledTimes(newAssets.length);

            // PROPERTY: New template applied
            expect(manager.getManifestVersion()).toBe('sha256:version-new');
          } finally {
            db.close();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
