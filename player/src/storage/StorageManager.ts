/**
 * StorageManager — Monitors disk usage, runs LRU cleanup, reports storage status.
 *
 * Key behaviors:
 * - Monitors available disk space
 * - Runs LRU cleanup when free space < 20%
 * - Never deletes active playlist items or fallback buffer content
 * - Reports critical alert when free space < 10% after cleanup
 *
 * Requirements: 22.1, 22.2, 22.3, 22.4
 */

export interface CachedFile {
  /** Unique content identifier */
  contentId: string;
  /** Path to the file on disk */
  path: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Last access timestamp (ms since epoch) */
  lastAccessed: number;
}

export interface StorageStatus {
  total_mb: number;
  available_mb: number;
  percent_used: number;
}

export interface DiskUsage {
  total: number; // bytes
  available: number; // bytes
}

/**
 * Interface for the disk usage provider, allowing injection for testing.
 */
export interface DiskUsageProvider {
  getDiskUsage(): Promise<DiskUsage>;
}

/**
 * Interface for the file system operations used by StorageManager.
 */
export interface FileSystemOps {
  deleteFile(path: string): Promise<void>;
}

/**
 * Interface for getting active content IDs that must not be deleted.
 */
export interface ActiveContentProvider {
  /** Returns the set of content IDs currently in the active playlist */
  getActivePlaylistIds(): Set<string>;
  /** Returns the set of content IDs currently in the fallback buffer */
  getFallbackBufferIds(): Set<string>;
}

/**
 * Interface for getting the list of cached files on disk.
 */
export interface CachedFileProvider {
  getCachedFiles(): Promise<CachedFile[]>;
}

/**
 * Interface for critical storage alerts.
 */
export interface StorageAlertReporter {
  reportCriticalStorage(status: StorageStatus): Promise<void>;
}

export class StorageManager {
  private thresholdWarning = 0.20; // 20% free triggers cleanup
  private thresholdCritical = 0.10; // 10% free is critical

  constructor(
    private diskUsageProvider: DiskUsageProvider,
    private fileSystemOps: FileSystemOps,
    private activeContentProvider: ActiveContentProvider,
    private cachedFileProvider: CachedFileProvider,
    private alertReporter?: StorageAlertReporter
  ) {}

  /**
   * Check disk usage and run cleanup if needed.
   * Returns the current storage status after any cleanup.
   */
  async checkAndClean(): Promise<StorageStatus> {
    const { total, available } = await this.diskUsageProvider.getDiskUsage();
    const freeRatio = available / total;

    if (freeRatio < this.thresholdWarning) {
      await this.runLRUCleanup();
    }

    const afterClean = await this.diskUsageProvider.getDiskUsage();
    const status: StorageStatus = {
      total_mb: Math.round(afterClean.total / 1_048_576),
      available_mb: Math.round(afterClean.available / 1_048_576),
      percent_used: Math.round((1 - afterClean.available / afterClean.total) * 100),
    };

    if (afterClean.available / afterClean.total < this.thresholdCritical) {
      if (this.alertReporter) {
        await this.alertReporter.reportCriticalStorage(status);
      }
    }

    return status;
  }

  /**
   * Runs LRU cleanup: deletes cached files sorted by last access time,
   * but NEVER deletes files that are in the active playlist or fallback buffer.
   */
  async runLRUCleanup(): Promise<string[]> {
    const activeIds = this.activeContentProvider.getActivePlaylistIds();
    const fallbackIds = this.activeContentProvider.getFallbackBufferIds();
    const cachedFiles = await this.cachedFileProvider.getCachedFiles();

    // Protected IDs: active playlist + fallback buffer
    const protectedIds = new Set([...activeIds, ...fallbackIds]);

    // Filter to only deletable files (not in active playlist or fallback buffer)
    const deletable = cachedFiles
      .filter((f) => !protectedIds.has(f.contentId))
      .sort((a, b) => a.lastAccessed - b.lastAccessed); // LRU: oldest accessed first

    const deletedIds: string[] = [];

    for (const file of deletable) {
      await this.fileSystemOps.deleteFile(file.path);
      deletedIds.push(file.contentId);

      // Check if we've freed enough space
      const { available, total } = await this.diskUsageProvider.getDiskUsage();
      if (available / total >= this.thresholdWarning) break;
    }

    return deletedIds;
  }

  /**
   * Get the current storage status without triggering cleanup.
   */
  async getStatus(): Promise<StorageStatus> {
    const { total, available } = await this.diskUsageProvider.getDiskUsage();
    return {
      total_mb: Math.round(total / 1_048_576),
      available_mb: Math.round(available / 1_048_576),
      percent_used: Math.round((1 - available / total) * 100),
    };
  }
}
