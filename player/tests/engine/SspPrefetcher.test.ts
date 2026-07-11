import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SspPrefetcher, SspClient, SspContent } from '../../src/engine/SspPrefetcher';
import type { SspRetryQueue } from '../../src/sync/SspRetryQueue';

/**
 * Unit tests for SspPrefetcher — SSP content prefetch lifecycle.
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 7.4
 */

function makeSspContent(overrides?: Partial<SspContent>): SspContent {
  return {
    printId: 'print-001',
    assetUrl: 'https://ssp.example.com/ad/creative-001.mp4',
    durationSeconds: 10,
    mimeType: 'video/mp4',
    popUrl: 'https://ssp.example.com/pop/print-001',
    expireUrl: 'https://ssp.example.com/expire/print-001',
    ...overrides,
  };
}

function createMockSspClient(): SspClient & {
  requestAd: ReturnType<typeof vi.fn>;
  expireAd: ReturnType<typeof vi.fn>;
  proofOfPlay: ReturnType<typeof vi.fn>;
} {
  return {
    requestAd: vi.fn(),
    expireAd: vi.fn(),
    proofOfPlay: vi.fn(),
  };
}

function createMockRetryQueue(): { expire: ReturnType<typeof vi.fn>; proofOfPlay: ReturnType<typeof vi.fn> } {
  return {
    expire: vi.fn().mockResolvedValue(undefined),
    proofOfPlay: vi.fn().mockResolvedValue(undefined),
  };
}

describe('SspPrefetcher', () => {
  let mockClient: ReturnType<typeof createMockSspClient>;
  let prefetcher: SspPrefetcher;

  beforeEach(() => {
    mockClient = createMockSspClient();
    prefetcher = new SspPrefetcher(mockClient);
  });

  describe('prefetch calls sspClient.requestAd', () => {
    it('should call requestAd with the given duration and return content', async () => {
      const content = makeSspContent();
      mockClient.requestAd.mockResolvedValueOnce(content);

      const result = await prefetcher.prefetch(10);

      expect(mockClient.requestAd).toHaveBeenCalledWith(10);
      expect(result).toEqual(content);
    });
  });

  describe('isReady returns true after successful prefetch', () => {
    it('should return true when prefetch succeeds', async () => {
      mockClient.requestAd.mockResolvedValueOnce(makeSspContent());

      await prefetcher.prefetch(10);

      expect(prefetcher.isReady()).toBe(true);
    });
  });

  describe('isReady returns false initially', () => {
    it('should return false on a new prefetcher with no prefetch done', () => {
      expect(prefetcher.isReady()).toBe(false);
    });
  });

  describe('getContent returns prefetched content', () => {
    it('should return the SspContent after a successful prefetch', async () => {
      const content = makeSspContent({ printId: 'print-xyz', durationSeconds: 15 });
      mockClient.requestAd.mockResolvedValueOnce(content);

      await prefetcher.prefetch(15);

      expect(prefetcher.getContent()).toEqual(content);
    });

    it('should return null when no content has been prefetched', () => {
      expect(prefetcher.getContent()).toBeNull();
    });
  });

  describe('prefetch returns null on error', () => {
    it('should return null when requestAd throws and isReady stays false', async () => {
      mockClient.requestAd.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await prefetcher.prefetch(10);

      expect(result).toBeNull();
      expect(prefetcher.isReady()).toBe(false);
    });
  });

  describe('expire calls sspClient.expireAd and clears content', () => {
    it('should call expireAd and clear content when printId matches', async () => {
      const content = makeSspContent({ printId: 'print-to-expire' });
      mockClient.requestAd.mockResolvedValueOnce(content);
      mockClient.expireAd.mockResolvedValueOnce(undefined);

      await prefetcher.prefetch(10);
      expect(prefetcher.isReady()).toBe(true);

      await prefetcher.expire('print-to-expire');

      expect(mockClient.expireAd).toHaveBeenCalledWith('print-to-expire');
      expect(prefetcher.isReady()).toBe(false);
      expect(prefetcher.getContent()).toBeNull();
    });
  });

  describe('expire clears only matching printId', () => {
    it('should keep content when expiring a different printId', async () => {
      const content = makeSspContent({ printId: 'print-A' });
      mockClient.requestAd.mockResolvedValueOnce(content);
      mockClient.expireAd.mockResolvedValueOnce(undefined);

      await prefetcher.prefetch(10);
      expect(prefetcher.isReady()).toBe(true);

      await prefetcher.expire('print-B-different');

      expect(mockClient.expireAd).toHaveBeenCalledWith('print-B-different');
      expect(prefetcher.isReady()).toBe(true);
      expect(prefetcher.getContent()).toEqual(content);
    });
  });

  describe('cleanup clears content', () => {
    it('should clear content and make isReady return false', async () => {
      mockClient.requestAd.mockResolvedValueOnce(makeSspContent());

      await prefetcher.prefetch(10);
      expect(prefetcher.isReady()).toBe(true);

      prefetcher.cleanup();

      expect(prefetcher.isReady()).toBe(false);
      expect(prefetcher.getContent()).toBeNull();
    });
  });

  describe('prefetch expires existing content first', () => {
    it('should call expireAd on existing content before requesting new ad', async () => {
      const contentA = makeSspContent({ printId: 'print-A' });
      const contentB = makeSspContent({ printId: 'print-B' });
      mockClient.requestAd.mockResolvedValueOnce(contentA);
      mockClient.expireAd.mockResolvedValueOnce(undefined);
      mockClient.requestAd.mockResolvedValueOnce(contentB);

      // First prefetch
      await prefetcher.prefetch(10);
      expect(prefetcher.getContent()).toEqual(contentA);

      // Second prefetch — should expire A first
      await prefetcher.prefetch(15);

      expect(mockClient.expireAd).toHaveBeenCalledWith('print-A');
      expect(mockClient.requestAd).toHaveBeenCalledTimes(2);
      expect(prefetcher.getContent()).toEqual(contentB);
    });
  });

  describe('prefetch with no existing content does not call expire', () => {
    it('should not call expireAd when there is no prior content', async () => {
      mockClient.requestAd.mockResolvedValueOnce(makeSspContent());

      await prefetcher.prefetch(10);

      expect(mockClient.expireAd).not.toHaveBeenCalled();
    });
  });

  describe('expire delegates to SspRetryQueue when available (Req 7.4)', () => {
    it('should call retryQueue.expire with printId and expireUrl when retryQueue is provided', async () => {
      const mockRetryQueue = createMockRetryQueue();
      const prefetcherWithQueue = new SspPrefetcher(mockClient, mockRetryQueue as unknown as SspRetryQueue);

      const content = makeSspContent({ printId: 'print-rq', expireUrl: 'https://ssp.example.com/expire/print-rq' });
      mockClient.requestAd.mockResolvedValueOnce(content);

      await prefetcherWithQueue.prefetch(10);
      await prefetcherWithQueue.expire('print-rq');

      expect(mockRetryQueue.expire).toHaveBeenCalledWith('print-rq', 'https://ssp.example.com/expire/print-rq');
      expect(mockClient.expireAd).not.toHaveBeenCalled();
    });

    it('should fall back to sspClient.expireAd when retryQueue is not provided', async () => {
      const content = makeSspContent({ printId: 'print-nq' });
      mockClient.requestAd.mockResolvedValueOnce(content);
      mockClient.expireAd.mockResolvedValueOnce(undefined);

      await prefetcher.prefetch(10);
      await prefetcher.expire('print-nq');

      expect(mockClient.expireAd).toHaveBeenCalledWith('print-nq');
    });

    it('should fall back to sspClient.expireAd when printId does not match currentContent (no expireUrl available)', async () => {
      const mockRetryQueue = createMockRetryQueue();
      const prefetcherWithQueue = new SspPrefetcher(mockClient, mockRetryQueue as unknown as SspRetryQueue);

      const content = makeSspContent({ printId: 'print-A' });
      mockClient.requestAd.mockResolvedValueOnce(content);
      mockClient.expireAd.mockResolvedValueOnce(undefined);

      await prefetcherWithQueue.prefetch(10);
      // Expire a different printId — no expireUrl can be obtained from currentContent
      await prefetcherWithQueue.expire('print-B-unknown');

      expect(mockRetryQueue.expire).not.toHaveBeenCalled();
      expect(mockClient.expireAd).toHaveBeenCalledWith('print-B-unknown');
    });

    it('should clear content after expire even when delegating to retryQueue', async () => {
      const mockRetryQueue = createMockRetryQueue();
      const prefetcherWithQueue = new SspPrefetcher(mockClient, mockRetryQueue as unknown as SspRetryQueue);

      const content = makeSspContent({ printId: 'print-clear' });
      mockClient.requestAd.mockResolvedValueOnce(content);

      await prefetcherWithQueue.prefetch(10);
      expect(prefetcherWithQueue.isReady()).toBe(true);

      await prefetcherWithQueue.expire('print-clear');

      expect(prefetcherWithQueue.isReady()).toBe(false);
      expect(prefetcherWithQueue.getContent()).toBeNull();
    });

    it('should not throw even if retryQueue.expire throws', async () => {
      const mockRetryQueue = createMockRetryQueue();
      mockRetryQueue.expire.mockRejectedValueOnce(new Error('Queue error'));
      const prefetcherWithQueue = new SspPrefetcher(mockClient, mockRetryQueue as unknown as SspRetryQueue);

      const content = makeSspContent({ printId: 'print-err' });
      mockClient.requestAd.mockResolvedValueOnce(content);

      await prefetcherWithQueue.prefetch(10);

      // Should not throw
      await expect(prefetcherWithQueue.expire('print-err')).resolves.toBeUndefined();
      // Content should still be cleared
      expect(prefetcherWithQueue.isReady()).toBe(false);
    });
  });

  describe('prefetch uses retryQueue to expire previous content (Req 6.2, 7.4)', () => {
    it('should call retryQueue.expire when re-prefetching with existing content', async () => {
      const mockRetryQueue = createMockRetryQueue();
      const prefetcherWithQueue = new SspPrefetcher(mockClient, mockRetryQueue as unknown as SspRetryQueue);

      const contentA = makeSspContent({ printId: 'print-A', expireUrl: 'https://ssp.example.com/expire/print-A' });
      const contentB = makeSspContent({ printId: 'print-B' });
      mockClient.requestAd.mockResolvedValueOnce(contentA);
      mockClient.requestAd.mockResolvedValueOnce(contentB);

      // First prefetch
      await prefetcherWithQueue.prefetch(10);
      expect(prefetcherWithQueue.getContent()).toEqual(contentA);

      // Second prefetch — should use retryQueue to expire A
      await prefetcherWithQueue.prefetch(15);

      expect(mockRetryQueue.expire).toHaveBeenCalledWith('print-A', 'https://ssp.example.com/expire/print-A');
      expect(mockClient.expireAd).not.toHaveBeenCalled();
      expect(prefetcherWithQueue.getContent()).toEqual(contentB);
    });

    it('should fall back to sspClient.expireAd in prefetch when retryQueue is not provided', async () => {
      const contentA = makeSspContent({ printId: 'print-A' });
      const contentB = makeSspContent({ printId: 'print-B' });
      mockClient.requestAd.mockResolvedValueOnce(contentA);
      mockClient.expireAd.mockResolvedValueOnce(undefined);
      mockClient.requestAd.mockResolvedValueOnce(contentB);

      // First prefetch (no retryQueue)
      await prefetcher.prefetch(10);
      // Second prefetch — should use sspClient.expireAd directly
      await prefetcher.prefetch(15);

      expect(mockClient.expireAd).toHaveBeenCalledWith('print-A');
      expect(prefetcher.getContent()).toEqual(contentB);
    });

    it('should not call retryQueue.expire or sspClient.expireAd when there is no previous content', async () => {
      const mockRetryQueue = createMockRetryQueue();
      const prefetcherWithQueue = new SspPrefetcher(mockClient, mockRetryQueue as unknown as SspRetryQueue);

      mockClient.requestAd.mockResolvedValueOnce(makeSspContent());

      await prefetcherWithQueue.prefetch(10);

      expect(mockRetryQueue.expire).not.toHaveBeenCalled();
      expect(mockClient.expireAd).not.toHaveBeenCalled();
    });

    it('should still proceed with new prefetch even if retryQueue.expire throws', async () => {
      const mockRetryQueue = createMockRetryQueue();
      mockRetryQueue.expire.mockRejectedValueOnce(new Error('Queue error'));
      const prefetcherWithQueue = new SspPrefetcher(mockClient, mockRetryQueue as unknown as SspRetryQueue);

      const contentA = makeSspContent({ printId: 'print-A', expireUrl: 'https://ssp.example.com/expire/print-A' });
      const contentB = makeSspContent({ printId: 'print-B' });
      mockClient.requestAd.mockResolvedValueOnce(contentA);
      mockClient.requestAd.mockResolvedValueOnce(contentB);

      await prefetcherWithQueue.prefetch(10);
      // Second prefetch — retryQueue.expire will throw but prefetch should still work
      await prefetcherWithQueue.prefetch(15);

      expect(mockRetryQueue.expire).toHaveBeenCalledWith('print-A', 'https://ssp.example.com/expire/print-A');
      expect(prefetcherWithQueue.getContent()).toEqual(contentB);
    });

    it('should preserve popUrl and expireUrl in content returned from prefetch', async () => {
      const content = makeSspContent({
        printId: 'print-full',
        popUrl: 'https://ssp.example.com/pop/print-full',
        expireUrl: 'https://ssp.example.com/expire/print-full',
      });
      mockClient.requestAd.mockResolvedValueOnce(content);

      const result = await prefetcher.prefetch(10);

      expect(result).not.toBeNull();
      expect(result!.popUrl).toBe('https://ssp.example.com/pop/print-full');
      expect(result!.expireUrl).toBe('https://ssp.example.com/expire/print-full');
    });
  });

  describe('backward compatibility — SspPrefetcher works without retryQueue', () => {
    it('should construct without retryQueue parameter', () => {
      const client = createMockSspClient();
      const p = new SspPrefetcher(client);
      expect(p).toBeInstanceOf(SspPrefetcher);
    });

    it('should construct with undefined retryQueue', () => {
      const client = createMockSspClient();
      const p = new SspPrefetcher(client, undefined);
      expect(p).toBeInstanceOf(SspPrefetcher);
    });
  });
});
