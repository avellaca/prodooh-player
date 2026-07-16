/**
 * SSP Prefetcher — manages pre-loading of SSP (Prodooh) ad content.
 *
 * The SspPrefetcher is stateful: it holds at most one prefetched SSP content at a time.
 * SSP content is single-use and does not participate in the LRU cache.
 * After playback or expiration, the content is cleared immediately.
 *
 * Slot-based timing: prefetch is triggered at the START of the slot preceding the SSP slot,
 * giving the full slot_duration_seconds for the SSP to respond (instead of the old model
 * which started prefetch 3s before the end of the preceding item).
 *
 * Deduplication: caches by exact asset URL so that repeated prefetch calls for the same
 * SSP creative don't re-download the asset.
 *
 * Validates: Requirements 7.8, 7.10, 11.1, 11.2, 11.3, 11.4
 */

import type { SspRetryQueue } from '../sync/SspRetryQueue';

/** Represents the content returned by an SSP ad request. */
export interface SspContent {
  printId: string;
  assetUrl: string;
  durationSeconds: number;
  mimeType?: string;
  popUrl: string;      // URL para confirmar proof_of_play (GET)
  expireUrl: string;   // URL para notificar expiración (GET/POST)
}

/** Client interface for SSP (ad server) communication. */
export interface SspClient {
  /** Request an ad from the SSP for the given duration. Returns null on no-fill or error. */
  requestAd(durationSeconds: number): Promise<SspContent | null>;
  /** Expire (cancel) a previously fetched ad that was not reproduced. */
  expireAd(printId: string): Promise<void>;
  /** Confirm proof of play for a reproduced ad. GET to the pop_url. */
  proofOfPlay(printId: string): Promise<void>;
}

/**
 * Manages SSP content prefetching with single-use lifecycle and slot-based timing.
 *
 * Slot-based timing model:
 * - Prefetch is called at the START of the slot preceding the SSP slot.
 * - The full slot_duration_seconds is available for the SSP to respond.
 * - This replaces the old "3s before end of previous item" model.
 *
 * Deduplication by exact asset URL:
 * - If a prefetch returns the same asset URL as already cached, the cached version is reused.
 * - This avoids redundant downloads when the SSP returns the same creative.
 *
 * Lifecycle:
 * 1. `prefetch(durationSeconds)` — called at the START of the slot before the SSP slot.
 * 2. `isReady()` / `getContent()` — check availability when the SSP slot's turn arrives.
 * 3. After playback: `cleanup()` — clear the content (single-use, no LRU).
 * 4. If manifest changes before playback: `expire(printId)` — notify SSP and clear.
 */
export class SspPrefetcher {
  private sspClient: SspClient;
  private retryQueue: SspRetryQueue | null;
  private currentContent: SspContent | null = null;

  /**
   * URL-based deduplication cache.
   * Maps exact asset URL → SspContent to avoid re-downloading the same creative.
   */
  private urlCache: Map<string, SspContent> = new Map();

  constructor(sspClient: SspClient, retryQueue?: SspRetryQueue) {
    this.sspClient = sspClient;
    this.retryQueue = retryQueue ?? null;
  }

  /**
   * Triggers SSP ad request. Called at the START of the slot preceding the SSP slot
   * to give the SSP the full slot_duration_seconds to respond.
   *
   * Slot-based timing: in the new LoopEngine model, this is called immediately when
   * the preceding slot begins playback (not 3s before the end). The full slot duration
   * is available for the SSP network request to complete.
   *
   * If there's already content stored from a previous prefetch, it is expired
   * first to avoid counting unplayed ads as delivered.
   *
   * URL deduplication: if the SSP returns the same asset URL as a previous response,
   * the cached content is reused (avoids redundant downloads).
   *
   * @param durationSeconds - The duration of the SSP slot in seconds.
   * @returns The fetched SSP content, or null on no-fill/error.
   */
  async prefetch(durationSeconds: number): Promise<SspContent | null> {
    // If there's already content stored, expire it first
    if (this.currentContent) {
      const { printId, expireUrl } = this.currentContent;
      if (this.retryQueue && expireUrl) {
        // Use retry queue for resilient expiration with retry on transient failure
        try {
          await this.retryQueue.expire(printId, expireUrl);
        } catch {
          // Best-effort expiration via retry queue — proceed regardless
        }
      } else {
        try {
          await this.sspClient.expireAd(printId);
        } catch {
          // Best-effort expiration — proceed regardless
        }
      }
      this.currentContent = null;
    }

    try {
      const content = await this.sspClient.requestAd(durationSeconds);

      if (content) {
        // URL-based deduplication: if same asset URL was previously cached,
        // reuse the new content (with its fresh printId) but note the URL match
        // for downstream consumers that may want to skip re-downloading the media file.
        this.urlCache.set(content.assetUrl, content);
      }

      this.currentContent = content;
      return content;
    } catch {
      this.currentContent = null;
      return null;
    }
  }

  /**
   * Expires a print_id that was prefetched but not yet reproduced.
   * This is called when the manifest changes before the SSP content gets played,
   * so the SSP doesn't count it as delivered.
   *
   * If a SspRetryQueue is available, delegates to it for resilient retry behavior.
   * Otherwise, falls back to the original fire-and-forget via SspClient.expireAd.
   *
   * @param printId - The print_id to expire.
   */
  async expire(printId: string): Promise<void> {
    // Get the expireUrl from currentContent before clearing it
    const expireUrl = this.currentContent?.printId === printId
      ? this.currentContent.expireUrl
      : undefined;

    try {
      if (this.retryQueue && expireUrl) {
        // Delegate to SspRetryQueue for resilient retry behavior
        await this.retryQueue.expire(printId, expireUrl);
      } else {
        // Fallback: fire-and-forget via SspClient directly
        await this.sspClient.expireAd(printId);
      }
    } catch {
      // Best-effort — don't propagate errors regardless of path
    } finally {
      // Always clear stored content after expiration attempt
      if (this.currentContent?.printId === printId) {
        this.currentContent = null;
      }
    }
  }

  /**
   * Cleans up local SSP content immediately after playback or expiration.
   * SSP content is single-use and does not participate in the LRU cache.
   * Note: the URL cache entry is preserved for deduplication of future prefetches.
   */
  cleanup(): void {
    this.currentContent = null;
  }

  /**
   * Checks if a given asset URL is already cached from a previous SSP response.
   * Used for deduplication: if the media file for this URL is already downloaded,
   * it does not need to be fetched again.
   *
   * @param url - The exact asset URL to check.
   * @returns true if the URL has been seen in a previous SSP response.
   */
  isCachedUrl(url: string): boolean {
    return this.urlCache.has(url);
  }

  /**
   * Clears the URL deduplication cache.
   * Called when the loop template changes and cached URLs may no longer be valid.
   */
  clearUrlCache(): void {
    this.urlCache.clear();
  }

  /**
   * Returns true if SSP content has been prefetched and is ready to play.
   */
  isReady(): boolean {
    return this.currentContent !== null;
  }

  /**
   * Returns the currently prefetched SSP content, or null if not available.
   */
  getContent(): SspContent | null {
    return this.currentContent;
  }
}
