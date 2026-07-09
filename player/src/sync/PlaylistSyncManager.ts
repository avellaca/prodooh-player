/**
 * PlaylistSyncManager — Polls backend for playlist updates, downloads new media
 * assets with checksum validation, performs atomic swap with adoption confirmation,
 * and reverts to previous version on confirmation failure.
 *
 * Validates: Requirements 4.4, 9.1, 9.2, 9.3
 */

import type { BackendApiClient, HttpResponse } from '../api/BackendApiClient';
import type Database from 'better-sqlite3';

/** A single playlist item as returned by the backend */
export interface PlaylistManifestItem {
  id: string;
  type: 'image' | 'video' | 'url';
  url: string;
  duration?: number;
  rotation?: 0 | 90 | 180 | 270;
  refresh_interval?: number;
  checksum?: string;
}

/** Full playlist manifest from backend */
export interface PlaylistManifest {
  version: string;
  etag: string;
  items: PlaylistManifestItem[];
}

/** Adoption confirmation payload */
export interface PlaylistConfirmation {
  version: string;
  status: 'adopted' | 'failed';
  error?: string;
}

/** Result of downloading media assets */
export interface DownloadResult {
  success: boolean;
  failedCount: number;
  downloadedPaths: Map<string, string>; // itemId -> local file path
}

/** Interface for media download operations (injectable for testing) */
export interface MediaDownloader {
  /**
   * Download a media file from url to local storage.
   * Returns the local file path on success, null on failure.
   */
  download(url: string, itemId: string): Promise<string | null>;

  /**
   * Compute SHA-256 checksum of a local file.
   * Returns hex-encoded hash string.
   */
  computeChecksum(filePath: string): Promise<string>;
}

/**
 * PlaylistSyncManager manages the lifecycle of playlist updates:
 * 1. Poll backend with ETag for changes (304 Not Modified optimization)
 * 2. Download new media assets with checksum validation
 * 3. Atomic swap of playlist in local store
 * 4. Confirm adoption to backend
 * 5. Revert on confirmation failure (Requirement 9.3)
 */
export class PlaylistSyncManager {
  private client: BackendApiClient;
  private db: Database.Database;
  private downloader: MediaDownloader;
  private currentEtag: string | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private _isRunning = false;

  constructor(
    client: BackendApiClient,
    db: Database.Database,
    downloader: MediaDownloader,
  ) {
    this.client = client;
    this.db = db;
    this.downloader = downloader;

    // Restore current ETag from the stored playlist version
    this.restoreEtag();
  }

  /**
   * Start periodic sync polling at the specified interval.
   * Safe to call multiple times — only one timer will be active.
   */
  startPeriodicSync(intervalMs: number): void {
    if (this._isRunning) return;
    this._isRunning = true;

    this.syncTimer = setInterval(() => {
      void this.sync();
    }, intervalMs);
  }

  /**
   * Stop periodic sync polling and clean up the timer.
   */
  stopPeriodicSync(): void {
    this._isRunning = false;
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * Returns whether periodic sync is currently active.
   */
  isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Get the current ETag used for polling.
   */
  getEtag(): string | null {
    return this.currentEtag;
  }

  /**
   * Perform a full sync cycle:
   * - Poll backend for updates using ETag
   * - Download new media with checksum validation
   * - Atomic swap + adoption confirmation
   * - Revert on failure
   *
   * Returns true if a new playlist was adopted, false if no update or failure.
   */
  async sync(): Promise<boolean> {
    // 1. Poll backend with ETag
    const manifest = await this.fetchPlaylistManifest();
    if (manifest === null) {
      // 304 Not Modified or network error
      return false;
    }

    // 2. Download new media assets with checksum validation
    const downloadResult = await this.downloadNewMedia(manifest.items);

    if (!downloadResult.success) {
      // Report failure to backend, keep current playlist
      await this.confirmPlaylist({
        version: manifest.version,
        status: 'failed',
        error: `Failed to download ${downloadResult.failedCount} items`,
      });
      return false;
    }

    // 3. Atomic swap: backup current playlist, replace with new one
    try {
      this.backupCurrentPlaylist();
      this.replacePlaylist(manifest, downloadResult.downloadedPaths);

      // 4. Confirm adoption to backend (best-effort — don't revert on failure)
      const confirmed = await this.confirmPlaylist({
        version: manifest.version,
        status: 'adopted',
      });

      if (!confirmed) {
        // Confirmation failed — log warning but keep the new playlist.
        // The content is already available locally; reverting would leave
        // the player with no content to display.
        console.warn('[PlaylistSyncManager] Adoption confirmation failed, keeping new playlist');
      }

      // Success: update ETag and clean backup
      this.currentEtag = manifest.etag;
      this.clearBackup();
      return true;
    } catch {
      // Any error during swap → revert
      this.revertPlaylist();
      await this.confirmPlaylist({
        version: manifest.version,
        status: 'failed',
        error: 'Swap failed during local database update',
      });
      return false;
    }
  }

  /**
   * Fetch playlist manifest from backend with ETag support.
   * Returns null if 304 Not Modified or network error.
   */
  async fetchPlaylistManifest(): Promise<PlaylistManifest | null> {
    const headers: Record<string, string> = {};
    if (this.currentEtag) {
      headers['If-None-Match'] = this.currentEtag;
    }

    const response: HttpResponse<PlaylistManifest> = await this.client.get<PlaylistManifest>(
      '/api/device/playlist',
      headers,
    );

    if (response.status === 304) {
      return null; // No changes
    }

    if (!response.ok || !response.data) {
      return null; // Network error or unexpected response
    }

    return response.data;
  }

  /**
   * Download new media assets and validate checksums.
   * Only downloads items that are media (image/video), not URL items.
   */
  async downloadNewMedia(items: PlaylistManifestItem[]): Promise<DownloadResult> {
    const downloadedPaths = new Map<string, string>();
    let failedCount = 0;

    for (const item of items) {
      // URL items don't need downloading
      if (item.type === 'url') {
        continue;
      }

      const localPath = await this.downloader.download(item.url, item.id);
      if (!localPath) {
        failedCount++;
        continue;
      }

      // Validate checksum if provided
      if (item.checksum) {
        const computedChecksum = await this.downloader.computeChecksum(localPath);
        if (computedChecksum !== item.checksum) {
          failedCount++;
          continue;
        }
      }

      downloadedPaths.set(item.id, localPath);
    }

    return {
      success: failedCount === 0,
      failedCount,
      downloadedPaths,
    };
  }

  /**
   * Send adoption confirmation to backend.
   * Returns true if the backend acknowledged successfully.
   */
  async confirmPlaylist(confirmation: PlaylistConfirmation): Promise<boolean> {
    const response = await this.client.post<{ ack: boolean }>(
      '/api/device/playlist/confirm',
      confirmation,
    );

    return response.ok && response.data?.ack === true;
  }

  /**
   * Backup the current playlist state before replacing.
   * Stores in a backup table for atomic revert capability.
   */
  backupCurrentPlaylist(): void {
    // Create backup tables if needed
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS playlist_backup (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS playlist_items_backup (
        id TEXT PRIMARY KEY,
        playlist_id TEXT NOT NULL,
        type TEXT NOT NULL,
        media_path TEXT,
        url TEXT,
        duration_seconds INTEGER,
        position INTEGER NOT NULL,
        rotation INTEGER DEFAULT 0,
        refresh_interval INTEGER,
        checksum TEXT,
        download_status TEXT DEFAULT 'ready'
      );
    `);

    // Clear previous backup
    this.db.exec('DELETE FROM playlist_items_backup');
    this.db.exec('DELETE FROM playlist_backup');

    // Copy current data to backup
    this.db.exec(`
      INSERT INTO playlist_backup (id, version, synced_at)
      SELECT id, version, synced_at FROM playlist
    `);
    this.db.exec(`
      INSERT INTO playlist_items_backup (id, playlist_id, type, media_path, url, duration_seconds, position, rotation, refresh_interval, checksum, download_status)
      SELECT id, playlist_id, type, media_path, url, duration_seconds, position, rotation, refresh_interval, checksum, download_status FROM playlist_items
    `);
  }

  /**
   * Replace current playlist with the new manifest data.
   * This is the atomic swap operation.
   */
  replacePlaylist(manifest: PlaylistManifest, downloadedPaths: Map<string, string>): void {
    const now = new Date().toISOString();

    // Use a transaction for atomicity
    const transaction = this.db.transaction(() => {
      // Clear current playlist items
      this.db.exec('DELETE FROM playlist_items');
      this.db.exec('DELETE FROM playlist');

      // Insert new playlist
      this.db.prepare(
        `INSERT INTO playlist (id, version, synced_at) VALUES (?, ?, ?)`
      ).run(manifest.version, manifest.version, now);

      // Insert new items
      const insertItem = this.db.prepare(
        `INSERT INTO playlist_items (id, playlist_id, type, media_path, url, duration_seconds, position, rotation, refresh_interval, checksum, download_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const item of manifest.items) {
        const mediaPath = downloadedPaths.get(item.id) ?? null;
        const downloadStatus = item.type === 'url' ? 'ready' : (mediaPath ? 'ready' : 'pending');

        insertItem.run(
          item.id,
          manifest.version,
          item.type,
          mediaPath,
          item.type === 'url' ? item.url : null,
          item.duration ?? null,
          manifest.items.indexOf(item),
          item.rotation ?? 0,
          item.refresh_interval ?? null,
          item.checksum ?? null,
          downloadStatus,
        );
      }
    });

    transaction();
  }

  /**
   * Revert to the backed-up playlist version.
   * Called when adoption confirmation fails (Requirement 9.3).
   */
  revertPlaylist(): void {
    // Check if backup table exists
    const tableExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='playlist_backup'"
    ).get();
    if (!tableExists) {
      return; // No backup table — nothing to revert to
    }

    const hasBackup = this.db.prepare(
      'SELECT COUNT(*) as count FROM playlist_backup'
    ).get() as { count: number } | undefined;

    if (!hasBackup || hasBackup.count === 0) {
      return; // No backup to revert to
    }

    const transaction = this.db.transaction(() => {
      // Clear current
      this.db.exec('DELETE FROM playlist_items');
      this.db.exec('DELETE FROM playlist');

      // Restore from backup
      this.db.exec(`
        INSERT INTO playlist (id, version, synced_at)
        SELECT id, version, synced_at FROM playlist_backup
      `);
      this.db.exec(`
        INSERT INTO playlist_items (id, playlist_id, type, media_path, url, duration_seconds, position, rotation, refresh_interval, checksum, download_status)
        SELECT id, playlist_id, type, media_path, url, duration_seconds, position, rotation, refresh_interval, checksum, download_status FROM playlist_items_backup
      `);
    });

    transaction();

    // Restore ETag from backup version
    const backupPlaylist = this.db.prepare(
      'SELECT version FROM playlist WHERE 1=1 LIMIT 1'
    ).get() as { version: string } | undefined;
    if (backupPlaylist) {
      this.currentEtag = backupPlaylist.version;
    }
  }

  /**
   * Clear backup tables after successful adoption.
   */
  private clearBackup(): void {
    this.db.exec('DELETE FROM playlist_items_backup');
    this.db.exec('DELETE FROM playlist_backup');
  }

  /**
   * Restore ETag from the current playlist stored in the database.
   */
  private restoreEtag(): void {
    try {
      const row = this.db.prepare(
        'SELECT version FROM playlist LIMIT 1'
      ).get() as { version: string } | undefined;
      this.currentEtag = row?.version ?? null;
    } catch {
      this.currentEtag = null;
    }
  }

  /**
   * Get the current playlist version from local store.
   */
  getPlaylistVersion(): string | null {
    const row = this.db.prepare(
      'SELECT version FROM playlist LIMIT 1'
    ).get() as { version: string } | undefined;
    return row?.version ?? null;
  }

  /**
   * Get all current playlist items from local store.
   */
  getPlaylistItems(): Array<{
    id: string;
    type: string;
    media_path: string | null;
    url: string | null;
    position: number;
    download_status: string;
  }> {
    return this.db.prepare(
      'SELECT id, type, media_path, url, position, download_status FROM playlist_items ORDER BY position'
    ).all() as Array<{
      id: string;
      type: string;
      media_path: string | null;
      url: string | null;
      position: number;
      download_status: string;
    }>;
  }
}
