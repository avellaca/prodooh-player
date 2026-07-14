/**
 * ManifestSyncManager — Polls the backend for manifest updates, downloads new
 * media assets with SHA-256 checksum validation, and confirms adoption.
 *
 * Replaces PlaylistSyncManager for the new manifest-based playback contract.
 * Uses JwtRenewer for automatic token renewal on 401 responses.
 *
 * Design decision: if the confirmation POST fails, the new manifest is kept
 * (no rollback). This is deliberate — the content is already available locally.
 *
 * Validates: Requirements 7.1, 7.2, 8.1, 8.3, 10.6
 */

import Database from 'better-sqlite3';
import { BackendApiClient } from '../api/BackendApiClient';
import { JwtRenewer } from '../api/JwtRenewer';
import type { MediaDownloader } from './types';

/** A single manifest item as returned by the backend */
export interface ManifestItem {
  position: number;
  type: 'order_line_creative' | 'prodooh_ssp_call' | 'playlist_item';
  duration_seconds: number;
  asset_url?: string;
  checksum_sha256?: string;
  order_line_id?: string;
  creative_id?: string;
  playlist_item_id?: string;
  /** Target (screen assignment) that originated this creative item. Added for traceability. */
  target_id?: string;
}

/** Full manifest response from the backend */
export interface Manifest {
  version: string;
  generated_at: string;
  items: ManifestItem[];
  screen?: {
    resolution_width: number;
    resolution_height: number;
    venue_id: string;
  };
}

/** Callback type for manifest update notifications */
export type ManifestUpdateCallback = (manifest: Manifest) => void;

export class ManifestSyncManager {
  private client: BackendApiClient;
  private db: Database.Database;
  private downloader: MediaDownloader;
  private jwtRenewer: JwtRenewer;

  /** Currently active manifest version (used as If-None-Match ETag) */
  private currentVersion: string | null = null;

  /** Currently active manifest */
  private currentManifest: Manifest | null = null;

  /** Periodic sync timer */
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  /** Registered update callbacks */
  private updateCallbacks: ManifestUpdateCallback[] = [];

  constructor(
    client: BackendApiClient,
    db: Database.Database,
    downloader: MediaDownloader,
    jwtRenewer: JwtRenewer,
  ) {
    this.client = client;
    this.db = db;
    this.downloader = downloader;
    this.jwtRenewer = jwtRenewer;

    this.ensureTable();
    this.restoreState();
  }

  /**
   * Start periodic sync polling at the given interval.
   * Safe to call multiple times — only one timer will be active.
   */
  startPeriodicSync(intervalMs: number): void {
    if (this.syncTimer) return;
    this.syncTimer = setInterval(() => {
      void this.sync();
    }, intervalMs);
  }

  /**
   * Stop periodic sync polling.
   */
  stopPeriodicSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * Perform a full sync cycle:
   * 1. Poll backend with If-None-Match header
   * 2. If 304 → no changes, return false
   * 3. If 200 → download new assets, validate checksums
   * 4. If all assets valid → update state, confirm adoption
   * 5. Emit onManifestUpdate callbacks
   *
   * Returns true if a new manifest was applied, false otherwise.
   */
  async sync(): Promise<boolean> {
    // 1. Fetch manifest with ETag/If-None-Match
    const headers: Record<string, string> = {};
    if (this.currentVersion) {
      headers['If-None-Match'] = this.currentVersion;
    }

    const response = await this.jwtRenewer.withAutoRenewal(() =>
      this.client.get<Manifest>('/api/device/manifest', headers),
    );

    // 2. 304 — no changes
    if (response.status === 304) {
      return false;
    }

    // Network error or unexpected response
    if (!response.ok || !response.data) {
      return false;
    }

    const manifest = response.data;

    // 3. Download new assets (only items with asset_url)
    const downloadSuccess = await this.downloadAndValidateAssets(manifest.items);
    if (!downloadSuccess) {
      return false;
    }

    // 4. Update local state
    this.currentVersion = manifest.version;
    this.currentManifest = manifest;
    this.persistState(manifest);

    // 5. Confirm adoption to backend (no rollback on failure — deliberate design decision)
    await this.confirmManifest(manifest.version);

    // 6. Notify listeners
    this.notifyUpdate(manifest);

    return true;
  }

  /**
   * Get the current manifest version.
   */
  getManifestVersion(): string | null {
    return this.currentVersion;
  }

  /**
   * Get the current manifest.
   */
  getManifest(): Manifest | null {
    return this.currentManifest;
  }

  /**
   * Register a callback for manifest update events.
   */
  onManifestUpdate(callback: ManifestUpdateCallback): void {
    this.updateCallbacks.push(callback);
  }

  /**
   * Map of backend asset_url → local blob URL for downloaded assets.
   * Used by the renderer to resolve playback URLs.
   */
  private assetMap: Map<string, string> = new Map();

  /** Map of backend asset_url → content type (e.g., 'video/mp4') */
  private assetTypeMap: Map<string, string> = new Map();

  /**
   * Get the local blob URL for a given backend asset URL.
   * Returns the blob URL if downloaded, or the original URL as fallback.
   */
  getLocalUrl(assetUrl: string): string {
    return this.assetMap.get(assetUrl) ?? assetUrl;
  }

  /**
   * Check if a backend asset URL points to a video file.
   */
  isVideo(assetUrl: string): boolean {
    const type = this.assetTypeMap.get(assetUrl) ?? '';
    return type.startsWith('video/');
  }

  /**
   * Download and validate assets for manifest items that have an asset_url.
   * Deduplicates by asset_url — each unique URL is downloaded only once.
   * Returns true if all assets were downloaded and validated successfully.
   */
  private async downloadAndValidateAssets(items: ManifestItem[]): Promise<boolean> {
    // Collect unique asset URLs with their expected checksums
    const uniqueAssets = new Map<string, string | undefined>();
    for (const item of items) {
      if (item.asset_url && !uniqueAssets.has(item.asset_url)) {
        uniqueAssets.set(item.asset_url, item.checksum_sha256);
      }
    }

    // Download each unique asset once
    for (const [assetUrl, expectedChecksum] of uniqueAssets) {
      // Skip if already downloaded in a previous sync
      if (this.assetMap.has(assetUrl)) {
        continue;
      }

      const itemId = assetUrl.split('/').pop() ?? assetUrl;
      const result = await this.downloadWithType(assetUrl, itemId);

      if (!result) {
        return false;
      }

      // Validate checksum if provided
      if (expectedChecksum) {
        const computed = await this.downloader.computeChecksum(result.blobUrl);
        if (computed !== expectedChecksum) {
          return false;
        }
      }

      this.assetMap.set(assetUrl, result.blobUrl);
      if (result.contentType) {
        this.assetTypeMap.set(assetUrl, result.contentType);
      }
    }

    return true;
  }

  /**
   * Download a file and return both the blob URL and the content-type header.
   */
  private async downloadWithType(url: string, _itemId: string): Promise<{ blobUrl: string; contentType: string | null } | null> {
    try {
      const headers: Record<string, string> = {};
      const token = this.client.getToken();
      if (token && url.includes('/api/device/content/')) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(url, { headers });
      if (!response.ok) {
        return null;
      }
      const contentType = response.headers.get('content-type');
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      return { blobUrl, contentType };
    } catch {
      return null;
    }
  }

  /**
   * Send manifest adoption confirmation to the backend.
   * If this fails, we keep the new manifest anyway (no rollback).
   */
  private async confirmManifest(version: string): Promise<boolean> {
    const response = await this.jwtRenewer.withAutoRenewal(() =>
      this.client.post('/api/device/manifest/confirm', { version }),
    );

    if (!response.ok) {
      console.warn('[ManifestSyncManager] Confirmation failed, keeping new manifest');
    }

    return response.ok;
  }

  /**
   * Notify all registered callbacks about a manifest update.
   */
  private notifyUpdate(manifest: Manifest): void {
    for (const callback of this.updateCallbacks) {
      try {
        callback(manifest);
      } catch (err) {
        console.error('[ManifestSyncManager] Error in update callback:', err);
      }
    }
  }

  /**
   * Ensure the manifest_state table exists for persistence.
   */
  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS manifest_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  /**
   * Persist the current manifest state to SQLite.
   */
  private persistState(manifest: Manifest): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO manifest_state (id, version, manifest_json, updated_at)
         VALUES (1, ?, ?, datetime('now'))`,
      )
      .run(manifest.version, JSON.stringify(manifest));
  }

  /**
   * Restore manifest state from SQLite on startup.
   */
  private restoreState(): void {
    try {
      const row = this.db
        .prepare('SELECT version, manifest_json FROM manifest_state WHERE id = 1')
        .get() as { version: string; manifest_json: string } | undefined;

      if (row) {
        this.currentVersion = row.version;
        this.currentManifest = JSON.parse(row.manifest_json) as Manifest;
      }
    } catch {
      // Table may not exist yet or data may be corrupt — start fresh
      this.currentVersion = null;
      this.currentManifest = null;
    }
  }
}
