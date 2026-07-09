import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScreenshotService } from '../../src/services/ScreenshotService';
import type { ScreenCaptureProvider } from '../../src/services/ScreenshotService';
import type { DeviceCommand } from '../../src/sync/HeartbeatService';

/**
 * Tests for ScreenshotService.
 * Validates: Requirements 17.1, 17.2
 */

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createMockBlob(): Blob {
  return new Blob(['fake-jpeg-data'], { type: 'image/jpeg' });
}

function createMockCaptureProvider(blob?: Blob): ScreenCaptureProvider {
  return {
    captureFrame: vi.fn(async () => blob ?? createMockBlob()),
  };
}

function createFailingCaptureProvider(error: Error): ScreenCaptureProvider {
  return {
    captureFrame: vi.fn(async () => { throw error; }),
  };
}

function createSlowCaptureProvider(delayMs: number): ScreenCaptureProvider {
  return {
    captureFrame: vi.fn(() => {
      const promise = new Promise<Blob>((resolve) => {
        setTimeout(() => resolve(createMockBlob()), delayMs);
      });
      // Suppress unhandled rejection if timeout wins the race
      promise.catch(() => {});
      return promise;
    }),
  };
}

function mockFetchSuccess(responseData = { id: 'screenshot-1', url: 'https://cdn.example.com/screenshot-1.jpg' }) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => responseData,
  });
}

function mockFetchFailure(status = 500) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error: 'Upload failed' }),
  });
}

function mockFetchNetworkError() {
  return vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
}

describe('ScreenshotService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = mockFetchSuccess();
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function createService(overrides?: {
    captureProvider?: ScreenCaptureProvider;
    token?: string | null;
    timeoutMs?: number;
  }) {
    const captureProvider = overrides?.captureProvider ?? createMockCaptureProvider();
    const token = overrides !== undefined && 'token' in overrides ? overrides.token : 'test-jwt-token';

    return new ScreenshotService({
      baseUrl: 'http://localhost:8000',
      getToken: () => token,
      captureProvider,
      timeoutMs: overrides?.timeoutMs,
    });
  }

  describe('captureAndUpload()', () => {
    it('should capture frame and upload as multipart form data', async () => {
      const captureProvider = createMockCaptureProvider();
      const service = createService({ captureProvider });

      await service.captureAndUpload();

      expect(captureProvider.captureFrame).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledOnce();

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('http://localhost:8000/api/device/screenshot');
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);
    });

    it('should include Authorization header with Bearer token', async () => {
      const service = createService({ token: 'my-secret-token' });

      await service.captureAndUpload();

      const [, init] = fetchMock.mock.calls[0]!;
      expect(init.headers['Authorization']).toBe('Bearer my-secret-token');
    });

    it('should not include Authorization header when token is null', async () => {
      const service = createService({ token: null });

      await service.captureAndUpload();

      const [, init] = fetchMock.mock.calls[0]!;
      expect(init.headers['Authorization']).toBeUndefined();
    });

    it('should send image as JPEG file in form data', async () => {
      const jpegBlob = new Blob(['jpeg-content'], { type: 'image/jpeg' });
      const captureProvider = createMockCaptureProvider(jpegBlob);
      const service = createService({ captureProvider });

      await service.captureAndUpload();

      const [, init] = fetchMock.mock.calls[0]!;
      const formData = init.body as FormData;
      const imageField = formData.get('image');
      expect(imageField).toBeTruthy();
      expect(imageField).toBeInstanceOf(File);
      expect((imageField as File).name).toBe('screenshot.jpg');
    });

    it('should include captured_at ISO 8601 timestamp in form data', async () => {
      vi.setSystemTime(new Date('2024-07-01T14:30:00.000Z'));
      const service = createService();

      await service.captureAndUpload();

      const [, init] = fetchMock.mock.calls[0]!;
      const formData = init.body as FormData;
      expect(formData.get('captured_at')).toBe('2024-07-01T14:30:00.000Z');
    });

    it('should return the screenshot response from backend', async () => {
      const expected = { id: 'ss-123', url: 'https://cdn.example.com/ss-123.jpg' };
      fetchMock = mockFetchSuccess(expected);
      vi.stubGlobal('fetch', fetchMock);

      const service = createService();
      const result = await service.captureAndUpload();

      expect(result).toEqual(expected);
    });

    it('should throw when capture fails', async () => {
      const captureError = new Error('Screen capture unavailable');
      const captureProvider = createFailingCaptureProvider(captureError);
      const service = createService({ captureProvider });

      await expect(service.captureAndUpload()).rejects.toThrow('Screen capture unavailable');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should throw when upload returns non-OK response', async () => {
      fetchMock = mockFetchFailure(500);
      vi.stubGlobal('fetch', fetchMock);

      const service = createService();

      await expect(service.captureAndUpload()).rejects.toThrow(
        'Screenshot upload failed with status 500',
      );
    });

    it('should throw when network error occurs during upload', async () => {
      fetchMock = mockFetchNetworkError();
      vi.stubGlobal('fetch', fetchMock);

      const service = createService();

      await expect(service.captureAndUpload()).rejects.toThrow('Failed to fetch');
    });

    it('should strip trailing slashes from base URL', async () => {
      const captureProvider = createMockCaptureProvider();
      const service = new ScreenshotService({
        baseUrl: 'http://localhost:8000///',
        getToken: () => 'token',
        captureProvider,
      });

      await service.captureAndUpload();

      const [url] = fetchMock.mock.calls[0]!;
      expect(url).toBe('http://localhost:8000/api/device/screenshot');
    });
  });

  describe('timeout handling', () => {
    it('should reject if capture exceeds timeout', async () => {
      // Use a slow capture provider that takes 40s (exceeds 30s default)
      const captureProvider = createSlowCaptureProvider(40_000);
      const service = createService({ captureProvider, timeoutMs: 30_000 });

      const promise = service.captureAndUpload();
      // Attach rejection handler before advancing timers to prevent unhandled rejection
      const assertion = expect(promise).rejects.toThrow('Screenshot operation timed out');

      // Advance time past the timeout
      await vi.advanceTimersByTimeAsync(31_000);

      await assertion;
    });

    it('should reject if upload exceeds timeout', async () => {
      // Capture is fast but upload is slow
      const captureProvider = createMockCaptureProvider();
      fetchMock = vi.fn(() => new Promise((resolve) => {
        setTimeout(() => resolve({
          ok: true,
          status: 200,
          json: async () => ({ id: 'x', url: 'y' }),
        }), 40_000);
      }));
      vi.stubGlobal('fetch', fetchMock);

      const service = createService({ captureProvider, timeoutMs: 30_000 });
      const promise = service.captureAndUpload();
      const assertion = expect(promise).rejects.toThrow('Screenshot operation timed out');

      // Advance time past the timeout
      await vi.advanceTimersByTimeAsync(31_000);

      await assertion;
    });

    it('should use custom timeout when specified', async () => {
      const captureProvider = createSlowCaptureProvider(6_000);
      const service = createService({ captureProvider, timeoutMs: 5_000 });

      const promise = service.captureAndUpload();
      const assertion = expect(promise).rejects.toThrow('Screenshot operation timed out');

      // Advance time to just past the 5s custom timeout
      await vi.advanceTimersByTimeAsync(5_100);

      await assertion;
    });

    it('should succeed within timeout window', async () => {
      const captureProvider = createSlowCaptureProvider(1_000);
      const service = createService({ captureProvider, timeoutMs: 30_000 });

      const promise = service.captureAndUpload();

      // Advance past the capture delay
      await vi.advanceTimersByTimeAsync(1_100);

      const result = await promise;
      expect(result).toEqual({ id: 'screenshot-1', url: 'https://cdn.example.com/screenshot-1.jpg' });
    });
  });

  describe('handleCommand() (CommandHandler integration)', () => {
    it('should call captureAndUpload for screenshot commands', async () => {
      const captureProvider = createMockCaptureProvider();
      const service = createService({ captureProvider });

      const command: DeviceCommand = {
        id: 'cmd-1',
        type: 'screenshot',
        payload: {},
      };

      await service.handleCommand(command);

      expect(captureProvider.captureFrame).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('should ignore non-screenshot commands', async () => {
      const captureProvider = createMockCaptureProvider();
      const service = createService({ captureProvider });

      const command: DeviceCommand = {
        id: 'cmd-2',
        type: 'config_update',
        payload: { key: 'value' },
      };

      await service.handleCommand(command);

      expect(captureProvider.captureFrame).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should ignore playlist_update commands', async () => {
      const captureProvider = createMockCaptureProvider();
      const service = createService({ captureProvider });

      const command: DeviceCommand = {
        id: 'cmd-3',
        type: 'playlist_update',
        payload: {},
      };

      await service.handleCommand(command);

      expect(captureProvider.captureFrame).not.toHaveBeenCalled();
    });

    it('should propagate errors from captureAndUpload', async () => {
      const captureProvider = createFailingCaptureProvider(new Error('Capture error'));
      const service = createService({ captureProvider });

      const command: DeviceCommand = {
        id: 'cmd-1',
        type: 'screenshot',
        payload: {},
      };

      await expect(service.handleCommand(command)).rejects.toThrow('Capture error');
    });
  });

  describe('default timeout value', () => {
    it('should default to 30000ms timeout', async () => {
      const captureProvider = createSlowCaptureProvider(31_000);
      const service = createService({ captureProvider });

      const promise = service.captureAndUpload();
      const assertion = expect(promise).rejects.toThrow('Screenshot operation timed out');

      // At 30s it should timeout
      await vi.advanceTimersByTimeAsync(30_100);

      await assertion;
    });
  });
});
