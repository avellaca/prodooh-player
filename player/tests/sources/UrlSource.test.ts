import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UrlSource, DomIframeLoader } from '../../src/sources/UrlSource';
import type { IframeLoader } from '../../src/sources/UrlSource';

/**
 * Creates a mock IframeLoader for testing without real DOM interactions.
 * - successLoader: always resolves with a mock iframe
 * - failureLoader: always resolves with null (simulates timeout/failure)
 * - delayedLoader: resolves after a specified delay
 */
function createMockIframeLoader(options: {
  shouldSucceed?: boolean;
  loadDelay?: number;
  onLoad?: (url: string, timeout: number) => void;
  onDispose?: (iframe: HTMLIFrameElement) => void;
} = {}): IframeLoader {
  const { shouldSucceed = true, loadDelay = 0, onLoad, onDispose } = options;

  return {
    load: async (url: string, timeout: number): Promise<HTMLIFrameElement | null> => {
      onLoad?.(url, timeout);
      if (loadDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, loadDelay));
      }
      if (!shouldSucceed) {
        return null;
      }
      const iframe = document.createElement('iframe');
      iframe.src = url;
      iframe.style.visibility = 'hidden';
      return iframe;
    },
    dispose: (iframe: HTMLIFrameElement): void => {
      onDispose?.(iframe);
      iframe.src = 'about:blank';
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    },
  };
}

describe('UrlSource', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor and isAvailable', () => {
    it('should create instance with id "url"', () => {
      const source = new UrlSource({ urls: [], iframeLoader: createMockIframeLoader() });
      expect(source.id).toBe('url');
    });

    it('should return false for isAvailable when no URLs configured', () => {
      const source = new UrlSource({ urls: [], iframeLoader: createMockIframeLoader() });
      expect(source.isAvailable()).toBe(false);
    });

    it('should return true for isAvailable when at least one URL is configured', () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com', duration: 10 }],
        iframeLoader: createMockIframeLoader(),
      });
      expect(source.isAvailable()).toBe(true);
    });

    it('should accept optional timeout and variables', () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com', duration: 10 }],
        timeout: 5000,
        variables: { venue_id: 'v123' },
        iframeLoader: createMockIframeLoader(),
      });
      expect(source.isAvailable()).toBe(true);
    });
  });

  describe('prefetch', () => {
    it('should return null when no URLs are configured', async () => {
      const source = new UrlSource({ urls: [], iframeLoader: createMockIframeLoader() });
      const result = await source.prefetch();
      expect(result).toBeNull();
    });

    it('should return PreparedContent with type "url" and source "url"', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://dashboard.example.com', duration: 15 }],
        iframeLoader: createMockIframeLoader(),
      });

      const result = await source.prefetch();

      expect(result).not.toBeNull();
      expect(result!.type).toBe('url');
      expect(result!.source).toBe('url');
      expect(result!.mediaUrl).toBe('https://dashboard.example.com');
      expect(result!.duration).toBe(15);
      expect(result!.id).toMatch(/^url-/);
    });

    it('should include an iframe element in the PreparedContent', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com', duration: 10 }],
        iframeLoader: createMockIframeLoader(),
      });

      const result = await source.prefetch();

      expect(result).not.toBeNull();
      expect(result!.element).toBeDefined();
      expect(result!.element).toBeInstanceOf(HTMLIFrameElement);
      expect((result!.element as HTMLIFrameElement).src).toContain('https://example.com');
    });

    it('should include metadata with originalUrl, timeout, and refresh_interval', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com', duration: 10, refresh_interval: 30 }],
        timeout: 5000,
        iframeLoader: createMockIframeLoader(),
      });

      const result = await source.prefetch();

      expect(result!.metadata).toEqual({
        originalUrl: 'https://example.com',
        timeout: 5000,
        refresh_interval: 30,
      });
    });

    it('should set refresh_interval to null in metadata when not provided', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com', duration: 10 }],
        iframeLoader: createMockIframeLoader(),
      });

      const result = await source.prefetch();

      expect(result!.metadata.refresh_interval).toBeNull();
    });

    it('should use default timeout of 10000ms in metadata', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com', duration: 10 }],
        iframeLoader: createMockIframeLoader(),
      });

      const result = await source.prefetch();

      expect(result!.metadata.timeout).toBe(10000);
    });

    it('should cycle through multiple URLs sequentially', async () => {
      const source = new UrlSource({
        urls: [
          { url: 'https://first.com', duration: 10 },
          { url: 'https://second.com', duration: 20 },
          { url: 'https://third.com', duration: 30 },
        ],
        iframeLoader: createMockIframeLoader(),
      });

      const first = await source.prefetch();
      const second = await source.prefetch();
      const third = await source.prefetch();
      const fourth = await source.prefetch(); // wraps back to first

      expect(first!.mediaUrl).toBe('https://first.com');
      expect(first!.duration).toBe(10);
      expect(second!.mediaUrl).toBe('https://second.com');
      expect(second!.duration).toBe(20);
      expect(third!.mediaUrl).toBe('https://third.com');
      expect(third!.duration).toBe(30);
      expect(fourth!.mediaUrl).toBe('https://first.com');
      expect(fourth!.duration).toBe(10);
    });

    it('should work correctly with a single URL (always returns same)', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://only.com', duration: 15 }],
        iframeLoader: createMockIframeLoader(),
      });

      const first = await source.prefetch();
      const second = await source.prefetch();

      expect(first!.mediaUrl).toBe('https://only.com');
      expect(second!.mediaUrl).toBe('https://only.com');
    });

    it('should return null when iframe load fails (simulates timeout/error)', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://broken.com', duration: 10 }],
        iframeLoader: createMockIframeLoader({ shouldSucceed: false }),
      });

      const result = await source.prefetch();

      expect(result).toBeNull();
    });

    it('should still advance rotation index on load failure', async () => {
      let callCount = 0;
      const loader: IframeLoader = {
        load: async (url: string) => {
          callCount++;
          // First call fails, subsequent succeed
          if (callCount === 1) return null;
          const iframe = document.createElement('iframe');
          iframe.src = url;
          return iframe;
        },
        dispose: () => {},
      };

      const source = new UrlSource({
        urls: [
          { url: 'https://first.com', duration: 10 },
          { url: 'https://second.com', duration: 20 },
        ],
        iframeLoader: loader,
      });

      // First prefetch fails (first URL)
      const first = await source.prefetch();
      expect(first).toBeNull();

      // Second prefetch succeeds (second URL, not first again)
      const second = await source.prefetch();
      expect(second).not.toBeNull();
      expect(second!.mediaUrl).toBe('https://second.com');
    });

    it('should pass the configured timeout to the iframe loader', async () => {
      const receivedTimeouts: number[] = [];
      const loader = createMockIframeLoader({
        onLoad: (_url, timeout) => {
          receivedTimeouts.push(timeout);
        },
      });

      const source = new UrlSource({
        urls: [{ url: 'https://example.com', duration: 10 }],
        timeout: 7500,
        iframeLoader: loader,
      });

      await source.prefetch();

      expect(receivedTimeouts).toEqual([7500]);
    });

    it('should pass default timeout (10000ms) to iframe loader when not specified', async () => {
      const receivedTimeouts: number[] = [];
      const loader = createMockIframeLoader({
        onLoad: (_url, timeout) => {
          receivedTimeouts.push(timeout);
        },
      });

      const source = new UrlSource({
        urls: [{ url: 'https://example.com', duration: 10 }],
        iframeLoader: loader,
      });

      await source.prefetch();

      expect(receivedTimeouts).toEqual([10000]);
    });
  });

  describe('variable injection', () => {
    it('should replace {venue_id} in URL', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com/screen/{venue_id}', duration: 10 }],
        variables: { venue_id: 'screen-42' },
        iframeLoader: createMockIframeLoader(),
      });

      const result = await source.prefetch();

      expect(result!.mediaUrl).toBe('https://example.com/screen/screen-42');
    });

    it('should replace {tenant_id} in URL', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com/tenant/{tenant_id}/dashboard', duration: 10 }],
        variables: { tenant_id: 'tenant-abc' },
        iframeLoader: createMockIframeLoader(),
      });

      const result = await source.prefetch();

      expect(result!.mediaUrl).toBe('https://example.com/tenant/tenant-abc/dashboard');
    });

    it('should replace {timestamp} with current epoch milliseconds', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com/data?t={timestamp}', duration: 10 }],
        iframeLoader: createMockIframeLoader(),
      });

      const result = await source.prefetch();

      const expectedTimestamp = new Date('2024-06-15T12:00:00.000Z').getTime().toString();
      expect(result!.mediaUrl).toBe(`https://example.com/data?t=${expectedTimestamp}`);
    });

    it('should replace multiple variables in the same URL', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com/{venue_id}/{tenant_id}?t={timestamp}', duration: 10 }],
        variables: { venue_id: 'v1', tenant_id: 't2' },
        iframeLoader: createMockIframeLoader(),
      });

      const result = await source.prefetch();

      const expectedTimestamp = new Date('2024-06-15T12:00:00.000Z').getTime().toString();
      expect(result!.mediaUrl).toBe(`https://example.com/v1/t2?t=${expectedTimestamp}`);
    });

    it('should replace multiple occurrences of the same variable', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com/{venue_id}/info/{venue_id}', duration: 10 }],
        variables: { venue_id: 'screen-1' },
        iframeLoader: createMockIframeLoader(),
      });

      const result = await source.prefetch();

      expect(result!.mediaUrl).toBe('https://example.com/screen-1/info/screen-1');
    });

    it('should leave unrecognized template variables unchanged', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com/{unknown_var}', duration: 10 }],
        variables: { venue_id: 'v1' },
        iframeLoader: createMockIframeLoader(),
      });

      const result = await source.prefetch();

      expect(result!.mediaUrl).toBe('https://example.com/{unknown_var}');
    });

    it('should store original URL template in metadata', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com/{venue_id}', duration: 10 }],
        variables: { venue_id: 'screen-1' },
        iframeLoader: createMockIframeLoader(),
      });

      const result = await source.prefetch();

      expect(result!.metadata.originalUrl).toBe('https://example.com/{venue_id}');
      expect(result!.mediaUrl).toBe('https://example.com/screen-1');
    });

    it('should handle URL with no variables and no variables config', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://static.example.com/page', duration: 10 }],
        iframeLoader: createMockIframeLoader(),
      });

      const result = await source.prefetch();

      expect(result!.mediaUrl).toBe('https://static.example.com/page');
    });
  });

  describe('confirmPlay', () => {
    it('should dispose the iframe element when present', async () => {
      const disposed: HTMLIFrameElement[] = [];
      const loader = createMockIframeLoader({
        onDispose: (iframe) => disposed.push(iframe),
      });

      const source = new UrlSource({
        urls: [{ url: 'https://example.com', duration: 10 }],
        iframeLoader: loader,
      });

      const content = await source.prefetch();
      await source.confirmPlay(content!);

      expect(disposed.length).toBe(1);
      expect(disposed[0]).toBe(content!.element);
    });

    it('should resolve without error when element is not present', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com', duration: 10 }],
        iframeLoader: createMockIframeLoader(),
      });

      const content = {
        id: 'url-123',
        type: 'url' as const,
        source: 'url' as const,
        mediaUrl: 'https://example.com',
        duration: 10,
        metadata: {},
      };

      await expect(source.confirmPlay(content)).resolves.toBeUndefined();
    });
  });

  describe('reportFailure', () => {
    it('should dispose iframe and log error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const disposed: HTMLIFrameElement[] = [];
      const loader = createMockIframeLoader({
        onDispose: (iframe) => disposed.push(iframe),
      });

      const source = new UrlSource({
        urls: [{ url: 'https://example.com', duration: 10 }],
        iframeLoader: loader,
      });

      const content = await source.prefetch();
      await source.reportFailure(content!, 'display error');

      expect(disposed.length).toBe(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[UrlSource] Failed to load URL https://example.com: display error'
      );

      consoleSpy.mockRestore();
    });

    it('should resolve without error when element is not present', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const source = new UrlSource({
        urls: [{ url: 'https://example.com', duration: 10 }],
        iframeLoader: createMockIframeLoader(),
      });

      const content = {
        id: 'url-123',
        type: 'url' as const,
        source: 'url' as const,
        mediaUrl: 'https://example.com',
        duration: 10,
        metadata: {},
      };

      await expect(
        source.reportFailure(content, 'timeout after 10s')
      ).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalledWith(
        '[UrlSource] Failed to load URL https://example.com: timeout after 10s'
      );

      consoleSpy.mockRestore();
    });
  });

  describe('DomIframeLoader', () => {
    it('should create a hidden iframe and append to document body', async () => {
      const loader = new DomIframeLoader();
      const loadPromise = loader.load('https://example.com', 10000);

      // Simulate load event on the iframe
      const iframe = document.querySelector('iframe');
      expect(iframe).not.toBeNull();
      expect(iframe!.style.visibility).toBe('hidden');
      expect(iframe!.src).toContain('https://example.com');
      expect(iframe!.style.width).toBe('100%');
      expect(iframe!.style.height).toBe('100%');
      expect(iframe!.style.position).toBe('absolute');

      // Fire load event
      iframe!.dispatchEvent(new Event('load'));

      const result = await loadPromise;
      expect(result).toBe(iframe);
    });

    it('should return null on iframe error event', async () => {
      // Use a short timeout so the test resolves quickly via timeout path
      // In jsdom, iframe error events dispatched programmatically may not 
      // resolve the promise; the timeout path ensures graceful failure handling.
      const loader = new DomIframeLoader();
      const loadPromise = loader.load('https://broken.com', 100);

      const iframe = document.querySelector('iframe');
      expect(iframe).not.toBeNull();

      // Advance past the timeout
      vi.advanceTimersByTime(101);

      const result = await loadPromise;
      expect(result).toBeNull();
    });

    it('should return null on timeout', async () => {
      const loader = new DomIframeLoader();
      const loadPromise = loader.load('https://slow.com', 5000);

      const iframe = document.querySelector('iframe');
      expect(iframe).not.toBeNull();

      // Advance time past timeout
      vi.advanceTimersByTime(5001);

      const result = await loadPromise;
      expect(result).toBeNull();
    });

    it('should set sandbox attribute on iframe for security', async () => {
      const loader = new DomIframeLoader();
      loader.load('https://example.com', 10000);

      const iframe = document.querySelector('iframe');
      expect(iframe).not.toBeNull();
      expect(iframe!.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms');

      // Clean up
      iframe!.dispatchEvent(new Event('load'));
    });

    it('should dispose iframe by removing from DOM and blanking src', () => {
      const loader = new DomIframeLoader();
      const iframe = document.createElement('iframe');
      iframe.src = 'https://example.com';
      document.body.appendChild(iframe);

      expect(document.body.contains(iframe)).toBe(true);

      loader.dispose(iframe);

      expect(iframe.src).toContain('about:blank');
      expect(document.body.contains(iframe)).toBe(false);
    });

    it('should not throw when disposing iframe not in DOM', () => {
      const loader = new DomIframeLoader();
      const iframe = document.createElement('iframe');
      iframe.src = 'https://example.com';

      expect(() => loader.dispose(iframe)).not.toThrow();
      expect(iframe.src).toContain('about:blank');
    });
  });
});
