/**
 * Player Boot Sequence — Wires the full startup flow.
 *
 * Orchestrates:
 * 1. Load local config (SQLite) → read venue_id, device_token, credentials
 * 2. Authenticate with backend → obtain JWT for API calls
 * 3. Initialize ManifestEngine components
 * 4. Start manifest-based playback
 *
 * Handles:
 * - First-boot scenario: no config yet → show factory content
 * - Graceful degradation: backend unreachable → use cached manifest
 *
 * Validates: Requirements 1.1, 1.4, 10.1, 10.2
 */

import { LocalConfigStore } from './storage/LocalConfigStore';
import { BackendApi } from './api/BackendApi';
import type { BackendApiConfig } from './api/BackendApi';
import { HeartbeatService } from './sync/HeartbeatService';
import type { DeviceStatusProvider, CurrentContent } from './sync/HeartbeatService';
import { ScreenshotService } from './services/ScreenshotService';
import type { SourceType } from './sources/types';
import type Database from 'better-sqlite3';

// ─── Manifest Engine imports ─────────────────────────────────────────────────
import { JwtRenewer } from './api/JwtRenewer';
import { ImpressionReporter } from './sync/ImpressionReporter';
import type { ImpressionRecord } from './sync/ImpressionReporter';
import { ManifestSyncManager } from './sync/ManifestSyncManager';
import type { Manifest, ManifestItem, LoopTemplateResponse } from './sync/ManifestSyncManager';
import { ManifestEngine } from './engine/ManifestEngine';
import { LoopEngine } from './engine/LoopEngine';
import type { LoopTemplate, LoopSlot, SlotCandidate } from './engine/LoopEngine';
import { SspPrefetcher } from './engine/SspPrefetcher';
import type { SspClient, SspContent } from './engine/SspPrefetcher';
import { BrowserMediaDownloader } from './sync/BrowserMediaDownloader';
import { SspRetryQueue } from './sync/SspRetryQueue';
import { SpeedOverrideHandler } from './engine/SpeedOverrideHandler';
import { PreviewContentHandler } from './services/PreviewContentHandler';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Device configuration read from local store */
export interface DeviceLocalConfig {
  venueId: string | null;
  deviceToken: string | null;
  backendUrl: string | null;
  prodoohApiKey: string | null;
  prodoohNetworkId: string | null;
}

/** Result of the boot sequence */
export interface BootResult {
  success: boolean;
  heartbeatService: HeartbeatService | null;
  manifestEngine: ManifestEngine | null;
  loopEngine: LoopEngine | null;
  manifestSyncManager: ManifestSyncManager | null;
  impressionReporter: ImpressionReporter | null;
  speedOverrideHandler: SpeedOverrideHandler | null;
  mode: 'normal' | 'cached' | 'factory';
  error?: string;
}

/** Options for the boot sequence (injectable for testing) */
export interface BootOptions {
  /** Path to SQLite database file */
  dbPath?: string;
  /** Pre-constructed LocalConfigStore (for testing) */
  configStore?: LocalConfigStore;
  /** Pre-constructed BackendApi (for testing) */
  backendApi?: BackendApi;
  /** Override for screen dimensions */
  screenWidth?: number;
  screenHeight?: number;
  /** Callback fired when the ManifestEngine starts playing a manifest item */
  onManifestItemStart?: (item: ManifestItem) => void;
}

// ─── Boot Sequence ───────────────────────────────────────────────────────────

/**
 * Reads device configuration keys from the local SQLite store.
 * Returns null values for any missing keys (graceful degradation).
 */
export function loadLocalConfig(store: LocalConfigStore): DeviceLocalConfig {
  return {
    venueId: store.get('venue_id'),
    deviceToken: store.get('device_token'),
    backendUrl: store.get('backend_url'),
    prodoohApiKey: store.get('prodooh_api_key'),
    prodoohNetworkId: store.get('prodooh_network_id'),
  };
}

/**
 * Executes the full player boot sequence.
 *
 * Flow:
 * 1. Open/initialize local config store (SQLite)
 * 2. Read venue_id, device_token, credentials from local config
 * 3. Authenticate with backend
 * 4. Initialize ManifestEngine components (sync, impressions, SSP prefetch)
 * 5. Start manifest-based playback
 *
 * Graceful degradation:
 * - If backend is unreachable, uses cached manifest
 * - If no cached manifest exists, waits for first sync
 */
export async function bootPlayer(options: BootOptions = {}): Promise<BootResult> {
  // Step 1: Initialize local config store
  const configStore = options.configStore ?? new LocalConfigStore(options.dbPath ?? './player.db');

  // Step 2: Load local configuration
  const localConfig = loadLocalConfig(configStore);

  // Step 3: Authenticate with backend (if credentials available)
  let backendApi: BackendApi | null = options.backendApi ?? null;
  let authenticated = false;

  if (!backendApi && localConfig.backendUrl && localConfig.venueId && localConfig.deviceToken) {
    const apiConfig: BackendApiConfig = {
      baseUrl: localConfig.backendUrl,
      venueId: localConfig.venueId,
      deviceToken: localConfig.deviceToken,
    };
    backendApi = new BackendApi(apiConfig, configStore);
  }

  if (backendApi) {
    authenticated = await backendApi.authenticate();
  }

  // Step 4: Initialize ManifestEngine components
  let manifestEngine: ManifestEngine | null = null;
  let loopEngine: LoopEngine | null = null;
  let manifestSyncMgr: ManifestSyncManager | null = null;
  let impressionReporter: ImpressionReporter | null = null;
  let heartbeatService: HeartbeatService | null = null;
  let speedOverrideHandler: SpeedOverrideHandler | null = null;
  let previewContentHandler: PreviewContentHandler | null = null;

  if (authenticated && backendApi) {
    const apiClient = backendApi.getClient();
    const database = configStore.getDatabase();

    // 1. JwtRenewer — auto-renews JWT on 401 responses
    const jwtRenewer = new JwtRenewer(apiClient, '/api/device/auth');

    // 2. ImpressionReporter — queues + flushes order_line impressions
    impressionReporter = new ImpressionReporter(apiClient, database, jwtRenewer);

    // 3. ManifestSyncManager — polls for manifest updates, downloads assets
    const manifestDownloader = new BrowserMediaDownloader({
      getToken: () => backendApi!.getToken(),
    });
    manifestSyncMgr = new ManifestSyncManager(apiClient, database, manifestDownloader, jwtRenewer);

    // 4. SspPrefetcher — pre-loads SSP content using the backend proxy
    const backendUrl = (localConfig.backendUrl ?? '').replace(/\/+$/, '');
    const sspProxyUrl = backendUrl ? `${backendUrl}/api/device/prodooh/ad` : '';
    const sspClient: SspClient = {
      async requestAd(durationSeconds: number): Promise<SspContent | null> {
        // Skip SSP calls if no credentials configured
        if (!sspProxyUrl || !localConfig.prodoohApiKey || !localConfig.prodoohNetworkId) return null;
        try {
          // Get screen resolution from manifest (backend-authoritative)
          const screenInfo = manifestSyncMgr?.getManifest()?.screen;
          const width = screenInfo?.resolution_width ?? options.screenWidth ?? 1920;
          const height = screenInfo?.resolution_height ?? options.screenHeight ?? 1080;

          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          };
          const token = backendApi!.getToken();
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
          }
          const response = await fetch(sspProxyUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              api_key: localConfig.prodoohApiKey ?? '',
              network_id: localConfig.prodoohNetworkId ?? '',
              venue_id: screenInfo?.venue_id ?? localConfig.venueId ?? '',
              width: String(width),
              height: String(height),
              supported_media: ['image/jpeg', 'image/jpg', 'image/png', 'video/mp4', 'video/mpeg', 'video/mpg'],
            }),
          });
          if (!response.ok) return null;
          const data = await response.json() as {
            media?: string;
            print_id?: string;
            type?: string;
            pop_url?: string;
            expire_url?: string;
            proof_of_play?: string;
            expiration?: string;
          };
          if (!data.media || !data.print_id) return null;
          return {
            printId: data.print_id,
            assetUrl: data.media,
            durationSeconds,
            mimeType: data.type,
            popUrl: data.pop_url ?? data.proof_of_play ?? `${sspProxyUrl}/pop/${data.print_id}`,
            expireUrl: data.expire_url ?? data.expiration ?? `${sspProxyUrl}/expire/${data.print_id}`,
          };
        } catch {
          return null;
        }
      },
      async expireAd(printId: string): Promise<void> {
        if (!sspProxyUrl) return;
        try {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          const token = backendApi!.getToken();
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
          }
          await fetch(`${sspProxyUrl}/expire`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ print_id: printId }),
          });
        } catch {
          // Best-effort expiration
        }
      },
      async proofOfPlay(printId: string): Promise<void> {
        if (!sspProxyUrl) return;
        try {
          const headers: Record<string, string> = {};
          const token = backendApi!.getToken();
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
          }
          await fetch(`${sspProxyUrl}/pop/${printId}`, {
            method: 'GET',
            headers,
          });
        } catch {
          // Best-effort proof of play
        }
      },
    };
    // 4b. SspRetryQueue — resilient retry for SSP proof_of_play / expiration calls
    const sspRetryQueue = new SspRetryQueue(database, sspClient);

    const sspPrefetcher = new SspPrefetcher(sspClient, sspRetryQueue);

    // 5b. SpeedOverrideHandler — manages Witness Mode speed override (Req 20.4, 20.5, 20.8)
    speedOverrideHandler = new SpeedOverrideHandler();
    const soHandler = speedOverrideHandler; // local reference for closures

    // 5. ManifestEngine — executes the pre-resolved manifest sequence
    const initialManifest: Manifest = manifestSyncMgr.getManifest() ?? {
      version: '',
      generated_at: '',
      items: [],
    };

    manifestEngine = new ManifestEngine({
      manifest: initialManifest,
      onItemStart: options.onManifestItemStart,
      onItemComplete: (item: ManifestItem, result, failureReason) => {
        // Only enqueue impressions for order_line_creative items (Req 9.6)
        if (item.type === 'order_line_creative' && item.order_line_id && item.creative_id) {
          const effectiveDuration = soHandler.getEffectiveDuration(item.duration_seconds);
          const now = new Date().toISOString();
          const startedAt = new Date(Date.now() - effectiveDuration * 1000).toISOString();
          const impression: ImpressionRecord = {
            order_line_id: item.order_line_id,
            creative_id: item.creative_id,
            started_at: startedAt,
            ended_at: now,
            duration_seconds: effectiveDuration,
            result,
            failure_reason: failureReason,
            // Flag as 'witness' during speed override (Req 20.8)
            mode: soHandler.isWitnessMode() ? 'witness' : 'normal',
          };
          impressionReporter!.enqueue(impression);
        }

        // SSP proof_of_play — confirm reproduction to SSP via retry queue (Req 7.2)
        if (item.type === 'prodooh_ssp_call' && result === 'success') {
          const sspContent = sspPrefetcher.getContent();
          if (sspContent) {
            void sspRetryQueue.proofOfPlay(sspContent.printId, sspContent.popUrl);
          }
        }
      },
      sspPrefetcher,
      // Custom playback function that applies speed override to duration
      playbackFn: async (item: ManifestItem) => {
        const effectiveDuration = soHandler.getEffectiveDuration(item.duration_seconds);
        await new Promise((resolve) => setTimeout(resolve, effectiveDuration * 1000));
        return 'success' as const;
      },
    });

    // 6. Connect ManifestSyncManager → ManifestEngine.updateManifest
    manifestSyncMgr.onManifestUpdate((newManifest: Manifest) => {
      manifestEngine!.updateManifest(newManifest);
    });

    // 6a. LoopEngine — Initialize with restored Loop Template if available
    const restoredTemplate = manifestSyncMgr.getTemplate();

    /**
     * Creates the onSlotComplete callback for LoopEngine.
     * Reports impressions for ad slots and handles SSP proof-of-play.
     * Reads slot_duration_seconds from the template at the time of call.
     */
    const createLoopSlotCompleteHandler = () => {
      return (slot: LoopSlot, candidate: SlotCandidate, result: 'success' | 'failed') => {
        // Report impressions for ad slots (order_line_creative)
        if (slot.type === 'ad' && candidate.order_line_id && candidate.creative_id) {
          // Get the current template duration from ManifestSyncManager
          const currentTpl = manifestSyncMgr!.getTemplate();
          const slotDuration = currentTpl?.loop_config.slot_duration_seconds ?? 10;
          const effectiveDuration = soHandler.getEffectiveDuration(slotDuration);
          const now = new Date().toISOString();
          const startedAt = new Date(Date.now() - effectiveDuration * 1000).toISOString();
          const impression: ImpressionRecord = {
            order_line_id: candidate.order_line_id,
            creative_id: candidate.creative_id,
            started_at: startedAt,
            ended_at: now,
            duration_seconds: effectiveDuration,
            result,
            mode: soHandler.isWitnessMode() ? 'witness' : 'normal',
          };
          impressionReporter!.enqueue(impression);
        }

        // SSP proof_of_play — confirm reproduction to SSP via retry queue
        if (slot.type === 'ssp' && result === 'success') {
          const sspContent = sspPrefetcher.getContent();
          if (sspContent) {
            void sspRetryQueue.proofOfPlay(sspContent.printId, sspContent.popUrl);
          }
        }
      };
    };

    /**
     * Creates the playbackFn for LoopEngine with speed override support.
     */
    const createLoopPlaybackFn = () => {
      return async (_candidate: SlotCandidate, durationMs: number): Promise<'success' | 'failed'> => {
        const effectiveDuration = soHandler.getEffectiveDuration(durationMs / 1000);
        await new Promise((resolve) => setTimeout(resolve, effectiveDuration * 1000));
        return 'success' as const;
      };
    };

    if (restoredTemplate) {
      loopEngine = new LoopEngine({
        template: restoredTemplate as LoopTemplate,
        onSlotStart: options.onManifestItemStart ? (slot, candidate, _iteration) => {
          // Adapt LoopEngine slot start to ManifestItem callback for renderer
          const typeMap: Record<string, ManifestItem['type']> = {
            ad: 'order_line_creative',
            ssp: 'prodooh_ssp_call',
            playlist: 'playlist_item',
          };
          const syntheticItem: ManifestItem = {
            position: slot.position,
            type: typeMap[slot.type] ?? 'order_line_creative',
            duration_seconds: restoredTemplate.loop_config.slot_duration_seconds,
            asset_url: candidate.asset_url,
            checksum_sha256: candidate.checksum_sha256,
            order_line_id: candidate.order_line_id,
            creative_id: candidate.creative_id,
            playlist_item_id: candidate.playlist_item_id,
          };
          options.onManifestItemStart!(syntheticItem);
        } : undefined,
        onSlotComplete: createLoopSlotCompleteHandler(),
        sspPrefetcher,
        playbackFn: createLoopPlaybackFn(),
      });
    }

    // 6b. Connect ManifestSyncManager → LoopEngine.updateTemplate() on new version
    manifestSyncMgr.onTemplateUpdate((newTemplate: LoopTemplateResponse) => {
      if (loopEngine) {
        loopEngine.updateTemplate(newTemplate as LoopTemplate);
      } else {
        // First template received — create LoopEngine dynamically
        loopEngine = new LoopEngine({
          template: newTemplate as LoopTemplate,
          onSlotStart: undefined, // Will be wired by main.ts via onSlotStartCallback setter
          onSlotComplete: createLoopSlotCompleteHandler(),
          sspPrefetcher,
          playbackFn: createLoopPlaybackFn(),
        });
        // Start LoopEngine immediately since template just arrived
        void loopEngine.run();
      }
    });

    // 6b. PreviewContentHandler — handles preview_content commands (Req 21.4, 21.5, 21.7)
    previewContentHandler = new PreviewContentHandler({
      manifestEngine,
      downloader: manifestDownloader,
    });

    // 7. Start ManifestSyncManager polling (every 60s)
    manifestSyncMgr.startPeriodicSync(60_000);

    // 8. Start ImpressionReporter periodic flush (every 30s)
    impressionReporter.startPeriodicFlush(30_000);

    // 8b. Start SspRetryQueue periodic flush (every 5s default)
    sspRetryQueue.startPeriodicFlush();

    // 9. Perform initial manifest sync
    try {
      console.log('[boot] Starting initial manifest sync...');
      const manifestSynced = await manifestSyncMgr.sync();
      console.log('[boot] Manifest sync result:', manifestSynced);
    } catch (error) {
      console.warn('[boot] Initial manifest sync failed, continuing with cached manifest:', error);
    }

    // 10. Start HeartbeatService
    const bootTime = Date.now();
    const statusProvider: DeviceStatusProvider = {
      getVenueId: () => localConfig.venueId ?? '',
      getCurrentContent: (): CurrentContent | null => null,
      getStorageStatus: () => ({
        total_mb: 0,
        available_mb: 0,
        percent_used: 0,
      }),
      getUptimeSeconds: () => Math.floor((Date.now() - bootTime) / 1000),
      getPlaylistVersion: () => manifestSyncMgr?.getManifestVersion() ?? '',
    };

    // 9. Screenshot service for on-demand captures
    const screenshotService = new ScreenshotService({
      baseUrl: backendUrl,
      getToken: () => apiClient.getToken(),
      captureProvider: {
        async captureFrame(): Promise<Blob> {
          const root = document.getElementById('player-root');
          if (!root) throw new Error('No player-root element');
          // Use canvas to capture the current frame
          const canvas = document.createElement('canvas');
          canvas.width = window.innerWidth;
          canvas.height = window.innerHeight;
          const ctx = canvas.getContext('2d')!;
          // Try to capture video element if present
          const video = root.querySelector('video') as HTMLVideoElement | null;
          if (video && !video.paused) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          } else {
            // Fallback: capture image element
            const img = root.querySelector('img') as HTMLImageElement | null;
            if (img) {
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            } else {
              ctx.fillStyle = '#000';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
          }
          return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
              if (blob) resolve(blob);
              else reject(new Error('Canvas toBlob failed'));
            }, 'image/jpeg', 0.85);
          });
        },
      },
    });

    heartbeatService = new HeartbeatService({
      client: apiClient,
      statusProvider,
      commandHandler: {
        async handleCommand(command) {
          if (command.type === 'speed_override') {
            soHandler.handleCommand(command);
          } else if (command.type === 'preview_content') {
            await previewContentHandler!.handleCommand(command);
          } else if (command.type === 'screenshot') {
            await screenshotService?.handleCommand(command);
          }
        },
      },
      intervalMs: 30_000,
    });

    heartbeatService.start();

    console.log('[boot] ManifestEngine initialized and ready');
  } else {
    console.warn('[boot] Skipping ManifestEngine setup — not authenticated');
  }

  // Determine boot mode
  const mode: 'normal' | 'cached' | 'factory' = authenticated ? 'normal' : 'factory';

  return {
    success: true,
    heartbeatService,
    manifestEngine,
    loopEngine,
    manifestSyncManager: manifestSyncMgr,
    impressionReporter,
    speedOverrideHandler,
    mode,
  };
}
