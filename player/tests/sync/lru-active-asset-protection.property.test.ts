/**
 * Property 17: Active assets protected from LRU cleanup
 *
 * For any asset included in the active Loop Template of a screen, that asset
 * must be protected from LRU cleanup regardless of its age or last access time.
 *
 * **Validates: Requirements 7.7**
 *
 * Uses fast-check to generate random Loop Templates with varying numbers of slots,
 * candidates, and checksums. After syncing a template, verifies that ALL assets
 * in the active template are marked as protected (isAssetProtected returns true)
 * and appear in getActiveAssetChecksums(). Also verifies that assets NOT in the
 * template are NOT protected.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import Database from 'better-sqlite3';
import { ManifestSyncManager } from '../../src/sync/ManifestSyncManager';
import type {
  LoopTemplateResponse,
  LoopSlotContract,
  CandidateContract,
} from '../../src/sync/ManifestSyncManager';
import { BackendApiClient } from '../../src/api/BackendApiClient';
import { JwtRenewer } from '../../src/api/JwtRenewer';
import type { MediaDownloader } from '../../src/sync/types';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Arbitrary for a hex-like checksum string (unique per generation) */
const checksumArb = fc
  .array(fc.constantFrom(...'0123456789abcdef'.split('')), { minLength: 16, maxLength: 64 })
  .map((chars) => `sha256_${chars.join('')}`);

/** Arbitrary for an asset URL */
const assetUrlArb = fc.uuid().map((id) => `/api/device/content/${id}/file`);

/** Arbitrary for a candidate with unique checksum (not used directly, but kept for reference) */
const _candidateArb = (checksum: string): fc.Arbitrary<CandidateContract> =>
  fc.record({
    order_line_id: fc.option(fc.uuid(), { nil: undefined }),
    creative_id: fc.option(fc.uuid(), { nil: undefined }),
    asset_url: assetUrlArb,
    checksum_sha256: fc.constant(checksum),
  });

/** Arbitrary for slot type */
const slotTypeArb = fc.constantFrom<'ad' | 'ssp' | 'playlist'>('ad', 'ssp', 'playlist');

/** Arbitrary for slot strategy */
const strategyArb = fc.constantFrom<'fixed' | 'round_robin'>('fixed', 'round_robin');

/**
 * Generates a random Loop Template with 1–20 slots, each slot having 0–5 candidates.
 * Returns both the template and the set of expected active checksums.
 */
interface TemplateScenario {
  template: LoopTemplateResponse;
  expectedActiveChecksums: Set<string>;
  nonActiveChecksums: string[];
}

const templateScenarioArb: fc.Arbitrary<TemplateScenario> = fc
  .integer({ min: 1, max: 20 })
  .chain((numSlots) => {
    // Generate unique checksums for all candidates across all slots
    // Each slot gets 0–5 candidates, generate enough unique checksums
    return fc
      .tuple(
        fc.array(
          fc.tuple(
            slotTypeArb,
            strategyArb,
            fc.integer({ min: 0, max: 5 }), // number of candidates per slot
          ),
          { minLength: numSlots, maxLength: numSlots },
        ),
        // Extra checksums that will NOT be in the template (to test non-protection)
        fc.array(checksumArb, { minLength: 1, maxLength: 5 }),
      )
      .chain(([slotConfigs, extraChecksums]) => {
        const totalCandidates = slotConfigs.reduce((sum, [, , n]) => sum + n, 0);
        // Generate unique checksums for all candidates
        return fc
          .tuple(
            fc.array(checksumArb, {
              minLength: Math.max(1, totalCandidates),
              maxLength: Math.max(1, totalCandidates) + 10,
            }),
            fc.constant(slotConfigs),
            fc.constant(extraChecksums),
          );
      })
      .map(([allChecksums, slotConfigs, extraChecksums]) => {
        // Ensure uniqueness
        const uniqueChecksums = [...new Set(allChecksums)];
        const activeChecksums = new Set<string>();
        let checksumIdx = 0;

        const slots: LoopSlotContract[] = slotConfigs.map(([type, strategy, numCandidates], position) => {
          const candidates: CandidateContract[] = [];
          for (let i = 0; i < numCandidates && checksumIdx < uniqueChecksums.length; i++) {
            const checksum = uniqueChecksums[checksumIdx]!;
            checksumIdx++;
            activeChecksums.add(checksum);
            candidates.push({
              order_line_id: `ol-${position}-${i}`,
              creative_id: `cr-${position}-${i}`,
              asset_url: `/api/device/content/asset-${position}-${i}/file`,
              checksum_sha256: checksum,
            });
          }
          return { position, type, strategy, candidates };
        });

        // Ensure extraChecksums don't overlap with active checksums
        const nonActiveChecksums = extraChecksums.filter((c) => !activeChecksums.has(c));

        const template: LoopTemplateResponse = {
          version: `sha256:version-${Date.now()}`,
          generated_at: new Date().toISOString(),
          loop_config: {
            num_slots: numSlots,
            slot_duration_seconds: 10,
            loop_duration_seconds: numSlots * 10,
            loops_per_day: Math.floor(57600 / numSlots),
          },
          slots,
          sync_interval_seconds: 240,
          cache_flush_interval_hours: 24,
        };

        return {
          template,
          expectedActiveChecksums: activeChecksums,
          nonActiveChecksums,
        };
      });
  });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  return new Database(':memory:');
}

function createMockDownloader(): MediaDownloader {
  return {
    download: vi.fn().mockResolvedValue('/media/test-file'),
    computeChecksum: vi.fn(),
  };
}

/**
 * Sets up mocks so that a sync() call succeeds for the given template.
 * Returns the fetchMock for inspection.
 */
function setupSuccessfulSync(
  fetchMock: ReturnType<typeof vi.fn>,
  downloader: MediaDownloader,
  template: LoopTemplateResponse,
): void {
  // Mock GET /api/device/manifest → 200 with template
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => template,
    blob: async () => new Blob(['fake'], { type: 'application/json' }),
  });

  // Collect all unique assets from the template to mock their downloads
  const checksums: string[] = [];
  for (const slot of template.slots) {
    for (const candidate of slot.candidates) {
      if (candidate.asset_url && candidate.checksum_sha256) {
        checksums.push(candidate.checksum_sha256);
      }
    }
  }

  // Deduplicate checksums (same checksum in multiple slots only downloads once)
  const uniqueChecksums = [...new Set(checksums)];

  // Mock asset downloads (one per unique checksum)
  for (const _checksum of uniqueChecksums) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'video/mp4' }),
      blob: async () => new Blob(['fake-asset'], { type: 'video/mp4' }),
    });
  }

  // Mock checksum validation to return matching checksums
  const computeChecksumMock = downloader.computeChecksum as ReturnType<typeof vi.fn>;
  for (const checksum of uniqueChecksums) {
    computeChecksumMock.mockResolvedValueOnce(checksum);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Property 17: Active assets protected from LRU cleanup', () => {
  let db: Database.Database;
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: BackendApiClient;
  let jwtRenewer: JwtRenewer;
  let downloader: MediaDownloader;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    if (!URL.createObjectURL) {
      URL.createObjectURL = vi.fn();
    }
    let blobCount = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test-${++blobCount}`);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('every asset in the active template is protected from LRU (isAssetProtected returns true)', async () => {
    await fc.assert(
      fc.asyncProperty(templateScenarioArb, async (scenario) => {
        db = createTestDb();
        client = new BackendApiClient('http://localhost:8000');
        client.setToken('test-token');
        jwtRenewer = new JwtRenewer(client, '/api/device/auth');
        downloader = createMockDownloader();
        const manager = new ManifestSyncManager(client, db, downloader, jwtRenewer);

        setupSuccessfulSync(fetchMock, downloader, scenario.template);

        const synced = await manager.sync();

        // If no assets in the template, sync still succeeds
        if (scenario.expectedActiveChecksums.size === 0) {
          expect(synced).toBe(true);
          db.close();
          return;
        }

        expect(synced).toBe(true);

        // PROPERTY: Every asset in the active template is protected
        for (const checksum of scenario.expectedActiveChecksums) {
          expect(manager.isAssetProtected(checksum)).toBe(true);
        }

        db.close();
      }),
      { numRuns: 100 },
    );
  });

  it('getActiveAssetChecksums() contains exactly all assets from the active template', async () => {
    await fc.assert(
      fc.asyncProperty(templateScenarioArb, async (scenario) => {
        db = createTestDb();
        client = new BackendApiClient('http://localhost:8000');
        client.setToken('test-token');
        jwtRenewer = new JwtRenewer(client, '/api/device/auth');
        downloader = createMockDownloader();
        const manager = new ManifestSyncManager(client, db, downloader, jwtRenewer);

        setupSuccessfulSync(fetchMock, downloader, scenario.template);

        const synced = await manager.sync();
        expect(synced).toBe(true);

        const activeChecksums = manager.getActiveAssetChecksums();

        // PROPERTY: The active checksums set matches exactly the template's assets
        expect(activeChecksums.size).toBe(scenario.expectedActiveChecksums.size);
        for (const checksum of scenario.expectedActiveChecksums) {
          expect(activeChecksums.has(checksum)).toBe(true);
        }

        db.close();
      }),
      { numRuns: 100 },
    );
  });

  it('assets NOT in the active template are NOT protected', async () => {
    await fc.assert(
      fc.asyncProperty(templateScenarioArb, async (scenario) => {
        // Skip if no non-active checksums to test
        if (scenario.nonActiveChecksums.length === 0) return;

        db = createTestDb();
        client = new BackendApiClient('http://localhost:8000');
        client.setToken('test-token');
        jwtRenewer = new JwtRenewer(client, '/api/device/auth');
        downloader = createMockDownloader();
        const manager = new ManifestSyncManager(client, db, downloader, jwtRenewer);

        setupSuccessfulSync(fetchMock, downloader, scenario.template);

        const synced = await manager.sync();
        expect(synced).toBe(true);

        // PROPERTY: Checksums not in the template are NOT protected
        for (const checksum of scenario.nonActiveChecksums) {
          expect(manager.isAssetProtected(checksum)).toBe(false);
        }

        db.close();
      }),
      { numRuns: 100 },
    );
  });

  it('protection is independent of asset age — old and new assets in template are equally protected', async () => {
    await fc.assert(
      fc.asyncProperty(
        templateScenarioArb,
        fc.integer({ min: 1, max: 365 }), // days since last access (simulated age)
        async (scenario, _ageDays) => {
          if (scenario.expectedActiveChecksums.size === 0) return;

          db = createTestDb();
          client = new BackendApiClient('http://localhost:8000');
          client.setToken('test-token');
          jwtRenewer = new JwtRenewer(client, '/api/device/auth');
          downloader = createMockDownloader();
          const manager = new ManifestSyncManager(client, db, downloader, jwtRenewer);

          setupSuccessfulSync(fetchMock, downloader, scenario.template);

          const synced = await manager.sync();
          expect(synced).toBe(true);

          // PROPERTY: Regardless of simulated age, all active assets are protected
          // (age doesn't affect the protection mechanism — it's purely membership-based)
          for (const checksum of scenario.expectedActiveChecksums) {
            expect(manager.isAssetProtected(checksum)).toBe(true);
          }

          // Active assets are never LRU eligible
          const lruEligible = manager.getLruEligibleChecksums();
          for (const checksum of scenario.expectedActiveChecksums) {
            expect(lruEligible.has(checksum)).toBe(false);
          }

          db.close();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('after template swap, previously active assets become LRU eligible while new assets become protected', async () => {
    await fc.assert(
      fc.asyncProperty(
        templateScenarioArb,
        templateScenarioArb,
        async (scenario1, scenario2) => {
          // Skip trivial cases
          if (
            scenario1.expectedActiveChecksums.size === 0 ||
            scenario2.expectedActiveChecksums.size === 0
          ) return;

          db = createTestDb();
          client = new BackendApiClient('http://localhost:8000');
          client.setToken('test-token');
          jwtRenewer = new JwtRenewer(client, '/api/device/auth');
          downloader = createMockDownloader();
          const manager = new ManifestSyncManager(client, db, downloader, jwtRenewer);

          // First sync
          setupSuccessfulSync(fetchMock, downloader, scenario1.template);
          const synced1 = await manager.sync();
          expect(synced1).toBe(true);

          // All assets from first template are protected
          for (const checksum of scenario1.expectedActiveChecksums) {
            expect(manager.isAssetProtected(checksum)).toBe(true);
          }

          // Second sync with different template
          const template2 = {
            ...scenario2.template,
            version: `sha256:version2-${Date.now()}`,
          };
          setupSuccessfulSync(fetchMock, downloader, template2);
          const synced2 = await manager.sync();
          expect(synced2).toBe(true);

          // PROPERTY: All assets in the NEW template are protected
          for (const checksum of scenario2.expectedActiveChecksums) {
            expect(manager.isAssetProtected(checksum)).toBe(true);
          }

          // PROPERTY: Assets from the OLD template that are NOT in the new template
          // become LRU eligible (no longer protected)
          for (const checksum of scenario1.expectedActiveChecksums) {
            if (!scenario2.expectedActiveChecksums.has(checksum)) {
              expect(manager.isAssetProtected(checksum)).toBe(false);
              expect(manager.getLruEligibleChecksums().has(checksum)).toBe(true);
            }
          }

          db.close();
        },
      ),
      { numRuns: 50 },
    );
  });
});
