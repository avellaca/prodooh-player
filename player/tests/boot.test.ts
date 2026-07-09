import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  bootPlayer,
  loadLocalConfig,
  resolveLoopConfig,
  resolveScheduleConfig,
  buildSources,
  fetchDeviceConfig,
} from '../src/boot';
import type { BackendDeviceConfig, DeviceLocalConfig } from '../src/boot';
import { LocalConfigStore } from '../src/storage/LocalConfigStore';
import { BackendApi } from '../src/api/BackendApi';
import type { LoopConfig, ScheduleConfig } from '../src/storage/types';

/**
 * Tests for the player boot sequence.
 * Validates: Requirements 1.1, 1.4, 4.1, 25.2
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createInMemoryStore(): LocalConfigStore {
  return new LocalConfigStore(':memory:');
}

function seedStoreWithConfig(store: LocalConfigStore): void {
  store.set('venue_id', 'test-venue-001');
  store.set('device_token', 'test-device-token');
  store.set('backend_url', 'http://localhost:8000');
  store.set('prodooh_api_key', 'sandbox-api-key');
  store.set('prodooh_network_id', 'sandbox-network');
  store.set('gam_ad_tag', 'https://pubads.g.doubleclick.net/gampad/ads?test=true');
}

function makeBackendConfig(overrides: Partial<BackendDeviceConfig> = {}): BackendDeviceConfig {
  return {
    venue_id: 'test-venue-001',
    tenant_id: 'tenant-001',
    loop: {
      slots: [
        { position: 0, source: 'prodooh', duration: 10 },
        { position: 1, source: 'gam', duration: 10 },
        { position: 2, source: 'url', duration: 10 },
        { position: 3, source: 'playlist', duration: 10 },
      ],
      total_duration: 40,
    },
    sources: {
      prodooh: { enabled: true, api_key: 'sandbox-api-key', network_id: 'sandbox-network' },
      gam: { enabled: true, ad_tag_url: 'https://pubads.g.doubleclick.net/gampad/ads?test=true' },
      url: { enabled: true, urls: [{ url: 'https://example.com', duration: 10 }] },
      playlist: { enabled: true },
    },
    display: {
      resolution: { width: 1920, height: 1080 },
      orientation: 'landscape',
      transition: { type: 'fade', duration_ms: 500 },
    },
    schedule: null,
    content_duration: { default_seconds: 10, source: 'tenant' },
    sync_interval_seconds: 300,
    heartbeat_interval_seconds: 60,
    ...overrides,
  };
}

function createMockBackendApi(authenticated: boolean): BackendApi {
  const api = {
    authenticate: vi.fn(async () => authenticated),
    isAuthenticated: vi.fn(() => authenticated),
    getToken: vi.fn(() => authenticated ? 'mock-jwt-token' : null),
    getClient: vi.fn(() => ({
      get: vi.fn(async () => ({ ok: false, status: 0, data: null })),
      post: vi.fn(async () => ({ ok: false, status: 0, data: null })),
      setToken: vi.fn(),
      getToken: vi.fn(() => null),
    })),
    refreshIfNeeded: vi.fn(async () => authenticated),
  } as unknown as BackendApi;
  return api;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Boot Sequence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('loadLocalConfig', () => {
    it('should return all null values when store is empty (first boot)', () => {
      const store = createInMemoryStore();
      const config = loadLocalConfig(store);

      expect(config.venueId).toBeNull();
      expect(config.deviceToken).toBeNull();
      expect(config.backendUrl).toBeNull();
      expect(config.prodoohApiKey).toBeNull();
      expect(config.prodoohNetworkId).toBeNull();
      expect(config.gamAdTag).toBeNull();
      store.close();
    });

    it('should read all configuration keys from the store (Req 1.1)', () => {
      const store = createInMemoryStore();
      seedStoreWithConfig(store);

      const config = loadLocalConfig(store);

      expect(config.venueId).toBe('test-venue-001');
      expect(config.deviceToken).toBe('test-device-token');
      expect(config.backendUrl).toBe('http://localhost:8000');
      expect(config.prodoohApiKey).toBe('sandbox-api-key');
      expect(config.prodoohNetworkId).toBe('sandbox-network');
      expect(config.gamAdTag).toBe('https://pubads.g.doubleclick.net/gampad/ads?test=true');
      store.close();
    });

    it('should handle partial configuration (only some keys set)', () => {
      const store = createInMemoryStore();
      store.set('venue_id', 'partial-venue');
      store.set('backend_url', 'http://localhost:8000');

      const config = loadLocalConfig(store);

      expect(config.venueId).toBe('partial-venue');
      expect(config.backendUrl).toBe('http://localhost:8000');
      expect(config.deviceToken).toBeNull();
      expect(config.prodoohApiKey).toBeNull();
      store.close();
    });
  });

  describe('resolveLoopConfig', () => {
    it('should use backend config when available', () => {
      const backendConfig = makeBackendConfig();
      const { config, source } = resolveLoopConfig(backendConfig, null);

      expect(source).toBe('backend');
      expect(config.slots).toHaveLength(4);
      expect(config.slots[0]!.source).toBe('prodooh');
    });

    it('should fall back to cached config when backend is unavailable', () => {
      const cachedConfig: LoopConfig = {
        slots: [
          { position: 0, source: 'prodooh', duration: 10 },
          { position: 1, source: 'playlist', duration: 10 },
        ],
        total_duration: 20,
        version: 'cached-v1',
      };

      const { config, source } = resolveLoopConfig(null, cachedConfig);

      expect(source).toBe('cached');
      expect(config.slots).toHaveLength(2);
      expect(config.version).toBe('cached-v1');
    });

    it('should use factory default when no config is available (first boot, Req 25.2)', () => {
      const { config, source } = resolveLoopConfig(null, null);

      expect(source).toBe('factory');
      expect(config.slots).toHaveLength(1);
      expect(config.slots[0]!.source).toBe('playlist');
      expect(config.version).toBe('factory-default');
    });

    it('should use factory default when cached config has empty slots', () => {
      const emptyCache: LoopConfig = {
        slots: [],
        total_duration: 0,
        version: 'empty',
      };

      const { config, source } = resolveLoopConfig(null, emptyCache);

      expect(source).toBe('factory');
      expect(config.slots).toHaveLength(1);
    });
  });

  describe('resolveScheduleConfig', () => {
    it('should use backend schedule when available', () => {
      const backendConfig = makeBackendConfig({
        schedule: {
          timezone: 'America/Bogota',
          rules: [{ days: [1, 2, 3, 4, 5], start: '08:00', end: '20:00' }],
        },
      });

      const result = resolveScheduleConfig(backendConfig, null);

      expect(result).not.toBeNull();
      expect(result!.timezone).toBe('America/Bogota');
      expect(result!.rules).toHaveLength(1);
    });

    it('should fall back to cached schedule when backend has no schedule', () => {
      const cached: ScheduleConfig = {
        timezone: 'America/Lima',
        rules: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '06:00', end: '22:00' }],
      };

      const result = resolveScheduleConfig(null, cached);

      expect(result).not.toBeNull();
      expect(result!.timezone).toBe('America/Lima');
    });

    it('should return null when no schedule is available (24/7 mode)', () => {
      const backendConfig = makeBackendConfig({ schedule: null });
      const result = resolveScheduleConfig(backendConfig, null);
      expect(result).toBeNull();
    });
  });

  describe('buildSources', () => {
    it('should always include playlist source', () => {
      const store = createInMemoryStore();
      const localConfig: DeviceLocalConfig = {
        venueId: null,
        deviceToken: null,
        backendUrl: null,
        prodoohApiKey: null,
        prodoohNetworkId: null,
        gamAdTag: null,
      };

      const sources = buildSources(localConfig, null, { database: store.getDatabase() });

      expect(sources.has('playlist')).toBe(true);
      expect(sources.size).toBe(1);
      store.close();
    });

    it('should create ProDooh source when credentials are available (Req 1.4)', () => {
      const store = createInMemoryStore();
      const localConfig: DeviceLocalConfig = {
        venueId: 'test-venue',
        deviceToken: 'token',
        backendUrl: 'http://localhost',
        prodoohApiKey: 'api-key',
        prodoohNetworkId: 'network-id',
        gamAdTag: null,
      };

      const sources = buildSources(localConfig, null, { database: store.getDatabase() });

      expect(sources.has('prodooh')).toBe(true);
      expect(sources.has('playlist')).toBe(true);
      expect(sources.has('gam')).toBe(false);
      store.close();
    });

    it('should not create ProDooh source when API key is missing (Req 1.4)', () => {
      const store = createInMemoryStore();
      const localConfig: DeviceLocalConfig = {
        venueId: 'test-venue',
        deviceToken: 'token',
        backendUrl: 'http://localhost',
        prodoohApiKey: null,
        prodoohNetworkId: 'network-id',
        gamAdTag: null,
      };

      const sources = buildSources(localConfig, null, { database: store.getDatabase() });

      expect(sources.has('prodooh')).toBe(false);
      store.close();
    });

    it('should create GAM source when ad tag is configured', () => {
      const store = createInMemoryStore();
      const localConfig: DeviceLocalConfig = {
        venueId: 'test-venue',
        deviceToken: 'token',
        backendUrl: 'http://localhost',
        prodoohApiKey: null,
        prodoohNetworkId: null,
        gamAdTag: 'https://pubads.g.doubleclick.net/gampad/ads?test=true',
      };

      const sources = buildSources(localConfig, null, { database: store.getDatabase() });

      expect(sources.has('gam')).toBe(true);
      store.close();
    });

    it('should use backend config to create sources when available', () => {
      const store = createInMemoryStore();
      const localConfig: DeviceLocalConfig = {
        venueId: 'test-venue',
        deviceToken: 'token',
        backendUrl: 'http://localhost',
        prodoohApiKey: null,
        prodoohNetworkId: null,
        gamAdTag: null,
      };
      const backendConfig = makeBackendConfig();

      const sources = buildSources(localConfig, backendConfig, { database: store.getDatabase() });

      expect(sources.has('prodooh')).toBe(true);
      expect(sources.has('gam')).toBe(true);
      expect(sources.has('url')).toBe(true);
      expect(sources.has('playlist')).toBe(true);
      store.close();
    });

    it('should not create disabled sources from backend config', () => {
      const store = createInMemoryStore();
      const localConfig: DeviceLocalConfig = {
        venueId: 'test-venue',
        deviceToken: 'token',
        backendUrl: 'http://localhost',
        prodoohApiKey: null,
        prodoohNetworkId: null,
        gamAdTag: null,
      };
      const backendConfig = makeBackendConfig({
        sources: {
          prodooh: { enabled: false, api_key: 'key', network_id: 'net' },
          gam: { enabled: false, ad_tag_url: 'https://pubads.g.doubleclick.net/test' },
          url: { enabled: false, urls: [] },
          playlist: { enabled: true },
        },
      });

      const sources = buildSources(localConfig, backendConfig, { database: store.getDatabase() });

      expect(sources.has('prodooh')).toBe(false);
      expect(sources.has('gam')).toBe(false);
      expect(sources.has('url')).toBe(false);
      expect(sources.has('playlist')).toBe(true);
      store.close();
    });
  });

  describe('bootPlayer (full flow)', () => {
    it('should boot in factory mode when no config exists (first boot, Req 25.2)', async () => {
      const store = createInMemoryStore();

      const result = await bootPlayer({ configStore: store });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('factory');
      expect(result.engine).not.toBeNull();
      result.engine!.stop();
      store.close();
    });

    it('should boot in cached mode when backend is unreachable but cached config exists (Req 1.4)', async () => {
      const store = createInMemoryStore();
      seedStoreWithConfig(store);

      // Set cached loop config
      store.setLoopConfig({
        slots: [
          { position: 0, source: 'prodooh', duration: 10 },
          { position: 1, source: 'playlist', duration: 10 },
        ],
        total_duration: 20,
        version: 'cached-v2',
      });

      // Mock backend that fails authentication
      const mockApi = createMockBackendApi(false);

      const result = await bootPlayer({
        configStore: store,
        backendApi: mockApi,
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('cached');
      expect(result.engine).not.toBeNull();
      result.engine!.stop();
      store.close();
    });

    it('should boot in normal mode when backend is reachable and returns config', async () => {
      const store = createInMemoryStore();
      seedStoreWithConfig(store);

      const mockApi = createMockBackendApi(true);
      const backendConfig = makeBackendConfig();

      const result = await bootPlayer({
        configStore: store,
        backendApi: mockApi,
        fetchConfig: async () => backendConfig,
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('normal');
      expect(result.engine).not.toBeNull();
      result.engine!.stop();
      store.close();
    });

    it('should persist backend config to local store for future offline use', async () => {
      const store = createInMemoryStore();
      seedStoreWithConfig(store);

      const mockApi = createMockBackendApi(true);
      const backendConfig = makeBackendConfig();

      const result = await bootPlayer({
        configStore: store,
        backendApi: mockApi,
        fetchConfig: async () => backendConfig,
      });

      // Verify config was persisted
      const cached = store.getLoopConfig();
      expect(cached).not.toBeNull();
      expect(cached!.slots).toHaveLength(4);
      expect(cached!.version).toBe('backend-live');

      result.engine!.stop();
      store.close();
    });

    it('should persist schedule config from backend', async () => {
      const store = createInMemoryStore();
      seedStoreWithConfig(store);

      const mockApi = createMockBackendApi(true);
      const backendConfig = makeBackendConfig({
        schedule: {
          timezone: 'America/Bogota',
          rules: [{ days: [1, 2, 3, 4, 5], start: '08:00', end: '20:00' }],
        },
      });

      const result = await bootPlayer({
        configStore: store,
        backendApi: mockApi,
        fetchConfig: async () => backendConfig,
      });

      const cached = store.getSchedule();
      expect(cached).not.toBeNull();
      expect(cached!.timezone).toBe('America/Bogota');

      result.engine!.stop();
      store.close();
    });

    it('should degrade gracefully when backend auth succeeds but config fetch fails', async () => {
      const store = createInMemoryStore();
      seedStoreWithConfig(store);

      // Set a cached config so we get 'cached' mode
      store.setLoopConfig({
        slots: [{ position: 0, source: 'playlist', duration: 10 }],
        total_duration: 10,
        version: 'old-cached',
      });

      const mockApi = createMockBackendApi(true);

      const result = await bootPlayer({
        configStore: store,
        backendApi: mockApi,
        fetchConfig: async () => null, // Config fetch fails
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('cached');
      result.engine!.stop();
      store.close();
    });

    it('should create engine with correct number of sources based on config', async () => {
      const store = createInMemoryStore();
      seedStoreWithConfig(store);

      const mockApi = createMockBackendApi(true);
      const backendConfig = makeBackendConfig({
        sources: {
          prodooh: { enabled: true, api_key: 'key', network_id: 'net' },
          gam: { enabled: false, ad_tag_url: '' },
          url: { enabled: false, urls: [] },
          playlist: { enabled: true },
        },
      });

      const result = await bootPlayer({
        configStore: store,
        backendApi: mockApi,
        fetchConfig: async () => backendConfig,
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('normal');
      result.engine!.stop();
      store.close();
    });

    it('should handle completely empty store and no backend (first boot factory, Req 4.1)', async () => {
      const store = createInMemoryStore();
      // Empty store - no venue_id, no credentials at all

      const result = await bootPlayer({ configStore: store });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('factory');
      // Engine should only have playlist source
      expect(result.engine).not.toBeNull();
      result.engine!.stop();
      store.close();
    });
  });
});
