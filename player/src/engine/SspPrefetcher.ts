/**
 * SSP Prefetcher — manages pre-loading of SSP (Prodooh) ad content.
 *
 * The SspPrefetcher is stateful: it holds at most one prefetched SSP content at a time.
 * SSP content is single-use and does not participate in the LRU cache.
 * After playback or expiration, the content is cleared immediately.
 *
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4
 */

/** Represents the content returned by an SSP ad request. */
export interface SspContent {
  printId: string;
  assetUrl: string;
  durationSeconds: number;
  mimeType?: string;
}

/** Client interface for SSP (ad server) communication. */
export interface SspClient {
  /** Request an ad from the SSP for the given duration. Returns null on no-fill or error. */
  requestAd(durationSeconds: number): Promise<SspContent | null>;
  /** Expire (cancel) a previously fetched ad that was not reproduced. */
  expireAd(printId: string): Promise<void>;
}

/**
 * Manages SSP content prefetching with single-use lifecycle.
 *
 * Lifecycle:
 * 1. `prefetch(durationSeconds)` — called when entering the item BEFORE the SSP slot.
 * 2. `isReady()` / `getContent()` — check availability when the SSP slot's turn arrives.
 * 3. After playback: `cleanup()` — clear the content (single-use, no LRU).
 * 4. If manifest changes before playback: `expire(printId)` — notify SSP and clear.
 */
export class SspPrefetcher {
  private sspClient: SspClient;
  private currentContent: SspContent | null = null;

  constructor(sspClient: SspClient) {
    this.sspClient = sspClient;
  }

  /**
   * Triggers SSP ad request. Called when entering the item BEFORE the SSP slot
   * to give the SSP enough lead time to respond.
   *
   * If there's already content stored from a previous prefetch, it is expired
   * first to avoid counting unplayed ads as delivered.
   *
   * @param durationSeconds - The duration of the SSP slot in seconds.
   * @returns The fetched SSP content, or null on no-fill/error.
   */
  async prefetch(durationSeconds: number): Promise<SspContent | null> {
    // If there's already content stored, expire it first
    if (this.currentContent) {
      try {
        await this.sspClient.expireAd(this.currentContent.printId);
      } catch {
        // Best-effort expiration — proceed regardless
      }
      this.currentContent = null;
    }

    try {
      const content = await this.sspClient.requestAd(durationSeconds);
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
   * @param printId - The print_id to expire.
   */
  async expire(printId: string): Promise<void> {
    try {
      await this.sspClient.expireAd(printId);
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
   */
  cleanup(): void {
    this.currentContent = null;
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
