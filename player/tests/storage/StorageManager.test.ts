import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  StorageManager,
  type DiskUsageProvider,
  type FileSystemOps,
  type ActiveContentProvider,
  type CachedFileProvider,
  type CachedFile,
  type StorageAlertReporter,
} from '../../src/storage/StorageManager';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockDiskUsage(total: number, available: number): DiskUsageProvider {
  return {
    getDiskUsage: vi.fn().mockResolvedValue({ total, available }),
  };
}

function createMockFileSystem(): FileSystemOps {
  return {
    deleteFile: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockActiveContent(
  playlistIds: string[] = [],
  fallbackIds: string[] = [],
): ActiveContentProvider {
  return {
    getActivePlaylistIds: () => new Set(playlistIds),
    getFallbackBufferIds: () => new Set(fallbackIds),
  };
}

function createMockCacheRegistry(files: CachedFile[] = []): CachedFileProvider {
  return {
    getCachedFiles: vi.fn().mockResolvedValue(files),
  };
}

function createMockAlertReporter(): StorageAlertReporter {
  return {
    reportCriticalStorage: vi.fn().mockResolvedValue(undefined),
  };
}

const MB = 1_048_576;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('StorageManager', () => {
  describe('getStatus()', () => {
    it('should return correct storage status in MB and percent', async () => {
      const total = 32_000 * MB; // 32 GB
      const available = 16_000 * MB; // 16 GB
      const diskUsage = createMockDiskUsage(total, available);
      const manager = new StorageManager(
        diskUsage,
        createMockFileSystem(),
        createMockActiveContent(),
        createMockCacheRegistry(),
      );

      const status = await manager.getStatus();

      expect(status.total_mb).toBe(32_000);
      expect(status.available_mb).toBe(16_000);
      expect(status.percent_used).toBe(50);
    });

    it('should round values correctly', async () => {
      const total = 29_500 * MB;
      const available = 7_375 * MB; // 25% free
      const diskUsage = createMockDiskUsage(total, available);
      const manager = new StorageManager(
        diskUsage,
        createMockFileSystem(),
        createMockActiveContent(),
        createMockCacheRegistry(),
      );

      const status = await manager.getStatus();

      expect(status.total_mb).toBe(29_500);
      expect(status.available_mb).toBe(7_375);
      expect(status.percent_used).toBe(75);
    });
  });

  describe('checkAndClean()', () => {
    it('should not run cleanup when free space >= 20%', async () => {
      const total = 100 * MB;
      const available = 25 * MB; // 25% free — above threshold
      const diskUsage = createMockDiskUsage(total, available);
      const cacheRegistry = createMockCacheRegistry([
        { contentId: 'c1', path: '/cache/c1.mp4', sizeBytes: 5 * MB, lastAccessed: 1000 },
      ]);
      const fileSystem = createMockFileSystem();

      const manager = new StorageManager(
        diskUsage,
        fileSystem,
        createMockActiveContent(),
        cacheRegistry,
      );

      await manager.checkAndClean();

      expect(fileSystem.deleteFile).not.toHaveBeenCalled();
    });

    it('should run cleanup when free space < 20%', async () => {
      let callCount = 0;
      const diskUsage: DiskUsageProvider = {
        getDiskUsage: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount <= 1) {
            // First call: 15% free — triggers cleanup
            return { total: 100 * MB, available: 15 * MB };
          }
          // After deletion: 25% free — above threshold
          return { total: 100 * MB, available: 25 * MB };
        }),
      };

      const cacheRegistry = createMockCacheRegistry([
        { contentId: 'old-file', path: '/cache/old.mp4', sizeBytes: 10 * MB, lastAccessed: 1000 },
      ]);
      const fileSystem = createMockFileSystem();

      const manager = new StorageManager(
        diskUsage,
        fileSystem,
        createMockActiveContent(),
        cacheRegistry,
      );

      await manager.checkAndClean();

      expect(fileSystem.deleteFile).toHaveBeenCalledWith('/cache/old.mp4');
    });

    it('should report critical alert when free space < 10% after cleanup', async () => {
      // Even after cleanup, still only 8% free
      const diskUsage = createMockDiskUsage(100 * MB, 8 * MB);
      const alertReporter = createMockAlertReporter();
      const cacheRegistry = createMockCacheRegistry([]);

      const manager = new StorageManager(
        diskUsage,
        createMockFileSystem(),
        createMockActiveContent(),
        cacheRegistry,
        alertReporter,
      );

      const status = await manager.checkAndClean();

      expect(alertReporter.reportCriticalStorage).toHaveBeenCalledWith(status);
    });

    it('should NOT report critical alert when free space >= 10% after cleanup', async () => {
      const diskUsage = createMockDiskUsage(100 * MB, 12 * MB);
      const alertReporter = createMockAlertReporter();

      const manager = new StorageManager(
        diskUsage,
        createMockFileSystem(),
        createMockActiveContent(),
        createMockCacheRegistry([]),
        alertReporter,
      );

      await manager.checkAndClean();

      expect(alertReporter.reportCriticalStorage).not.toHaveBeenCalled();
    });

    it('should return storage status after cleanup', async () => {
      let callCount = 0;
      const diskUsage: DiskUsageProvider = {
        getDiskUsage: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount <= 1) {
            return { total: 100 * MB, available: 15 * MB };
          }
          return { total: 100 * MB, available: 30 * MB };
        }),
      };

      const cacheRegistry = createMockCacheRegistry([
        { contentId: 'c1', path: '/cache/c1.mp4', sizeBytes: 15 * MB, lastAccessed: 1000 },
      ]);

      const manager = new StorageManager(
        diskUsage,
        createMockFileSystem(),
        createMockActiveContent(),
        cacheRegistry,
      );

      const status = await manager.checkAndClean();

      expect(status.total_mb).toBe(100);
      expect(status.available_mb).toBe(30);
      expect(status.percent_used).toBe(70);
    });
  });

  describe('runLRUCleanup()', () => {
    it('should delete files in LRU order (oldest accessed first)', async () => {
      let deleteCount = 0;
      const diskUsage: DiskUsageProvider = {
        getDiskUsage: vi.fn().mockImplementation(async () => {
          // After 2 deletions, space is recovered
          if (deleteCount >= 2) {
            return { total: 100 * MB, available: 25 * MB };
          }
          return { total: 100 * MB, available: 10 * MB };
        }),
      };

      const cachedFiles: CachedFile[] = [
        { contentId: 'newest', path: '/cache/newest.mp4', sizeBytes: 5 * MB, lastAccessed: 3000 },
        { contentId: 'oldest', path: '/cache/oldest.mp4', sizeBytes: 5 * MB, lastAccessed: 1000 },
        { contentId: 'middle', path: '/cache/middle.mp4', sizeBytes: 5 * MB, lastAccessed: 2000 },
      ];
      const cacheRegistry = createMockCacheRegistry(cachedFiles);
      const fileSystem: FileSystemOps = {
        deleteFile: vi.fn().mockImplementation(async () => {
          deleteCount++;
        }),
      };

      const manager = new StorageManager(
        diskUsage,
        fileSystem,
        createMockActiveContent(),
        cacheRegistry,
      );

      const deleted = await manager.runLRUCleanup();

      // Should delete oldest first, then middle, then stop because space is recovered
      expect(fileSystem.deleteFile).toHaveBeenNthCalledWith(1, '/cache/oldest.mp4');
      expect(fileSystem.deleteFile).toHaveBeenNthCalledWith(2, '/cache/middle.mp4');
      expect(deleted).toEqual(['oldest', 'middle']);
    });

    it('should NEVER delete active playlist items', async () => {
      const diskUsage = createMockDiskUsage(100 * MB, 10 * MB); // always low
      const cachedFiles: CachedFile[] = [
        { contentId: 'active-1', path: '/cache/active-1.mp4', sizeBytes: 5 * MB, lastAccessed: 500 },
        { contentId: 'inactive', path: '/cache/inactive.mp4', sizeBytes: 5 * MB, lastAccessed: 1000 },
        { contentId: 'active-2', path: '/cache/active-2.jpg', sizeBytes: 2 * MB, lastAccessed: 200 },
      ];
      const cacheRegistry = createMockCacheRegistry(cachedFiles);
      const fileSystem = createMockFileSystem();

      const manager = new StorageManager(
        diskUsage,
        fileSystem,
        createMockActiveContent(['active-1', 'active-2']),
        cacheRegistry,
      );

      const deleted = await manager.runLRUCleanup();

      // Only inactive should be deleted
      expect(deleted).toEqual(['inactive']);
      expect(fileSystem.deleteFile).toHaveBeenCalledWith('/cache/inactive.mp4');
      expect(fileSystem.deleteFile).not.toHaveBeenCalledWith('/cache/active-1.mp4');
      expect(fileSystem.deleteFile).not.toHaveBeenCalledWith('/cache/active-2.jpg');
    });

    it('should NEVER delete fallback buffer items', async () => {
      const diskUsage = createMockDiskUsage(100 * MB, 10 * MB); // always low
      const cachedFiles: CachedFile[] = [
        { contentId: 'fallback-1', path: '/cache/fb.mp4', sizeBytes: 5 * MB, lastAccessed: 100 },
        { contentId: 'inactive', path: '/cache/old.mp4', sizeBytes: 5 * MB, lastAccessed: 500 },
      ];
      const cacheRegistry = createMockCacheRegistry(cachedFiles);
      const fileSystem = createMockFileSystem();

      const manager = new StorageManager(
        diskUsage,
        fileSystem,
        createMockActiveContent([], ['fallback-1']),
        cacheRegistry,
      );

      const deleted = await manager.runLRUCleanup();

      expect(deleted).toEqual(['inactive']);
      expect(fileSystem.deleteFile).not.toHaveBeenCalledWith('/cache/fb.mp4');
    });

    it('should stop deleting once free space reaches threshold', async () => {
      let deleteCount = 0;
      const diskUsage: DiskUsageProvider = {
        getDiskUsage: vi.fn().mockImplementation(async () => {
          // After 1 deletion, space is back to 22% free
          if (deleteCount >= 1) {
            return { total: 100 * MB, available: 22 * MB };
          }
          return { total: 100 * MB, available: 10 * MB };
        }),
      };
      const fileSystem: FileSystemOps = {
        deleteFile: vi.fn().mockImplementation(async () => {
          deleteCount++;
        }),
      };

      const cachedFiles: CachedFile[] = [
        { contentId: 'c1', path: '/cache/c1.mp4', sizeBytes: 10 * MB, lastAccessed: 1000 },
        { contentId: 'c2', path: '/cache/c2.mp4', sizeBytes: 10 * MB, lastAccessed: 2000 },
        { contentId: 'c3', path: '/cache/c3.mp4', sizeBytes: 10 * MB, lastAccessed: 3000 },
      ];
      const cacheRegistry = createMockCacheRegistry(cachedFiles);

      const manager = new StorageManager(
        diskUsage,
        fileSystem,
        createMockActiveContent(),
        cacheRegistry,
      );

      const deleted = await manager.runLRUCleanup();

      // Only first file deleted, then space was sufficient
      expect(deleted).toEqual(['c1']);
      expect(fileSystem.deleteFile).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when all files are protected', async () => {
      const diskUsage = createMockDiskUsage(100 * MB, 10 * MB);
      const cachedFiles: CachedFile[] = [
        { contentId: 'a1', path: '/cache/a1.mp4', sizeBytes: 5 * MB, lastAccessed: 1000 },
        { contentId: 'a2', path: '/cache/a2.jpg', sizeBytes: 3 * MB, lastAccessed: 2000 },
      ];
      const cacheRegistry = createMockCacheRegistry(cachedFiles);
      const fileSystem = createMockFileSystem();

      const manager = new StorageManager(
        diskUsage,
        fileSystem,
        createMockActiveContent(['a1'], ['a2']),
        cacheRegistry,
      );

      const deleted = await manager.runLRUCleanup();

      expect(deleted).toEqual([]);
      expect(fileSystem.deleteFile).not.toHaveBeenCalled();
    });

    it('should handle empty cache gracefully', async () => {
      const diskUsage = createMockDiskUsage(100 * MB, 10 * MB);
      const cacheRegistry = createMockCacheRegistry([]);
      const fileSystem = createMockFileSystem();

      const manager = new StorageManager(
        diskUsage,
        fileSystem,
        createMockActiveContent(),
        cacheRegistry,
      );

      const deleted = await manager.runLRUCleanup();

      expect(deleted).toEqual([]);
      expect(fileSystem.deleteFile).not.toHaveBeenCalled();
    });

    it('should protect items in both active playlist AND fallback buffer', async () => {
      const diskUsage = createMockDiskUsage(100 * MB, 10 * MB);
      const cachedFiles: CachedFile[] = [
        { contentId: 'shared', path: '/cache/shared.mp4', sizeBytes: 5 * MB, lastAccessed: 100 },
        { contentId: 'deletable', path: '/cache/del.mp4', sizeBytes: 5 * MB, lastAccessed: 500 },
      ];
      const cacheRegistry = createMockCacheRegistry(cachedFiles);
      const fileSystem = createMockFileSystem();

      // 'shared' is in both sets — still protected
      const manager = new StorageManager(
        diskUsage,
        fileSystem,
        createMockActiveContent(['shared'], ['shared']),
        cacheRegistry,
      );

      const deleted = await manager.runLRUCleanup();

      expect(deleted).toEqual(['deletable']);
      expect(fileSystem.deleteFile).not.toHaveBeenCalledWith('/cache/shared.mp4');
    });
  });
});
