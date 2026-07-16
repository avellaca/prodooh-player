/**
 * ManifestSyncManager — Polls the backend for Loop Template updates,
 * downloads new media assets with SHA-256 checksum-based differential sync,
 * and manages asset lifecycle (LRU eligibility + active protection).
 *
 * Supports both the new Loop Template format and ETag/If-None-Match
 * for efficient HTTP 304 no-change detection.
 *
 * Key behaviors:
 * - On new version: diff assets by checksum_sha256, download only new assets
 * - On download failure: keep previous template, retry on next sync cycle
 * - Mark removed assets as eligible for LRU cleanup (don't delete immediately)
 * - Protect active template assets from LRU cleanup regardless of age
 * - Use sync_interval_seconds from template response for polling interval
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.11
 */

import Database from 'better-sqlite3';
import { BackendApiClient } from '../api/BackendApiClient';
import { JwtRenewer } from '../api/JwtRenewer';
import type { MediaDownloader } from './types';

// ─── Loop Template Types (mirrored from contracts/src/loop-template.ts) ──────

/** Full Loop Template response from GET /api/device/manifest */
export interface LoopTemplateResponse {
  version: string;
  generated_at: string;
  loop_config: {
    num_slots: number;
    slot_duration_seconds: number;
    loop_duration_seconds: number;
    loops_per_day: number;
  };
  slots: LoopSlotContract[];
  sync_interval_seconds: number;
  cache_flush_interval_hours: number;
}

/** A single slot in the loop template */
export interface LoopSlotContract {
  position: number;
  type: 'ad' | 'ssp' | 'playlist';
  strategy: 'fixed' | 'round_robin';
  candidates: CandidateContract[];
  provider?: string;
  config?: Record<string, string>;
}

/** A creative candidate assigned to a slot */
export interface CandidateContract {
  order_line_id?: string;
  creative_id?: string;
  playlist_item_id?: string;
  asset_url: string;
  checksum_sha256: string;
  frequency?: string;
}

/** Callback type for loop template update notifications */
export type LoopTemplateUpdateCallback = (template: LoopTemplateResponse) => void;

/** Info about a locally cached asset */
export interface CachedAsset {
  /** The SHA-256 checksum that identifies this asset */
  checksum_sha256: string;
  /** The backend asset URL */
  assetUrl: string;
  /** The local blob URL for playback */
  localUrl: string;
  /** Content type (e.g., 'video/mp4') */
  contentType: string | null;
  /** Whether this asset is eligible for LRU cleanup */
  lruEligible: boolean;
}

// ─── Legacy types (kept for backward compatibility during migration) ─────────

/** @deprecated Use LoopTemplateResponse from contracts */
export interface ManifestItem {
  position: number;
  type: 'order_line_creative' | 'prodooh_ssp_call' | 'playlist_item';
  duration_seconds: number;
  asset_url?: string;
  checksum_sha256?: string;
  order_line_id?: string;
  creative_id?: string;
  playlist_item_id?: string;
  target_id?: string;
}

/** @deprecated Use LoopTemplateResponse from contracts */
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

/** Callback type for manifest update notifications (legacy) */
export type ManifestUpdateCallback = (manifest: Manifest) => void;

export class ManifestSyncManager {
  private client: BackendApiClient;
  private db: Database.Database;
  private downloader: MediaDownloader;
  private jwtRenewer: JwtRenewer;

  /** Currently active template version (used as If-None-Match ETag) */
  private currentVersion: string | null = null;

  /** Currently active Loop Template */
  private currentTemplate: LoopTemplateResponse | null = null;

  /** Legacy manifest for backward compatibility */
  private currentManifest: Manifest | null = null;

  /** Periodic sync timer */
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  /** Current sync interval in ms (updated from template response) */
  private syncIntervalMs: number = 240_000; // Default: 240 seconds

  /** Registered loop template update callbacks */
  private templateUpdateCallbacks: LoopTemplateUpdateCallback[] = [];

  /** Registered legacy manifest update callbacks */
  private updateCallbacks: ManifestUpdateCallback[] = [];

  /**
   * Asset cache indexed by checksum_sha256.
   * This enables differential downloads — only fetch assets with new checksums.
   */
  private assetsByChecksum: Map<string, CachedAsset> = new Map();

  /** Map of backend asset_url → local blob URL (for renderer resolution) */
  private assetMap: Map<string, string> = new Map();

  /** Map of backend asset_url → content type */
  private assetTypeMap: Map<string, string> = new Map();

  /** Set of checksums that are in the active template (protected from LRU) */
  private activeChecksums: Set<string> = new Set();

  /** Set of checksums eligible for LRU cleanup (removed from template) */
  private lruEligibleChecksums: Set<string> = new Set();

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
   * Start periodic sync polling. Uses sync_interval_seconds from template
   * or falls back to default 240s.
   * Safe to call multiple times — only one timer will be active.
   */
  startPeriodicSync(intervalMs?: number): void {
    if (this.syncTimer) return;
    const interval = intervalMs ?? this.syncIntervalMs;
    this.syncTimer = setInterval(() => {
      void this.sync();
    }, interval);
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
   * Restart periodic sync with a new interval (e.g., after receiving updated sync_interval_seconds).
   */
  private restartPeriodicSync(newIntervalMs: number): void {
    if (this.syncIntervalMs === newIntervalMs) return;
    this.syncIntervalMs = newIntervalMs;
    if (this.syncTimer) {
      this.stopPeriodicSync();
      this.startPeriodicSync(newIntervalMs);
    }
  }

  /**
   * Perform a full sync cycle:
   * 1. Poll backend with If-None-Match header
   * 2. If 304 → no changes, return false
   * 3. If 200 → parse Loop Template, diff assets by checksum
   * 4. Download only new assets, validate checksums
   * 5. If any download fails → keep previous template, retry next cycle
   * 6. On success → update state, mark removed assets for LRU, protect active assets
   * 7. Update sync interval from template response
   *
   * Returns true if a new template was applied, false otherwise.
   */
  async sync(): Promise<boolean> {
    // 1. Fetch manifest with ETag/If-None-Match
    const headers: Record<string, string> = {};
    if (this.currentVersion) {
      headers['If-None-Match'] = this.currentVersion;
    }

    let response;
    try {
      response = await this.jwtRenewer.withAutoRenewal(() =>
        this.client.get<LoopTemplateResponse>('/api/device/manifest', headers),
      );
    } catch {
      // Network error — continue with current template (Req 7.11)
      return false;
    }

    // 2. 304 — no changes
    if (response.status === 304) {
      return false;
    }

    // Network error or unexpected response
    if (!response.ok || !response.data) {
      return false;
    }

    const template = response.data;

    // Detect response format: new Loop Template has 'slots' and 'loop_config'
    // Legacy manifest has 'items' — handle both for backward compatibility
    if (!template.slots || !template.loop_config) {
      // Legacy Manifest format: delegate to legacy handling
      return this.handleLegacyManifest(template as unknown as Manifest);
    }

    // 3. Collect all assets from the new template
    const newAssets = this.collectAssetsFromTemplate(template);

    // 4. Diff assets by checksum — only download assets with new checksums
    const assetsToDownload = this.diffAssetsByChecksum(newAssets);

    // 5. Download new assets and validate checksums
    const downloadSuccess = await this.downloadNewAssets(assetsToDownload);
    if (!downloadSuccess) {
      // On download failure: keep previous template, retry on next sync cycle (Req 7.5)
      return false;
    }

    // 6. Update LRU state: mark removed assets, protect active assets
    this.updateLruState(newAssets);

    // 7. Update local state
    this.currentVersion = template.version;
    this.currentTemplate = template;
    this.persistState(template);

    // 8. Update sync interval from template response (Req 7.1)
    if (template.sync_interval_seconds) {
      this.restartPeriodicSync(template.sync_interval_seconds * 1000);
    }

    // 9. Notify template update listeners
    this.notifyTemplateUpdate(template);

    // 10. Legacy: notify old-style callbacks (backward compatibility)
    this.notifyLegacyUpdate(template);

    return true;
  }

  /**
   * Get the current template version.
   */
  getManifestVersion(): string | null {
    return this.currentVersion;
  }

  /**
   * Get the current Loop Template.
   */
  getTemplate(): LoopTemplateResponse | null {
    return this.currentTemplate;
  }

  /**
   * Get the current manifest (legacy API — returns null for new format).
   */
  getManifest(): Manifest | null {
    return this.currentManifest;
  }

  /**
   * Register a callback for loop template update events.
   */
  onTemplateUpdate(callback: LoopTemplateUpdateCallback): void {
    this.templateUpdateCallbacks.push(callback);
  }

  /**
   * Register a callback for manifest update events (legacy).
   */
  onManifestUpdate(callback: ManifestUpdateCallback): void {
    this.updateCallbacks.push(callback);
  }

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
   * Get the set of checksums that are in the active template.
   * These assets MUST be protected from LRU cleanup (Req 7.7).
   */
  getActiveAssetChecksums(): Set<string> {
    return new Set(this.activeChecksums);
  }

  /**
   * Get the set of checksums eligible for LRU cleanup.
   * These are assets that were removed from the template (Req 7.6).
   */
  getLruEligibleChecksums(): Set<string> {
    return new Set(this.lruEligibleChecksums);
  }

  /**
   * Check if a specific asset (by checksum) is protected from LRU cleanup.
   */
  isAssetProtected(checksum: string): boolean {
    return this.activeChecksums.has(checksum);
  }

  /**
   * Get the current sync interval in milliseconds.
   */
  getSyncIntervalMs(): number {
    return this.syncIntervalMs;
  }

  // ─── Private: Asset diffing and download ───────────────────────────────────

  /**
   * Handle legacy Manifest format (with `items` instead of `slots`).
   * This supports backward compatibility during the migration from flat manifests
   * to Loop Template format.
   */
  private async handleLegacyManifest(manifest: Manifest): Promise<boolean> {
    // Download and validate assets using the legacy approach
    const downloadSuccess = await this.downloadAndValidateLegacyAssets(manifest.items);
    if (!downloadSuccess) {
      return false;
    }

    // Update local state
    this.currentVersion = manifest.version;
    this.currentManifest = manifest;
    this.currentTemplate = null;

    // Persist as JSON
    this.db
      .prepare(
        `INSERT OR REPLACE INTO manifest_state (id, version, manifest_json, updated_at)
         VALUES (1, ?, ?, datetime('now'))`,
      )
      .run(manifest.version, JSON.stringify(manifest));

    // Confirm adoption to backend (no rollback on failure)
    await this.confirmManifest(manifest.version);

    // Notify legacy listeners
    for (const callback of this.updateCallbacks) {
      try {
        callback(manifest);
      } catch (err) {
        console.error('[ManifestSyncManager] Error in legacy update callback:', err);
      }
    }

    return true;
  }

  /**
   * Download and validate assets for legacy manifest items that have an asset_url.
   * Uses the injected downloader interface for backward compatibility.
   */
  private async downloadAndValidateLegacyAssets(items: ManifestItem[]): Promise<boolean> {
    const uniqueAssets = new Map<string, { checksum?: string; itemId: string }>();
    for (const item of items) {
      if (item.asset_url && !uniqueAssets.has(item.asset_url)) {
        const itemId = item.creative_id ?? item.playlist_item_id ?? `pos-${item.position}`;
        uniqueAssets.set(item.asset_url, { checksum: item.checksum_sha256, itemId });
      }
    }

    for (const [assetUrl, { checksum: expectedChecksum, itemId }] of uniqueAssets) {
      if (this.assetMap.has(assetUrl)) {
        continue;
      }

      const localPath = await this.downloader.download(assetUrl, itemId);
      if (!localPath) {
        return false;
      }

      if (expectedChecksum) {
        const computed = await this.downloader.computeChecksum(localPath);
        if (computed !== expectedChecksum) {
          return false;
        }
      }

      this.assetMap.set(assetUrl, localPath);
    }

    return true;
  }

  /**
   * Send manifest adoption confirmation to the backend (legacy flow).
   */
  private async confirmManifest(version: string): Promise<boolean> {
    try {
      const response = await this.jwtRenewer.withAutoRenewal(() =>
        this.client.post('/api/device/manifest/confirm', { version }),
      );
      if (!response.ok) {
        console.warn('[ManifestSyncManager] Confirmation failed, keeping manifest');
      }
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Collect all unique assets from a Loop Template by their checksum_sha256.
   * Returns a map of checksum → { assetUrl, checksum }.
   */
  private collectAssetsFromTemplate(
    template: LoopTemplateResponse,
  ): Map<string, { assetUrl: string; checksum: string }> {
    const assets = new Map<string, { assetUrl: string; checksum: string }>();

    for (const slot of template.slots) {
      for (const candidate of slot.candidates) {
        if (candidate.asset_url && candidate.checksum_sha256) {
          assets.set(candidate.checksum_sha256, {
            assetUrl: candidate.asset_url,
            checksum: candidate.checksum_sha256,
          });
        }
      }
    }

    return assets;
  }

  /**
   * Diff new assets against locally cached assets by checksum.
   * Returns only assets that need to be downloaded (new checksums).
   * Req 7.4: download only assets whose checksum doesn't match any locally stored asset.
   */
  private diffAssetsByChecksum(
    newAssets: Map<string, { assetUrl: string; checksum: string }>,
  ): Array<{ assetUrl: string; checksum: string }> {
    const toDownload: Array<{ assetUrl: string; checksum: string }> = [];

    for (const [checksum, asset] of newAssets) {
      if (!this.assetsByChecksum.has(checksum)) {
        toDownload.push(asset);
      }
    }

    return toDownload;
  }

  /**
   * Download and validate new assets. Returns true if all succeed, false if any fail.
   * On failure, the caller keeps the previous template (Req 7.5).
   */
  private async downloadNewAssets(
    assets: Array<{ assetUrl: string; checksum: string }>,
  ): Promise<boolean> {
    for (const asset of assets) {
      const result = await this.downloadWithType(asset.assetUrl);

      if (!result) {
        return false;
      }

      // Validate checksum of downloaded asset (Req 7.4)
      const computed = await this.downloader.computeChecksum(result.blobUrl);
      if (computed !== asset.checksum) {
        return false;
      }

      // Cache the asset by checksum and URL
      this.assetsByChecksum.set(asset.checksum, {
        checksum_sha256: asset.checksum,
        assetUrl: asset.assetUrl,
        localUrl: result.blobUrl,
        contentType: result.contentType,
        lruEligible: false,
      });

      this.assetMap.set(asset.assetUrl, result.blobUrl);
      if (result.contentType) {
        this.assetTypeMap.set(asset.assetUrl, result.contentType);
      }
    }

    return true;
  }

  /**
   * Update LRU eligibility state after a successful template swap.
   * - Assets in the new template are marked as active (protected from LRU) (Req 7.7)
   * - Assets no longer in the template are marked as LRU eligible (Req 7.6)
   */
  private updateLruState(
    newAssets: Map<string, { assetUrl: string; checksum: string }>,
  ): void {
    const newActiveChecksums = new Set(newAssets.keys());

    // Assets that were active but are no longer in the new template → LRU eligible
    for (const checksum of this.activeChecksums) {
      if (!newActiveChecksums.has(checksum)) {
        this.lruEligibleChecksums.add(checksum);
        const cached = this.assetsByChecksum.get(checksum);
        if (cached) {
          cached.lruEligible = true;
        }
      }
    }

    // Assets in the new template are protected (remove from LRU eligible if present)
    for (const checksum of newActiveChecksums) {
      this.lruEligibleChecksums.delete(checksum);
      const cached = this.assetsByChecksum.get(checksum);
      if (cached) {
        cached.lruEligible = false;
      }
    }

    // Update active checksums to the new template's set
    this.activeChecksums = newActiveChecksums;
  }

  // ─── Private: Download helpers ─────────────────────────────────────────────

  /**
   * Download a file and return both the blob URL and the content-type header.
   */
  private async downloadWithType(url: string): Promise<{ blobUrl: string; contentType: string | null } | null> {
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

  // ─── Private: Notifications ────────────────────────────────────────────────

  /**
   * Notify all registered template update callbacks.
   */
  private notifyTemplateUpdate(template: LoopTemplateResponse): void {
    for (const callback of this.templateUpdateCallbacks) {
      try {
        callback(template);
      } catch (err) {
        console.error('[ManifestSyncManager] Error in template update callback:', err);
      }
    }
  }

  /**
   * Notify legacy manifest callbacks by converting Loop Template to old format.
   */
  private notifyLegacyUpdate(template: LoopTemplateResponse): void {
    // Convert LoopTemplate to legacy Manifest format for backward compat
    const legacyManifest = this.convertToLegacyManifest(template);
    this.currentManifest = legacyManifest;

    for (const callback of this.updateCallbacks) {
      try {
        callback(legacyManifest);
      } catch (err) {
        console.error('[ManifestSyncManager] Error in legacy update callback:', err);
      }
    }
  }

  /**
   * Convert a LoopTemplateResponse to the legacy Manifest format.
   */
  private convertToLegacyManifest(template: LoopTemplateResponse): Manifest {
    const items: ManifestItem[] = template.slots.map((slot) => {
      const candidate = slot.candidates[0];
      const typeMap: Record<string, ManifestItem['type']> = {
        ad: 'order_line_creative',
        ssp: 'prodooh_ssp_call',
        playlist: 'playlist_item',
      };

      return {
        position: slot.position,
        type: typeMap[slot.type] ?? 'order_line_creative',
        duration_seconds: template.loop_config.slot_duration_seconds,
        asset_url: candidate?.asset_url,
        checksum_sha256: candidate?.checksum_sha256,
        order_line_id: candidate?.order_line_id,
        creative_id: candidate?.creative_id,
        playlist_item_id: candidate?.playlist_item_id,
      };
    });

    return {
      version: template.version,
      generated_at: template.generated_at,
      items,
    };
  }

  // ─── Private: Persistence ──────────────────────────────────────────────────

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
   * Persist the current template state to SQLite.
   */
  private persistState(template: LoopTemplateResponse): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO manifest_state (id, version, manifest_json, updated_at)
         VALUES (1, ?, ?, datetime('now'))`,
      )
      .run(template.version, JSON.stringify(template));
  }

  /**
   * Restore template state from SQLite on startup.
   * Supports both new Loop Template format and legacy Manifest format.
   */
  private restoreState(): void {
    try {
      const row = this.db
        .prepare('SELECT version, manifest_json FROM manifest_state WHERE id = 1')
        .get() as { version: string; manifest_json: string } | undefined;

      if (row) {
        this.currentVersion = row.version;
        const parsed = JSON.parse(row.manifest_json);

        // Detect format: Loop Template has 'slots', legacy has 'items'
        if (parsed.slots && parsed.loop_config) {
          this.currentTemplate = parsed as LoopTemplateResponse;
          this.currentManifest = this.convertToLegacyManifest(this.currentTemplate);

          // Restore active checksums from template
          const assets = this.collectAssetsFromTemplate(this.currentTemplate);
          this.activeChecksums = new Set(assets.keys());

          // Restore sync interval
          if (this.currentTemplate.sync_interval_seconds) {
            this.syncIntervalMs = this.currentTemplate.sync_interval_seconds * 1000;
          }
        } else if (parsed.items) {
          // Legacy manifest format
          this.currentManifest = parsed as Manifest;
          this.currentTemplate = null;
        }
      }
    } catch {
      // Table may not exist yet or data may be corrupt — start fresh
      this.currentVersion = null;
      this.currentTemplate = null;
      this.currentManifest = null;
    }
  }
}
