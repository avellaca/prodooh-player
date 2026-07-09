/**
 * Property 23: LRU Cleanup Safety
 *
 * Generate random cached files and active playlist sets; verify active items never deleted.
 *
 * **Validates: Requirements 22.2, 22.3**
 *
 * Requirement 22.2: Run LRU cleanup when free space < 20%.
 * Requirement 22.3: Never delete active playlist items or fallback buffer content.
 *
 * This test generates random sets of cached files on disk and random subsets of
 * those files that are in the active playlist or fallback buffer. It then triggers
 * LRU cleanup and verifies that no active/fallback item is ever deleted.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  StorageManager,
  type CachedFile,
  type DiskUsageProvider,
  type FileSystemOps,
  type ActiveContentProvider,
  type CachedFileProvider,
} from '../../src/storage/StorageManager';

// --- Helpers & Arbitraries ---

/** Arbitrary for a unique content ID */
const contentIdArb = fc.stringMatching(/^[a-z0-9]{4,12}$/);

/** Arbitrary for a cached file */
const cachedFileArb = (id: string, index: number): fc.Arbitrary<CachedFile> =>
  fc.record({
    contentId: fc.constant(id),
    path: fc.constant(`/media/cache/${id}.dat`),
    sizeBytes: fc.integer({ min: 100_000, max: 50_000_000 }), // 100KB - 50MB
    lastAccessed: fc.integer({ min: 1_700_000_000_000, max: 1_710_000_000_000 }), // timestamps in 2023-2024
  });

/**
 * Generates a scenario with:
 * - A set of cached files (3-30 items)
 * - A subset of those files that are in the active playlist
 * - A subset of those files that are in the fallback buffer
 * - Initial disk usage (configured so cleanup triggers: free < 20%)
 */
interface CleanupScenario {
  cachedFiles: CachedFile[];
  activePlaylistIds: string[];
  fallbackBufferIds: string[];
  totalDiskBytes: number;
  initialAvailableBytes: number;
}

const cleanupScenarioArb: fc.Arbitrary<CleanupScenario> = fc
  .array(contentIdArb, { minLength: 3, maxLength: 30 })
  .chain((rawIds) => {
    // Ensure unique IDs
    const uniqueIds = [...new Set(rawIds)];
    const ids = uniqueIds.length >= 3 ? uniqueIds : [...uniqueIds, 'extra-a', 'extra-b', 'extra-c'].slice(0, 3);

    return fc
      .tuple(
        // Generate cached files for each unique ID
        fc.tuple(...ids.map((id, i) => cachedFileArb(id, i))),
        // Random subset for active playlist (pick indices)
        fc.subarray(ids, { minLength: 0, maxLength: Math.max(1, Math.floor(ids.length / 2)) }),
        // Random subset for fallback buffer (pick indices)
        fc.subarray(ids, { minLength: 0, maxLength: Math.min(3, ids.length) }),
        // Total disk size: 1GB - 10GB
        fc.integer({ min: 1_000_000_000, max: 10_000_000_000 }),
      )
      .map(([files, activeIds, fallbackIds, totalDisk]) => {
        // Ensure free space is < 20% to trigger cleanup
        const maxAvailable = Math.floor(totalDisk * 0.19); // just under 20%
        const initialAvailable = Math.max(1, Math.floor(maxAvailable * 0.5)); // well under threshold

        return {
          cachedFiles: files,
          activePlaylistIds: activeIds,
          fallbackBufferIds: fallbackIds,
          totalDiskBytes: totalDisk,
          initialAvailableBytes: initialAvailable,
        };
      });
  });

/**
 * Creates mock providers for the StorageManager based on a test scenario.
 * Tracks which files were deleted.
 */
function createMockProviders(scenario: CleanupScenario) {
  const deletedFiles: string[] = [];
  let availableBytes = scenario.initialAvailableBytes;

  const diskUsageProvider: DiskUsageProvider = {
    getDiskUsage: async () => ({
      total: scenario.totalDiskBytes,
      available: availableBytes,
    }),
  };

  const fileSystemOps: FileSystemOps = {
    deleteFile: async (path: string) => {
      const file = scenario.cachedFiles.find((f) => f.path === path);
      if (file) {
        deletedFiles.push(file.contentId);
        // Simulate freeing space
        availableBytes += file.sizeBytes;
      }
    },
  };

  const activeContentProvider: ActiveContentProvider = {
    getActivePlaylistIds: () => new Set(scenario.activePlaylistIds),
    getFallbackBufferIds: () => new Set(scenario.fallbackBufferIds),
  };

  const cachedFileProvider: CachedFileProvider = {
    getCachedFiles: async () => [...scenario.cachedFiles],
  };

  return {
    diskUsageProvider,
    fileSystemOps,
    activeContentProvider,
    cachedFileProvider,
    deletedFiles,
  };
}

describe('Property 23: LRU Cleanup Safety', () => {
  it('active playlist items are never deleted during LRU cleanup', async () => {
    await fc.assert(
      fc.asyncProperty(cleanupScenarioArb, async (scenario) => {
        const mocks = createMockProviders(scenario);

        const storageManager = new StorageManager(
          mocks.diskUsageProvider,
          mocks.fileSystemOps,
          mocks.activeContentProvider,
          mocks.cachedFileProvider
        );

        // Trigger LRU cleanup
        await storageManager.runLRUCleanup();

        // PROPERTY: No active playlist item was deleted
        const activeSet = new Set(scenario.activePlaylistIds);
        for (const deletedId of mocks.deletedFiles) {
          expect(activeSet.has(deletedId)).toBe(false);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('fallback buffer items are never deleted during LRU cleanup', async () => {
    await fc.assert(
      fc.asyncProperty(cleanupScenarioArb, async (scenario) => {
        const mocks = createMockProviders(scenario);

        const storageManager = new StorageManager(
          mocks.diskUsageProvider,
          mocks.fileSystemOps,
          mocks.activeContentProvider,
          mocks.cachedFileProvider
        );

        // Trigger LRU cleanup
        await storageManager.runLRUCleanup();

        // PROPERTY: No fallback buffer item was deleted
        const fallbackSet = new Set(scenario.fallbackBufferIds);
        for (const deletedId of mocks.deletedFiles) {
          expect(fallbackSet.has(deletedId)).toBe(false);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('only non-protected files are deleted and in LRU order (oldest first)', async () => {
    await fc.assert(
      fc.asyncProperty(cleanupScenarioArb, async (scenario) => {
        const mocks = createMockProviders(scenario);

        const storageManager = new StorageManager(
          mocks.diskUsageProvider,
          mocks.fileSystemOps,
          mocks.activeContentProvider,
          mocks.cachedFileProvider
        );

        await storageManager.runLRUCleanup();

        // Compute the expected deletable order
        const protectedIds = new Set([
          ...scenario.activePlaylistIds,
          ...scenario.fallbackBufferIds,
        ]);

        const deletableInOrder = scenario.cachedFiles
          .filter((f) => !protectedIds.has(f.contentId))
          .sort((a, b) => a.lastAccessed - b.lastAccessed)
          .map((f) => f.contentId);

        // PROPERTY: Deleted files are a prefix of the LRU-sorted deletable list
        // (cleanup stops when free space >= 20%)
        for (let i = 0; i < mocks.deletedFiles.length; i++) {
          expect(mocks.deletedFiles[i]).toBe(deletableInOrder[i]);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('checkAndClean triggers cleanup when free space < 20% and protects active items', async () => {
    await fc.assert(
      fc.asyncProperty(cleanupScenarioArb, async (scenario) => {
        const mocks = createMockProviders(scenario);

        const storageManager = new StorageManager(
          mocks.diskUsageProvider,
          mocks.fileSystemOps,
          mocks.activeContentProvider,
          mocks.cachedFileProvider
        );

        // Use the full checkAndClean flow
        const status = await storageManager.checkAndClean();

        // PROPERTY: Status is valid
        expect(status.total_mb).toBeGreaterThan(0);
        expect(status.percent_used).toBeGreaterThanOrEqual(0);
        expect(status.percent_used).toBeLessThanOrEqual(100);

        // PROPERTY: No active playlist items were deleted
        const protectedIds = new Set([
          ...scenario.activePlaylistIds,
          ...scenario.fallbackBufferIds,
        ]);
        for (const deletedId of mocks.deletedFiles) {
          expect(protectedIds.has(deletedId)).toBe(false);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('when all cached files are active, nothing is deleted (no data loss)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .array(contentIdArb, { minLength: 3, maxLength: 15 })
          .chain((rawIds) => {
            const ids = [...new Set(rawIds)];
            const finalIds = ids.length >= 3 ? ids : [...ids, 'pad-a', 'pad-b', 'pad-c'].slice(0, 3);

            return fc
              .tuple(
                fc.tuple(...finalIds.map((id, i) => cachedFileArb(id, i))),
                fc.integer({ min: 1_000_000_000, max: 10_000_000_000 })
              )
              .map(([files, totalDisk]) => ({
                cachedFiles: files,
                // ALL files are active — nothing should be deletable
                activePlaylistIds: finalIds,
                fallbackBufferIds: [] as string[],
                totalDiskBytes: totalDisk,
                initialAvailableBytes: Math.floor(totalDisk * 0.1), // 10% free, triggers cleanup
              }));
          }),
        async (scenario) => {
          const mocks = createMockProviders(scenario);

          const storageManager = new StorageManager(
            mocks.diskUsageProvider,
            mocks.fileSystemOps,
            mocks.activeContentProvider,
            mocks.cachedFileProvider
          );

          await storageManager.runLRUCleanup();

          // PROPERTY: Nothing was deleted because all files are protected
          expect(mocks.deletedFiles.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
