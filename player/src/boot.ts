/**
 * Player Boot Sequence — Wires the full startup flow.
 *
 * Orchestrates:
 * 1. Load local config (SQLite) → read venue_id, device_token, credentials
 * 2. Authenticate with backend → obtain JWT for API calls
 * 3. Fetch config from backend → loop config, sources config, schedule
 * 4. Start the loop engine → begin content playback
 *
 * Handles:
 * - First-boot scenario: no config yet → show factory content
 * - Graceful degradation: backend unreachable → use cached config
 *
 * Validates: Requirements 1.1, 1.4, 4.1, 25.2
 */

import { LocalConfigStore } from './storage/LocalConfigStore';
import { BackendApi } from './api/BackendApi';
import type { BackendApiConfig } from './api/BackendApi';
import { LoopEngine } from './engine/LoopEngine';
import type { LoopEngineOptions } from './engine/LoopEngine';
import { FallbackBuffer } from './sources/FallbackBuffer';
import { PlaylistSource } from './sources/PlaylistSource';
import { ProDoohSource } from './sources/ProDoohSource';
import type { ProDoohSourceConfig } from './sources/ProDoohSource';
import { GamVastSource } from './sources/GamVastSource';
import { UrlSource } from './sources/UrlSource';
import type { UrlConfig } from './sources/UrlSource';
import { ScheduleManager } from './schedule/ScheduleManager';
import { PlaylistSyncManager } from './sync/PlaylistSyncManager';
import { BrowserMediaDownloader } from './sync/BrowserMediaDownloader';
import { HeartbeatService } from './sync/HeartbeatService';
import type { DeviceStatusProvider, CurrentContent } from './sync/HeartbeatService';
import type { ContentSource, SourceType } from './sources/types';
import type { LoopConfig, ScheduleConfig } from './storage/types';
import type Database from 'better-sqlite3';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Device configuration read from local store */
export interface DeviceLocalConfig {
  venueId: string | null;
  deviceToken: string | null;
  backendUrl: string | null;
  prodoohApiKey: string | null;
  prodoohNetworkId: string | null;
  gamAdTag: string | null;
}

/** Full config fetched from backend */
export interface BackendDeviceConfig {
  venue_id: string;
  tenant_id: string;
  loop: {
    slots: Array<{ position: number; source: SourceType; duration: number }>;
    total_duration: number;
  };
  sources: {
    prodooh: { enabled: boolean; api_key: string; network_id: string };
    gam: { enabled: boolean; ad_tag_url: string };
    url: { enabled: boolean; urls: Array<{ url: string; duration: number; refresh_interval?: number }> };
    playlist: { enabled: boolean };
  };
  display: {
    resolution: { width: number; height: number };
    orientation: 'landscape' | 'portrait';
    transition: { type: 'cut' | 'fade' | 'slide'; duration_ms: number };
  };
  schedule: {
    timezone: string;
    rules: Array<{ days: number[]; start: string; end: string }>;
  } | null;
  content_duration: {
    default_seconds: number;
    source: 'screen' | 'group' | 'tenant';
  };
  sync_interval_seconds: number;
  heartbeat_interval_seconds: number;
}

/** Result of the boot sequence */
export interface BootResult {
  success: boolean;
  engine: LoopEngine | null;
  syncManager: PlaylistSyncManager | null;
  heartbeatService: HeartbeatService | null;
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
  /** Custom config fetcher (for testing) */
  fetchConfig?: (api: BackendApi) => Promise<BackendDeviceConfig | null>;
  /** Callback fired each time the engine starts playing a new content item */
  onPlay?: (content: import('./sources/types').PreparedContent) => void;
  /** Callback fired when the engine enters sleep mode (outside operating hours) */
  onSleep?: () => void;
  /** Callback fired when the engine wakes from sleep mode */
  onWake?: () => void;
}

// ─── Default config for first boot ──────────────────────────────────────────

const DEFAULT_LOOP_CONFIG: LoopConfig = {
  slots: [
    { position: 0, source: 'playlist', duration: 10 },
  ],
  total_duration: 10,
  version: 'factory-default',
};

// ─── Boot Sequence ───────────────────────────────────────────────────────────

/**
 * Reads device configuration keys from the local SQLite store.
 * Returns null values for any missing keys (Req 1.4: graceful degradation).
 */
export function loadLocalConfig(store: LocalConfigStore): DeviceLocalConfig {
  return {
    venueId: store.get('venue_id'),
    deviceToken: store.get('device_token'),
    backendUrl: store.get('backend_url'),
    prodoohApiKey: store.get('prodooh_api_key'),
    prodoohNetworkId: store.get('prodooh_network_id'),
    gamAdTag: store.get('gam_ad_tag'),
  };
}

/**
 * Attempts to fetch the device config from the backend.
 * Returns null if the backend is unreachable or returns an error.
 */
export async function fetchDeviceConfig(api: BackendApi): Promise<BackendDeviceConfig | null> {
  const client = api.getClient();
  const response = await client.get<BackendDeviceConfig>('/api/device/config');

  if (!response.ok || !response.data) {
    return null;
  }

  return response.data;
}

/**
 * Builds content sources based on available config.
 * Only creates sources that have valid credentials/config (Req 1.4).
 */
export function buildSources(
  localConfig: DeviceLocalConfig,
  backendConfig: BackendDeviceConfig | null,
  db: { database: Database.Database },
  options?: { backendUrl?: string; getToken?: () => string | null },
): Map<SourceType, ContentSource> {
  const sources = new Map<SourceType, ContentSource>();

  // Playlist source is always created (it reads from local SQLite)
  const playlistSource = new PlaylistSource(db.database);
  sources.set('playlist', playlistSource);

  // ProDooh source — only if credentials are present (Req 1.4)
  const prodoohApiKey = backendConfig?.sources.prodooh.api_key ?? localConfig.prodoohApiKey;
  const prodoohNetworkId = backendConfig?.sources.prodooh.network_id ?? localConfig.prodoohNetworkId;
  const prodoohEnabled = backendConfig?.sources.prodooh.enabled ?? true;

  if (prodoohApiKey && prodoohNetworkId && prodoohEnabled && localConfig.venueId) {
    // Use backend proxy to avoid CORS issues in browser
    const backendUrl = options?.backendUrl ?? localConfig.backendUrl ?? '';
    const proxyUrl = backendUrl ? `${backendUrl.replace(/\/+$/, '')}/api/device/prodooh/ad` : undefined;

    const prodoohConfig: ProDoohSourceConfig = {
      apiKey: prodoohApiKey,
      networkId: prodoohNetworkId,
      venueId: localConfig.venueId,
      baseUrl: 'https://sandbox.api.prodooh.com',
      proxyUrl,
      width: backendConfig?.display.resolution.width ?? 1920,
      height: backendConfig?.display.resolution.height ?? 1080,
    };
    const prodoohSource = new ProDoohSource(prodoohConfig);
    if (options?.getToken) {
      prodoohSource.setToken(options.getToken() ?? null);
    }
    sources.set('prodooh', prodoohSource);
  }

  // GAM VAST source — only if ad tag is configured (Req 1.4)
  const gamAdTag = backendConfig?.sources.gam.ad_tag_url ?? localConfig.gamAdTag;
  const gamEnabled = backendConfig?.sources.gam.enabled ?? true;

  if (gamAdTag && gamEnabled) {
    sources.set('gam', new GamVastSource({ adTagUrl: gamAdTag }));
  }

  // URL source — only if URLs are configured
  const urlEnabled = backendConfig?.sources.url.enabled ?? false;
  const urlConfigs: UrlConfig[] = backendConfig?.sources.url.urls?.map(u => ({
    url: u.url,
    duration: u.duration,
    refresh_interval: u.refresh_interval,
  })) ?? [];

  if (urlEnabled && urlConfigs.length > 0) {
    sources.set('url', new UrlSource({
      urls: urlConfigs,
      variables: { venue_id: localConfig.venueId ?? '' },
    }));
  }

  return sources;
}

/**
 * Resolves the loop configuration to use.
 * Priority:
 * 1. Backend-provided config (fresh)
 * 2. Cached config from local store
 * 3. Factory default (single playlist slot)
 */
export function resolveLoopConfig(
  backendConfig: BackendDeviceConfig | null,
  cachedConfig: LoopConfig | null,
): { config: LoopConfig; source: 'backend' | 'cached' | 'factory' } {
  // Use backend config if available
  if (backendConfig?.loop) {
    const config: LoopConfig = {
      slots: backendConfig.loop.slots,
      total_duration: backendConfig.loop.total_duration,
      version: 'backend-live',
    };
    return { config, source: 'backend' };
  }

  // Fallback to cached config
  if (cachedConfig && cachedConfig.slots.length > 0) {
    return { config: cachedConfig, source: 'cached' };
  }

  // Factory default — only playlist slot (Req 25.2)
  return { config: DEFAULT_LOOP_CONFIG, source: 'factory' };
}

/**
 * Resolves the schedule configuration.
 */
export function resolveScheduleConfig(
  backendConfig: BackendDeviceConfig | null,
  cachedSchedule: ScheduleConfig | null,
): ScheduleConfig | null {
  if (backendConfig?.schedule) {
    return {
      timezone: backendConfig.schedule.timezone,
      rules: backendConfig.schedule.rules,
    };
  }
  return cachedSchedule;
}

/**
 * Executes the full player boot sequence.
 *
 * Flow:
 * 1. Open/initialize local config store (SQLite)
 * 2. Read venue_id, device_token, credentials from local config
 * 3. Attempt to authenticate with backend
 * 4. Attempt to fetch config from backend
 * 5. Build content sources based on available config
 * 6. Resolve loop config (backend → cached → factory)
 * 7. Initialize FallbackBuffer and ScheduleManager
 * 8. Create and start LoopEngine
 *
 * Graceful degradation (Req 1.4):
 * - If backend is unreachable, uses cached config
 * - If no cached config exists, uses factory defaults
 * - If specific credentials are missing, only those sources are disabled
 */
export async function bootPlayer(options: BootOptions = {}): Promise<BootResult> {
  // Step 1: Initialize local config store
  const configStore = options.configStore ?? new LocalConfigStore(options.dbPath ?? './player.db');

  // Step 2: Load local configuration (Req 1.1)
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

  // Step 4: Fetch config from backend (or degrade gracefully)
  let backendConfig: BackendDeviceConfig | null = null;

  if (authenticated && backendApi) {
    const fetcher = options.fetchConfig ?? fetchDeviceConfig;
    backendConfig = await fetcher(backendApi);
  }

  // Step 5: Resolve loop config (Req 1.4 - graceful degradation)
  const cachedLoopConfig = configStore.getLoopConfig();
  const { config: loopConfig, source: configSource } = resolveLoopConfig(backendConfig, cachedLoopConfig);

  // Persist fetched config for future offline use
  if (backendConfig && configSource === 'backend') {
    configStore.setLoopConfig(loopConfig);
  }

  // Step 6: Resolve schedule
  const cachedSchedule = configStore.getSchedule();
  const scheduleConfig = resolveScheduleConfig(backendConfig, cachedSchedule);

  if (backendConfig?.schedule) {
    configStore.setSchedule({
      timezone: backendConfig.schedule.timezone,
      rules: backendConfig.schedule.rules,
    });
  }

  // Step 7: Perform initial playlist sync (populate playlist_items table)
  let syncManager: PlaylistSyncManager | null = null;

  if (authenticated && backendApi) {
    const downloader = new BrowserMediaDownloader({
      getToken: () => backendApi!.getToken(),
    });
    syncManager = new PlaylistSyncManager(
      backendApi.getClient(),
      configStore.getDatabase(),
      downloader,
    );

    // Initial sync — fetch playlist manifest and populate local DB
    try {
      console.log('[boot] Starting initial playlist sync...');
      const synced = await syncManager.sync();
      console.log('[boot] Playlist sync result:', synced);
    } catch (error) {
      console.warn('[boot] Initial playlist sync failed, continuing with cached data:', error);
    }

    // Start periodic sync using the interval from backend config (min 15s for responsiveness)
    const syncIntervalMs = Math.max(
      (backendConfig?.sync_interval_seconds ?? 60) * 1000,
      15_000,
    );
    syncManager.startPeriodicSync(syncIntervalMs);
  } else {
    console.warn('[boot] Skipping playlist sync — not authenticated');
  }

  // Step 8: Build content sources
  const sources = buildSources(localConfig, backendConfig, {
    database: configStore.getDatabase(),
  }, {
    backendUrl: localConfig.backendUrl ?? undefined,
    getToken: backendApi ? () => backendApi!.getToken() : undefined,
  });

  // Step 9: Initialize FallbackBuffer
  const playlistSource = sources.get('playlist') as PlaylistSource;
  const orientation = backendConfig?.display.orientation ?? 'landscape';
  const fallbackBuffer = new FallbackBuffer({
    playlistSource,
    orientation,
  });

  // Pre-fill the fallback buffer (Req 4.1, 25.2)
  await fallbackBuffer.replenish();

  // Step 10: Initialize ScheduleManager
  const scheduleManager = new ScheduleManager({ config: scheduleConfig });

  // Step 11: Create and start LoopEngine
  const engineOptions: LoopEngineOptions = {
    config: loopConfig,
    sources,
    fallbackBuffer,
    scheduleChecker: scheduleManager,
    onPlay: options.onPlay,
    onSleep: options.onSleep,
    onWake: options.onWake,
  };

  const engine = new LoopEngine(engineOptions);

  // Determine boot mode
  let mode: 'normal' | 'cached' | 'factory';
  if (configSource === 'backend') {
    mode = 'normal';
  } else if (configSource === 'cached') {
    mode = 'cached';
  } else {
    mode = 'factory';
  }

  // Mark factory content adoption status
  if (mode !== 'factory' && playlistSource.isAvailable()) {
    fallbackBuffer.getFactoryContent().markPlaylistAdopted();
  }

  // Step 12: Start HeartbeatService (sends periodic status to backend)
  let heartbeatService: HeartbeatService | null = null;

  if (authenticated && backendApi) {
    const bootTime = Date.now();
    const statusProvider: DeviceStatusProvider = {
      getVenueId: () => localConfig.venueId ?? '',
      getCurrentContent: (): CurrentContent | null => {
        const content = engine.getCurrentContent();
        if (!content) return null;
        return { id: content.id, source: content.source as SourceType };
      },
      getStorageStatus: () => ({
        total_mb: 0,
        available_mb: 0,
        percent_used: 0,
      }),
      getUptimeSeconds: () => Math.floor((Date.now() - bootTime) / 1000),
      getPlaylistVersion: () => syncManager?.getPlaylistVersion() ?? '',
    };

    heartbeatService = new HeartbeatService({
      client: backendApi.getClient(),
      statusProvider,
      intervalMs: (backendConfig?.heartbeat_interval_seconds ?? 30) * 1000,
    });

    heartbeatService.start();
  }

  return {
    success: true,
    engine,
    syncManager,
    heartbeatService,
    mode,
  };
}
