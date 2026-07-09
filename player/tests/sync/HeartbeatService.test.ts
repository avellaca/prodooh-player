import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeartbeatService } from '../../src/sync/HeartbeatService';
import type {
  DeviceStatusProvider,
  CommandHandler,
  DeviceCommand,
  StorageStatus,
  CurrentContent,
} from '../../src/sync/HeartbeatService';
import { BackendApiClient } from '../../src/api/BackendApiClient';

/**
 * Tests for HeartbeatService.
 * Validates: Requirements 8.1, 22.1
 */

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createMockStatusProvider(overrides?: Partial<DeviceStatusProvider>): DeviceStatusProvider {
  return {
    getVenueId: () => 'venue-001',
    getCurrentContent: () => ({ id: 'content-123', source: 'playlist' as const }),
    getStorageStatus: () => ({ total_mb: 32000, available_mb: 15000, percent_used: 53 }),
    getUptimeSeconds: () => 3600,
    getPlaylistVersion: () => 'v1.2.3',
    ...overrides,
  };
}

function createMockCommandHandler(): CommandHandler & { calls: DeviceCommand[] } {
  const calls: DeviceCommand[] = [];
  return {
    calls,
    handleCommand: vi.fn(async (command: DeviceCommand) => {
      calls.push(command);
    }),
  };
}

describe('HeartbeatService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function createClient(): BackendApiClient {
    const client = new BackendApiClient('http://localhost:8000');
    client.setToken('test-jwt-token');
    return client;
  }

  function mockSuccessResponse(commands: DeviceCommand[] = []) {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ ack: true, pending_commands: commands }),
    });
  }

  function mockFailureResponse(status = 500) {
    fetchMock.mockResolvedValue({
      ok: false,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'Server error' }),
    });
  }

  function mockNetworkError() {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
  }

  describe('sendHeartbeat()', () => {
    it('should POST to /api/device/heartbeat with correct payload', async () => {
      mockSuccessResponse();

      const client = createClient();
      const statusProvider = createMockStatusProvider();
      const service = new HeartbeatService({ client, statusProvider });

      await service.sendHeartbeat();

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('http://localhost:8000/api/device/heartbeat');
      expect(init.method).toBe('POST');

      const body = JSON.parse(init.body as string);
      expect(body.venue_id).toBe('venue-001');
      expect(body.current_content).toEqual({ id: 'content-123', source: 'playlist' });
      expect(body.storage).toEqual({ total_mb: 32000, available_mb: 15000, percent_used: 53 });
      expect(body.uptime_seconds).toBe(3600);
      expect(body.playlist_version).toBe('v1.2.3');
      expect(body.timestamp).toBeDefined();
    });

    it('should include Authorization header', async () => {
      mockSuccessResponse();

      const client = createClient();
      const statusProvider = createMockStatusProvider();
      const service = new HeartbeatService({ client, statusProvider });

      await service.sendHeartbeat();

      const [, init] = fetchMock.mock.calls[0]!;
      expect(init.headers['Authorization']).toBe('Bearer test-jwt-token');
    });

    it('should send ISO 8601 timestamp', async () => {
      mockSuccessResponse();
      vi.setSystemTime(new Date('2024-06-15T10:30:00.000Z'));

      const client = createClient();
      const statusProvider = createMockStatusProvider();
      const service = new HeartbeatService({ client, statusProvider });

      await service.sendHeartbeat();

      const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(body.timestamp).toBe('2024-06-15T10:30:00.000Z');
    });

    it('should return pending commands on success', async () => {
      const commands: DeviceCommand[] = [
        { id: 'cmd-1', type: 'screenshot', payload: {} },
      ];
      mockSuccessResponse(commands);

      const client = createClient();
      const statusProvider = createMockStatusProvider();
      const service = new HeartbeatService({ client, statusProvider });

      const result = await service.sendHeartbeat();

      expect(result).toEqual(commands);
    });

    it('should return null on network failure', async () => {
      mockNetworkError();

      const client = createClient();
      const statusProvider = createMockStatusProvider();
      const service = new HeartbeatService({ client, statusProvider });

      const result = await service.sendHeartbeat();

      expect(result).toBeNull();
    });

    it('should return null on HTTP error response', async () => {
      mockFailureResponse(500);

      const client = createClient();
      const statusProvider = createMockStatusProvider();
      const service = new HeartbeatService({ client, statusProvider });

      const result = await service.sendHeartbeat();

      expect(result).toBeNull();
    });

    it('should handle null current_content when device is idle', async () => {
      mockSuccessResponse();

      const client = createClient();
      const statusProvider = createMockStatusProvider({
        getCurrentContent: () => null,
      });
      const service = new HeartbeatService({ client, statusProvider });

      await service.sendHeartbeat();

      const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(body.current_content).toBeNull();
    });

    it('should report storage status for monitoring (Req 22.1)', async () => {
      mockSuccessResponse();

      const storage: StorageStatus = { total_mb: 64000, available_mb: 8000, percent_used: 87 };
      const client = createClient();
      const statusProvider = createMockStatusProvider({
        getStorageStatus: () => storage,
      });
      const service = new HeartbeatService({ client, statusProvider });

      await service.sendHeartbeat();

      const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(body.storage).toEqual(storage);
    });
  });

  describe('command processing', () => {
    it('should invoke command handler for each pending command', async () => {
      const commands: DeviceCommand[] = [
        { id: 'cmd-1', type: 'screenshot', payload: { quality: 80 } },
        { id: 'cmd-2', type: 'config_update', payload: { key: 'interval' } },
      ];
      mockSuccessResponse(commands);

      const client = createClient();
      const statusProvider = createMockStatusProvider();
      const commandHandler = createMockCommandHandler();
      const service = new HeartbeatService({ client, statusProvider, commandHandler });

      await service.sendHeartbeat();

      expect(commandHandler.calls).toHaveLength(2);
      expect(commandHandler.calls[0]).toEqual(commands[0]);
      expect(commandHandler.calls[1]).toEqual(commands[1]);
    });

    it('should not fail if no command handler is registered', async () => {
      const commands: DeviceCommand[] = [
        { id: 'cmd-1', type: 'screenshot', payload: {} },
      ];
      mockSuccessResponse(commands);

      const client = createClient();
      const statusProvider = createMockStatusProvider();
      const service = new HeartbeatService({ client, statusProvider });

      const result = await service.sendHeartbeat();

      expect(result).toEqual(commands);
    });

    it('should continue processing remaining commands if one fails', async () => {
      const commands: DeviceCommand[] = [
        { id: 'cmd-1', type: 'screenshot', payload: {} },
        { id: 'cmd-2', type: 'config_update', payload: {} },
      ];
      mockSuccessResponse(commands);

      const client = createClient();
      const statusProvider = createMockStatusProvider();

      let callCount = 0;
      const commandHandler: CommandHandler = {
        handleCommand: async (command: DeviceCommand) => {
          callCount++;
          if (command.id === 'cmd-1') {
            throw new Error('Screenshot capture failed');
          }
        },
      };
      const service = new HeartbeatService({ client, statusProvider, commandHandler });

      const result = await service.sendHeartbeat();

      expect(result).toEqual(commands);
      expect(callCount).toBe(2);
    });

    it('should not process commands when response has empty array', async () => {
      mockSuccessResponse([]);

      const client = createClient();
      const statusProvider = createMockStatusProvider();
      const commandHandler = createMockCommandHandler();
      const service = new HeartbeatService({ client, statusProvider, commandHandler });

      await service.sendHeartbeat();

      expect(commandHandler.calls).toHaveLength(0);
    });
  });

  describe('periodic execution (start/stop)', () => {
    it('should send heartbeat immediately on start', async () => {
      mockSuccessResponse();

      const client = createClient();
      const statusProvider = createMockStatusProvider();
      const service = new HeartbeatService({ client, statusProvider, intervalMs: 30000 });

      service.start();
      // Let the microtask queue process
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchMock).toHaveBeenCalledOnce();

      service.stop();
    });

    it('should send heartbeat at configured interval', async () => {
      mockSuccessResponse();

      const client = createClient();
      const statusProvider = createMockStatusProvider();
      const service = new HeartbeatService({ client, statusProvider, intervalMs: 10000 });

      service.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10000);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(10000);
      expect(fetchMock).toHaveBeenCalledTimes(3);

      service.stop();
    });

    it('should stop sending heartbeats after stop()', async () => {
      mockSuccessResponse();

      const client = createClient();
      const statusProvider = createMockStatusProvider();
      const service = new HeartbeatService({ client, statusProvider, intervalMs: 5000 });

      service.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      service.stop();

      await vi.advanceTimersByTimeAsync(15000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should be idempotent on multiple start() calls', async () => {
      mockSuccessResponse();

      const client = createClient();
      const statusProvider = createMockStatusProvider();
      const service = new HeartbeatService({ client, statusProvider, intervalMs: 5000 });

      service.start();
      service.start();
      service.start();
      await vi.advanceTimersByTimeAsync(0);

      // Only one immediate heartbeat, not three
      expect(fetchMock).toHaveBeenCalledTimes(1);

      service.stop();
    });

    it('should reflect isRunning state correctly', () => {
      const client = createClient();
      const statusProvider = createMockStatusProvider();
      const service = new HeartbeatService({ client, statusProvider });

      expect(service.isRunning).toBe(false);

      service.start();
      expect(service.isRunning).toBe(true);

      service.stop();
      expect(service.isRunning).toBe(false);
    });

    it('should use default 60s interval when not specified', async () => {
      mockSuccessResponse();

      const client = createClient();
      const statusProvider = createMockStatusProvider();
      const service = new HeartbeatService({ client, statusProvider });

      service.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // No second call at 30s
      await vi.advanceTimersByTimeAsync(30000);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second call at 60s
      await vi.advanceTimersByTimeAsync(30000);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      service.stop();
    });
  });

  describe('setInterval()', () => {
    it('should update interval and restart if running', async () => {
      mockSuccessResponse();

      const client = createClient();
      const statusProvider = createMockStatusProvider();
      const service = new HeartbeatService({ client, statusProvider, intervalMs: 30000 });

      service.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Change interval to 5s — triggers restart (sends immediate heartbeat)
      service.setInterval(5000);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Should now fire at 5s intervals
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchMock).toHaveBeenCalledTimes(3);

      service.stop();
    });

    it('should not restart if service is not running', () => {
      const client = createClient();
      const statusProvider = createMockStatusProvider();
      const service = new HeartbeatService({ client, statusProvider, intervalMs: 30000 });

      service.setInterval(5000);
      expect(service.isRunning).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('graceful degradation', () => {
    it('should not throw when backend is unreachable', async () => {
      mockNetworkError();

      const client = createClient();
      const statusProvider = createMockStatusProvider();
      const service = new HeartbeatService({ client, statusProvider });

      // Should not throw
      const result = await service.sendHeartbeat();
      expect(result).toBeNull();
    });

    it('should continue periodic heartbeats after failures', async () => {
      // First call fails, subsequent succeed
      fetchMock
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ ack: true, pending_commands: [] }),
        });

      const client = createClient();
      const statusProvider = createMockStatusProvider();
      const service = new HeartbeatService({ client, statusProvider, intervalMs: 5000 });

      service.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Next interval should still fire
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      service.stop();
    });
  });
});
