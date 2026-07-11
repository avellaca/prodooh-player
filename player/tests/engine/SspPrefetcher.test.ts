import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SspPrefetcher, SspClient, SspContent } from '../../src/engine/SspPrefetcher';

/**
 * Unit tests for SspPrefetcher — SSP content prefetch lifecycle.
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4
 */

function makeSspContent(overrides?: Partial<SspContent>): SspContent {
  return {
    printId: 'print-001',
    assetUrl: 'https://ssp.example.com/ad/creative-001.mp4',
    durationSeconds: 10,
    mimeType: 'video/mp4',
    ...overrides,
  };
}

function createMockSspClient(): SspClient & {
  requestAd: ReturnType<typeof vi.fn>;
  expireAd: ReturnType<typeof vi.fn>;
} {
  return {
    requestAd: vi.fn(),
    expireAd: vi.fn(),
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
});
