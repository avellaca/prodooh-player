import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  bootPlayer,
  loadLocalConfig,
} from '../src/boot';
import type { DeviceLocalConfig } from '../src/boot';
import { LocalConfigStore } from '../src/storage/LocalConfigStore';
import { BackendApi } from '../src/api/BackendApi';

/**
 * Tests for the player boot sequence.
 * Validates: Requirements 1.1, 10.1, 10.2
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

  describe('bootPlayer (full flow)', () => {
    it('should boot in factory mode when no config exists (first boot)', async () => {
      const store = createInMemoryStore();

      const result = await bootPlayer({ configStore: store });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('factory');
      expect(result.manifestEngine).toBeNull();
      store.close();
    });

    it('should boot in factory mode when backend auth fails', async () => {
      const store = createInMemoryStore();
      seedStoreWithConfig(store);

      const mockApi = createMockBackendApi(false);

      const result = await bootPlayer({
        configStore: store,
        backendApi: mockApi,
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('factory');
      expect(result.manifestEngine).toBeNull();
      expect(result.manifestSyncManager).toBeNull();
      expect(result.impressionReporter).toBeNull();
      store.close();
    });

    it('should boot in normal mode when backend auth succeeds', async () => {
      const store = createInMemoryStore();
      seedStoreWithConfig(store);

      const mockApi = createMockBackendApi(true);

      const result = await bootPlayer({
        configStore: store,
        backendApi: mockApi,
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('normal');
      expect(result.manifestEngine).not.toBeNull();
      expect(result.manifestSyncManager).not.toBeNull();
      expect(result.impressionReporter).not.toBeNull();
      expect(result.heartbeatService).not.toBeNull();
      store.close();
    });

    it('should handle completely empty store and no backend', async () => {
      const store = createInMemoryStore();

      const result = await bootPlayer({ configStore: store });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('factory');
      expect(result.manifestEngine).toBeNull();
      store.close();
    });
  });
});
