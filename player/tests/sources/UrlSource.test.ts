import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UrlSource } from '../../src/sources/UrlSource';

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
      const source = new UrlSource({ urls: [] });
      expect(source.id).toBe('url');
    });

    it('should return false for isAvailable when no URLs configured', () => {
      const source = new UrlSource({ urls: [] });
      expect(source.isAvailable()).toBe(false);
    });

    it('should return true for isAvailable when at least one URL is configured', () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com', duration: 10 }],
      });
      expect(source.isAvailable()).toBe(true);
    });

    it('should accept optional timeout and variables', () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com', duration: 10 }],
        timeout: 5000,
        variables: { venue_id: 'v123' },
      });
      expect(source.isAvailable()).toBe(true);
    });
  });

  describe('prefetch', () => {
    it('should return null when no URLs are configured', async () => {
      const source = new UrlSource({ urls: [] });
      const result = await source.prefetch();
      expect(result).toBeNull();
    });

    it('should return PreparedContent with type "url" and source "url"', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://dashboard.example.com', duration: 15 }],
      });

      const result = await source.prefetch();

      expect(result).not.toBeNull();
      expect(result!.type).toBe('url');
      expect(result!.source).toBe('url');
      expect(result!.mediaUrl).toBe('https://dashboard.example.com');
      expect(result!.duration).toBe(15);
      expect(result!.id).toMatch(/^url-/);
    });

    it('should include metadata with originalUrl, timeout, and refresh_interval', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com', duration: 10, refresh_interval: 30 }],
        timeout: 5000,
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
      });

      const result = await source.prefetch();

      expect(result!.metadata.refresh_interval).toBeNull();
    });

    it('should use default timeout of 10000ms in metadata', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com', duration: 10 }],
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
      });

      const first = await source.prefetch();
      const second = await source.prefetch();

      expect(first!.mediaUrl).toBe('https://only.com');
      expect(second!.mediaUrl).toBe('https://only.com');
    });
  });

  describe('variable injection', () => {
    it('should replace {venue_id} in URL', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com/screen/{venue_id}', duration: 10 }],
        variables: { venue_id: 'screen-42' },
      });

      const result = await source.prefetch();

      expect(result!.mediaUrl).toBe('https://example.com/screen/screen-42');
    });

    it('should replace {tenant_id} in URL', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com/tenant/{tenant_id}/dashboard', duration: 10 }],
        variables: { tenant_id: 'tenant-abc' },
      });

      const result = await source.prefetch();

      expect(result!.mediaUrl).toBe('https://example.com/tenant/tenant-abc/dashboard');
    });

    it('should replace {timestamp} with current epoch milliseconds', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com/data?t={timestamp}', duration: 10 }],
      });

      const result = await source.prefetch();

      const expectedTimestamp = new Date('2024-06-15T12:00:00.000Z').getTime().toString();
      expect(result!.mediaUrl).toBe(`https://example.com/data?t=${expectedTimestamp}`);
    });

    it('should replace multiple variables in the same URL', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com/{venue_id}/{tenant_id}?t={timestamp}', duration: 10 }],
        variables: { venue_id: 'v1', tenant_id: 't2' },
      });

      const result = await source.prefetch();

      const expectedTimestamp = new Date('2024-06-15T12:00:00.000Z').getTime().toString();
      expect(result!.mediaUrl).toBe(`https://example.com/v1/t2?t=${expectedTimestamp}`);
    });

    it('should replace multiple occurrences of the same variable', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com/{venue_id}/info/{venue_id}', duration: 10 }],
        variables: { venue_id: 'screen-1' },
      });

      const result = await source.prefetch();

      expect(result!.mediaUrl).toBe('https://example.com/screen-1/info/screen-1');
    });

    it('should leave unrecognized template variables unchanged', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com/{unknown_var}', duration: 10 }],
        variables: { venue_id: 'v1' },
      });

      const result = await source.prefetch();

      expect(result!.mediaUrl).toBe('https://example.com/{unknown_var}');
    });

    it('should store original URL template in metadata', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com/{venue_id}', duration: 10 }],
        variables: { venue_id: 'screen-1' },
      });

      const result = await source.prefetch();

      expect(result!.metadata.originalUrl).toBe('https://example.com/{venue_id}');
      expect(result!.mediaUrl).toBe('https://example.com/screen-1');
    });

    it('should handle URL with no variables and no variables config', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://static.example.com/page', duration: 10 }],
      });

      const result = await source.prefetch();

      expect(result!.mediaUrl).toBe('https://static.example.com/page');
    });
  });

  describe('confirmPlay', () => {
    it('should be a no-op (resolves without error)', async () => {
      const source = new UrlSource({
        urls: [{ url: 'https://example.com', duration: 10 }],
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
    it('should log error and resolve without throwing', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const source = new UrlSource({
        urls: [{ url: 'https://example.com', duration: 10 }],
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
});
