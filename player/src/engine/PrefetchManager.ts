/**
 * PrefetchManager — Background content preparation for seamless transitions.
 *
 * While the current slot plays, PrefetchManager fetches content for the next
 * slot in the background. This eliminates perceptible black frames between
 * content transitions by having the next piece ready before it's needed.
 *
 * Content is stored keyed by source type so the loop engine can retrieve
 * the pre-fetched content instantly when it advances to the next slot.
 *
 * Also replenishes the FallbackBuffer after each slot completes to ensure
 * the emergency fallback is always available.
 *
 * Validates: Requirements 6.1, 6.2
 */

import type { ContentSource, PreparedContent, SourceType } from '../sources/types';
import type { FallbackBuffer } from '../sources/FallbackBuffer';

export interface PrefetchManagerOptions {
  sources: Map<SourceType, ContentSource>;
  fallbackBuffer: FallbackBuffer;
  /** Timeout in ms for prefetch operations (default: 5000) */
  prefetchTimeout?: number;
}

export class PrefetchManager {
  private sources: Map<SourceType, ContentSource>;
  private fallbackBuffer: FallbackBuffer;
  private prefetchTimeout: number;

  /** Content ready for use, keyed by source type */
  private readyContent: Map<SourceType, PreparedContent> = new Map();

  /** Track in-flight prefetch operations to avoid duplicates */
  private pendingPrefetches: Map<SourceType, Promise<PreparedContent | null>> = new Map();

  constructor(options: PrefetchManagerOptions) {
    this.sources = options.sources;
    this.fallbackBuffer = options.fallbackBuffer;
    this.prefetchTimeout = options.prefetchTimeout ?? 5000;
  }

  /**
   * Start prefetching content for a given source type.
   * Runs in the background (fire-and-forget). The result is stored
   * and can be retrieved later via getReady().
   *
   * If a prefetch is already in progress for this source, it won't start a new one.
   */
  startPrefetch(sourceType: SourceType): void {
    // Don't duplicate an in-flight prefetch
    if (this.pendingPrefetches.has(sourceType)) {
      return;
    }

    const source = this.sources.get(sourceType);
    if (!source || !source.isAvailable()) {
      return;
    }

    const prefetchPromise = this.executePrefetch(source);
    this.pendingPrefetches.set(sourceType, prefetchPromise);

    prefetchPromise
      .then((content) => {
        if (content) {
          this.readyContent.set(sourceType, content);
        }
      })
      .catch(() => {
        // Prefetch failure is non-fatal — fallback buffer will handle it
      })
      .finally(() => {
        this.pendingPrefetches.delete(sourceType);
      });
  }

  /**
   * Retrieve prefetched content for a given source type.
   * Returns the content and removes it from the ready store (one-shot use).
   * Returns null if no content has been prefetched for this source.
   */
  getReady(sourceType: SourceType): PreparedContent | null {
    const content = this.readyContent.get(sourceType) ?? null;
    if (content) {
      this.readyContent.delete(sourceType);
    }
    return content;
  }

  /**
   * Check if prefetched content is available for a given source type.
   */
  hasReady(sourceType: SourceType): boolean {
    return this.readyContent.has(sourceType);
  }

  /**
   * Called after a slot completes playback.
   * Replenishes the fallback buffer to ensure emergency content is always available.
   * This is fire-and-forget (non-blocking).
   */
  replenishFallback(): void {
    void this.fallbackBuffer.replenish();
  }

  /**
   * Clear all prefetched content. Useful when config changes
   * and cached content may no longer be valid.
   */
  clear(): void {
    this.readyContent.clear();
    // We don't cancel in-flight requests — they'll just be discarded when they complete
    // since readyContent was cleared and pendingPrefetches will clean up on their own.
  }

  /**
   * Update the sources map (e.g. after a config change).
   */
  updateSources(sources: Map<SourceType, ContentSource>): void {
    this.sources = sources;
    // Clear cached content since sources may have changed
    this.clear();
  }

  /**
   * Returns the number of items currently ready.
   */
  getReadyCount(): number {
    return this.readyContent.size;
  }

  /**
   * Returns whether a prefetch operation is currently in progress for a source.
   */
  isPrefetching(sourceType: SourceType): boolean {
    return this.pendingPrefetches.has(sourceType);
  }

  /**
   * Execute the actual prefetch with a timeout to prevent indefinite waiting.
   */
  private async executePrefetch(source: ContentSource): Promise<PreparedContent | null> {
    return new Promise<PreparedContent | null>((resolve) => {
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      }, this.prefetchTimeout);

      source
        .prefetch()
        .then((content) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve(content);
          }
        })
        .catch(() => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve(null);
          }
        });
    });
  }
}
