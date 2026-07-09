/**
 * Tests for PrefetchManager — background content preparation.
 *
 * Validates: Requirements 6.1, 6.2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PrefetchManager } from '../../src/engine/PrefetchManager';
import type { ContentSource, PreparedContent, SourceType } from '../../src/sources/types';
import type { FallbackBuffer } from '../../src/sources/FallbackBuffer';

/** Helper to create a mock PreparedContent */
function createMockContent(source: SourceType, id?: string): PreparedContent {
  return {
    id: id ?? `${source}-content-${Math.random().toString(36).slice(2)}`,
    type: 'image',
    source,
    mediaUrl: `https://cdn.example.com/${source}/test.jpg`,
    duration: 10,
    metadata: {},
  };
}

/** Helper to create a mock ContentSource */
function createMockSource(
  sourceType: SourceType,
  options?: {
    available?: boolean;
    prefetchResult?: PreparedContent | null;
    prefetchDelay?: number;
    prefetchError?: boolean;
  }
): ContentSource {
  const {
    available = true,
    prefetchResult,
    prefetchDelay = 0,
    prefetchError = false,
  } = options ?? {};

  const defaultContent = prefetchResult !== undefined ? prefetchResult : createMockContent(sourceType);

  return {
    id: sourceType,
    isAvailable: vi.fn().mockReturnValue(available),
    prefetch: vi.fn().mockImplementation(() => {
      if (prefetchError) {
        return prefetchDelay > 0
          ? new Promise((_, reject) => setTimeout(() => reject(new Error('prefetch failed')), prefetchDelay))
          : Promise.reject(new Error('prefetch failed'));
      }
      return prefetchDelay > 0
        ? new Promise((resolve) => setTimeout(() => resolve(defaultContent), prefetchDelay))
        : Promise.resolve(defaultContent);
    }),
    confirmPlay: vi.fn().mockResolvedValue(undefined),
    reportFailure: vi.fn().mockResolvedValue(undefined),
  };
}

/** Helper to create a mock FallbackBuffer */
function createMockFallbackBuffer(): FallbackBuffer {
  return {
    replenish: vi.fn().mockResolvedValue(undefined),
    getNext: vi.fn().mockReturnValue(createMockContent('playlist', 'fallback-item')),
    hasContent: vi.fn().mockReturnValue(true),
    getSize: vi.fn().mockReturnValue(1),
  } as unknown as FallbackBuffer;
}

describe('PrefetchManager', () => {
  let sources: Map<SourceType, ContentSource>;
  let fallbackBuffer: FallbackBuffer;

  beforeEach(() => {
    vi.useFakeTimers();
    sources = new Map();
    fallbackBuffer = createMockFallbackBuffer();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('startPrefetch', () => {
    it('prefetches content for an available source', async () => {
      const prodoohSource = createMockSource('prodooh');
      sources.set('prodooh', prodoohSource);

      const manager = new PrefetchManager({ sources, fallbackBuffer });
      manager.startPrefetch('prodooh');

      // Allow the microtask to complete
      await vi.advanceTimersByTimeAsync(0);

      expect(prodoohSource.prefetch).toHaveBeenCalledTimes(1);
      expect(manager.hasReady('prodooh')).toBe(true);
    });

    it('does not prefetch for an unavailable source', async () => {
      const gamSource = createMockSource('gam', { available: false });
      sources.set('gam', gamSource);

      const manager = new PrefetchManager({ sources, fallbackBuffer });
      manager.startPrefetch('gam');

      await vi.advanceTimersByTimeAsync(0);

      expect(gamSource.prefetch).not.toHaveBeenCalled();
      expect(manager.hasReady('gam')).toBe(false);
    });

    it('does not prefetch for an unknown source', async () => {
      const manager = new PrefetchManager({ sources, fallbackBuffer });
      manager.startPrefetch('prodooh');

      await vi.advanceTimersByTimeAsync(0);

      expect(manager.hasReady('prodooh')).toBe(false);
    });

    it('does not duplicate in-flight prefetches for the same source', async () => {
      const prodoohSource = createMockSource('prodooh', { prefetchDelay: 100 });
      sources.set('prodooh', prodoohSource);

      const manager = new PrefetchManager({ sources, fallbackBuffer });
      manager.startPrefetch('prodooh');
      manager.startPrefetch('prodooh'); // second call should be ignored

      await vi.advanceTimersByTimeAsync(100);

      expect(prodoohSource.prefetch).toHaveBeenCalledTimes(1);
    });

    it('allows new prefetch after previous one completes', async () => {
      const prodoohSource = createMockSource('prodooh', { prefetchDelay: 50 });
      sources.set('prodooh', prodoohSource);

      const manager = new PrefetchManager({ sources, fallbackBuffer });
      manager.startPrefetch('prodooh');

      await vi.advanceTimersByTimeAsync(50);

      // First prefetch completed, consume it
      manager.getReady('prodooh');

      // Now start another — should work
      manager.startPrefetch('prodooh');
      await vi.advanceTimersByTimeAsync(50);

      expect(prodoohSource.prefetch).toHaveBeenCalledTimes(2);
      expect(manager.hasReady('prodooh')).toBe(true);
    });

    it('handles prefetch error gracefully (non-fatal)', async () => {
      const prodoohSource = createMockSource('prodooh', { prefetchError: true });
      sources.set('prodooh', prodoohSource);

      const manager = new PrefetchManager({ sources, fallbackBuffer });
      manager.startPrefetch('prodooh');

      await vi.advanceTimersByTimeAsync(0);

      expect(manager.hasReady('prodooh')).toBe(false);
      // No exception thrown — graceful degradation
    });

    it('handles null result from prefetch', async () => {
      const prodoohSource = createMockSource('prodooh', { prefetchResult: null });
      sources.set('prodooh', prodoohSource);

      const manager = new PrefetchManager({ sources, fallbackBuffer });
      manager.startPrefetch('prodooh');

      await vi.advanceTimersByTimeAsync(0);

      expect(manager.hasReady('prodooh')).toBe(false);
    });

    it('prefetches for multiple sources simultaneously', async () => {
      const prodoohSource = createMockSource('prodooh', { prefetchDelay: 30 });
      const gamSource = createMockSource('gam', { prefetchDelay: 50 });
      sources.set('prodooh', prodoohSource);
      sources.set('gam', gamSource);

      const manager = new PrefetchManager({ sources, fallbackBuffer });
      manager.startPrefetch('prodooh');
      manager.startPrefetch('gam');

      await vi.advanceTimersByTimeAsync(50);

      expect(manager.hasReady('prodooh')).toBe(true);
      expect(manager.hasReady('gam')).toBe(true);
    });

    it('times out if prefetch takes longer than prefetchTimeout', async () => {
      const slowSource = createMockSource('prodooh', { prefetchDelay: 10000 });
      sources.set('prodooh', slowSource);

      const manager = new PrefetchManager({ sources, fallbackBuffer, prefetchTimeout: 3000 });
      manager.startPrefetch('prodooh');

      // Advance past the timeout
      await vi.advanceTimersByTimeAsync(3000);

      // Should not have ready content since it timed out
      expect(manager.hasReady('prodooh')).toBe(false);
    });
  });

  describe('getReady', () => {
    it('returns prefetched content and removes it from store (one-shot)', async () => {
      const expectedContent = createMockContent('prodooh', 'specific-id');
      const prodoohSource = createMockSource('prodooh', { prefetchResult: expectedContent });
      sources.set('prodooh', prodoohSource);

      const manager = new PrefetchManager({ sources, fallbackBuffer });
      manager.startPrefetch('prodooh');
      await vi.advanceTimersByTimeAsync(0);

      const result = manager.getReady('prodooh');
      expect(result).toBe(expectedContent);

      // Second call returns null — content was consumed
      const second = manager.getReady('prodooh');
      expect(second).toBeNull();
    });

    it('returns null when no content prefetched for source', () => {
      const manager = new PrefetchManager({ sources, fallbackBuffer });
      expect(manager.getReady('prodooh')).toBeNull();
    });
  });

  describe('hasReady', () => {
    it('returns false when nothing prefetched', () => {
      const manager = new PrefetchManager({ sources, fallbackBuffer });
      expect(manager.hasReady('prodooh')).toBe(false);
    });

    it('returns true after successful prefetch', async () => {
      const prodoohSource = createMockSource('prodooh');
      sources.set('prodooh', prodoohSource);

      const manager = new PrefetchManager({ sources, fallbackBuffer });
      manager.startPrefetch('prodooh');
      await vi.advanceTimersByTimeAsync(0);

      expect(manager.hasReady('prodooh')).toBe(true);
    });
  });

  describe('replenishFallback', () => {
    it('calls fallbackBuffer.replenish()', () => {
      const manager = new PrefetchManager({ sources, fallbackBuffer });
      manager.replenishFallback();

      expect(fallbackBuffer.replenish).toHaveBeenCalledTimes(1);
    });

    it('is fire-and-forget (does not await)', () => {
      const slowReplenish = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 5000))
      );
      const slowBuffer = {
        ...createMockFallbackBuffer(),
        replenish: slowReplenish,
      } as unknown as FallbackBuffer;

      const manager = new PrefetchManager({ sources, fallbackBuffer: slowBuffer });

      // Should not throw or block
      expect(() => manager.replenishFallback()).not.toThrow();
      expect(slowReplenish).toHaveBeenCalledTimes(1);
    });
  });

  describe('clear', () => {
    it('removes all prefetched content', async () => {
      const prodoohSource = createMockSource('prodooh');
      const gamSource = createMockSource('gam');
      sources.set('prodooh', prodoohSource);
      sources.set('gam', gamSource);

      const manager = new PrefetchManager({ sources, fallbackBuffer });
      manager.startPrefetch('prodooh');
      manager.startPrefetch('gam');
      await vi.advanceTimersByTimeAsync(0);

      expect(manager.getReadyCount()).toBe(2);

      manager.clear();

      expect(manager.getReadyCount()).toBe(0);
      expect(manager.hasReady('prodooh')).toBe(false);
      expect(manager.hasReady('gam')).toBe(false);
    });
  });

  describe('updateSources', () => {
    it('updates sources map and clears prefetched content', async () => {
      const prodoohSource = createMockSource('prodooh');
      sources.set('prodooh', prodoohSource);

      const manager = new PrefetchManager({ sources, fallbackBuffer });
      manager.startPrefetch('prodooh');
      await vi.advanceTimersByTimeAsync(0);

      expect(manager.hasReady('prodooh')).toBe(true);

      // Update with new sources
      const newSources = new Map<SourceType, ContentSource>();
      const newGamSource = createMockSource('gam');
      newSources.set('gam', newGamSource);

      manager.updateSources(newSources);

      // Old content cleared
      expect(manager.hasReady('prodooh')).toBe(false);

      // New source works
      manager.startPrefetch('gam');
      await vi.advanceTimersByTimeAsync(0);
      expect(manager.hasReady('gam')).toBe(true);
    });
  });

  describe('isPrefetching', () => {
    it('returns true while prefetch is in progress', async () => {
      const prodoohSource = createMockSource('prodooh', { prefetchDelay: 100 });
      sources.set('prodooh', prodoohSource);

      const manager = new PrefetchManager({ sources, fallbackBuffer });
      manager.startPrefetch('prodooh');

      expect(manager.isPrefetching('prodooh')).toBe(true);

      await vi.advanceTimersByTimeAsync(100);

      expect(manager.isPrefetching('prodooh')).toBe(false);
    });

    it('returns false when no prefetch in progress', () => {
      const manager = new PrefetchManager({ sources, fallbackBuffer });
      expect(manager.isPrefetching('prodooh')).toBe(false);
    });
  });

  describe('getReadyCount', () => {
    it('returns 0 initially', () => {
      const manager = new PrefetchManager({ sources, fallbackBuffer });
      expect(manager.getReadyCount()).toBe(0);
    });

    it('increases as prefetches complete', async () => {
      const prodoohSource = createMockSource('prodooh');
      const gamSource = createMockSource('gam');
      sources.set('prodooh', prodoohSource);
      sources.set('gam', gamSource);

      const manager = new PrefetchManager({ sources, fallbackBuffer });
      manager.startPrefetch('prodooh');
      manager.startPrefetch('gam');
      await vi.advanceTimersByTimeAsync(0);

      expect(manager.getReadyCount()).toBe(2);
    });

    it('decreases as content is consumed', async () => {
      const prodoohSource = createMockSource('prodooh');
      sources.set('prodooh', prodoohSource);

      const manager = new PrefetchManager({ sources, fallbackBuffer });
      manager.startPrefetch('prodooh');
      await vi.advanceTimersByTimeAsync(0);

      expect(manager.getReadyCount()).toBe(1);
      manager.getReady('prodooh');
      expect(manager.getReadyCount()).toBe(0);
    });
  });

  describe('integration: prefetch then use in loop cycle', () => {
    it('simulates a full slot cycle: prefetch → getReady → replenish', async () => {
      const prodoohContent = createMockContent('prodooh', 'ad-123');
      const gamContent = createMockContent('gam', 'vast-456');

      const prodoohSource = createMockSource('prodooh', { prefetchResult: prodoohContent });
      const gamSource = createMockSource('gam', { prefetchResult: gamContent });
      sources.set('prodooh', prodoohSource);
      sources.set('gam', gamSource);

      const manager = new PrefetchManager({ sources, fallbackBuffer });

      // Simulate: while playing a prodooh slot, prefetch for the next gam slot
      manager.startPrefetch('gam');
      await vi.advanceTimersByTimeAsync(0);

      // The loop engine now needs gam content for the next slot
      const ready = manager.getReady('gam');
      expect(ready).toBe(gamContent);

      // After slot completes, replenish fallback
      manager.replenishFallback();
      expect(fallbackBuffer.replenish).toHaveBeenCalledTimes(1);

      // Start prefetching for the next slot (prodooh)
      manager.startPrefetch('prodooh');
      await vi.advanceTimersByTimeAsync(0);

      const nextReady = manager.getReady('prodooh');
      expect(nextReady).toBe(prodoohContent);
    });
  });
});
