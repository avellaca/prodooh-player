/**
 * ManifestEngine — Executes a pre-resolved manifest sequence in a continuous loop.
 *
 * Replaces LoopEngine. The engine:
 * - Loops items position 0..N-1, wrapping back to 0 indefinitely
 * - For order_line_creative: plays asset and emits impression via onItemComplete
 * - For playlist_item: plays asset without emitting impression
 * - For prodooh_ssp_call: uses SspPrefetcher; falls back to playlist if not ready
 * - Prefetches the NEXT item during playback of the current
 * - Supports atomic manifest swap via updateManifest()
 * - Continues playing last valid manifest if connectivity is lost
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7
 */

import type { Manifest, ManifestItem } from '../sync/ManifestSyncManager';
import type { SspPrefetcher } from './SspPrefetcher';

export type PlaybackResult = 'success' | 'failed';

export interface ManifestEngineOptions {
  manifest: Manifest;
  onItemStart?: (item: ManifestItem) => void;
  onItemComplete?: (item: ManifestItem, result: PlaybackResult, failureReason?: string) => void;
  sspPrefetcher?: SspPrefetcher;
  /** Custom playback function. Defaults to waiting duration_seconds. */
  playbackFn?: (item: ManifestItem) => Promise<PlaybackResult>;
}

/**
 * Creates a delay promise that can be used for simulating playback.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ManifestEngine {
  private manifest: Manifest;
  private currentIndex: number = 0;
  private currentItem: ManifestItem | null = null;
  private running: boolean = false;
  private pendingManifest: Manifest | null = null;

  private onItemStart?: (item: ManifestItem) => void;
  private onItemComplete?: (item: ManifestItem, result: PlaybackResult, failureReason?: string) => void;
  private sspPrefetcher?: SspPrefetcher;
  private playbackFn: (item: ManifestItem) => Promise<PlaybackResult>;

  constructor(options: ManifestEngineOptions) {
    this.manifest = options.manifest;
    this.onItemStart = options.onItemStart;
    this.onItemComplete = options.onItemComplete;
    this.sspPrefetcher = options.sspPrefetcher;
    this.playbackFn = options.playbackFn ?? this.defaultPlayback.bind(this);
  }

  /**
   * Main execution loop. Runs indefinitely until stop() is called.
   * Plays items in strict sequential order (0, 1, ..., N-1, 0, 1, ...).
   */
  async run(): Promise<void> {
    this.running = true;
    this.currentIndex = 0;

    while (this.running) {
      // Check for pending manifest swap (atomic update)
      if (this.pendingManifest) {
        this.manifest = this.pendingManifest;
        this.pendingManifest = null;
        this.currentIndex = 0;
      }

      const items = this.manifest.items;

      // If manifest is empty, sleep and retry
      if (!items || items.length === 0) {
        this.currentItem = null;
        await delay(1000);
        continue;
      }

      // Ensure index is within bounds (safety after manifest swap)
      if (this.currentIndex >= items.length) {
        this.currentIndex = 0;
      }

      const item = items[this.currentIndex]!;
      this.currentItem = item;

      // Emit onItemStart event
      this.onItemStart?.(item);

      // Prefetch the NEXT item while playing the current one
      this.prefetchNext(items, this.currentIndex);

      // Play the current item based on its type
      await this.playItem(item);

      // Advance to next position (wrap around)
      this.currentIndex = (this.currentIndex + 1) % items.length;
    }

    this.currentItem = null;
  }

  /**
   * Stops the engine loop after the current item finishes.
   */
  stop(): void {
    this.running = false;
  }

  /**
   * Atomic swap of the active manifest. The new manifest will be adopted
   * at the start of the next iteration (after the current item finishes).
   * Index resets to 0 on the new manifest.
   */
  updateManifest(newManifest: Manifest): void {
    this.pendingManifest = newManifest;
  }

  /**
   * Returns the item currently being played, or null if not running.
   */
  getCurrentItem(): ManifestItem | null {
    return this.currentItem;
  }

  /**
   * Returns the current playback index in the manifest sequence.
   */
  getCurrentIndex(): number {
    return this.currentIndex;
  }

  /**
   * Returns whether the engine is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Plays a single manifest item based on its type.
   */
  private async playItem(item: ManifestItem): Promise<void> {
    switch (item.type) {
      case 'order_line_creative':
        await this.playOrderLineCreative(item);
        break;
      case 'playlist_item':
        await this.playPlaylistItem(item);
        break;
      case 'prodooh_ssp_call':
        await this.playSspCall(item);
        break;
    }
  }

  /**
   * Plays an order_line_creative item and emits an impression on completion.
   */
  private async playOrderLineCreative(item: ManifestItem): Promise<void> {
    const result = await this.playbackFn(item);
    // Emit impression event on completion (success or failed)
    this.onItemComplete?.(item, result);
  }

  /**
   * Plays a playlist_item without emitting an impression.
   */
  private async playPlaylistItem(item: ManifestItem): Promise<void> {
    await this.playbackFn(item);
    // No impression emitted for playlist items
  }

  /**
   * Handles SSP call: if prefetched content is ready, play it.
   * Otherwise, fall back to the first available playlist item in the manifest.
   */
  private async playSspCall(item: ManifestItem): Promise<void> {
    if (this.sspPrefetcher?.isReady()) {
      const sspContent = this.sspPrefetcher.getContent();
      if (sspContent) {
        // Play the SSP content using a synthetic ManifestItem
        const sspItem: ManifestItem = {
          position: item.position,
          type: 'prodooh_ssp_call',
          duration_seconds: sspContent.durationSeconds,
          asset_url: sspContent.assetUrl,
        };
        await this.playbackFn(sspItem);
        this.sspPrefetcher.cleanup();
        return;
      }
    }

    // Fallback: use the first playlist_item from the manifest
    const fallback = this.findFallbackPlaylistItem();
    if (fallback) {
      await this.playbackFn(fallback);
    } else {
      // No fallback available — wait for duration and move on
      await delay(item.duration_seconds * 1000);
    }
  }

  /**
   * Finds the first playlist_item in the manifest to use as SSP fallback.
   */
  private findFallbackPlaylistItem(): ManifestItem | null {
    return this.manifest.items.find((i) => i.type === 'playlist_item') ?? null;
  }

  /**
   * Prefetches the next item in the sequence.
   * If the next item is a prodooh_ssp_call, triggers SSP prefetch.
   */
  private prefetchNext(items: ManifestItem[], currentIdx: number): void {
    if (items.length <= 1) return;

    const nextIdx = (currentIdx + 1) % items.length;
    const nextItem = items[nextIdx];
    if (!nextItem) return;

    if (nextItem.type === 'prodooh_ssp_call' && this.sspPrefetcher) {
      // Fire and forget — prefetch runs during current item playback
      void this.sspPrefetcher.prefetch(nextItem.duration_seconds);
    }
    // For other types (order_line_creative, playlist_item), asset download
    // is handled by ManifestSyncManager when the manifest is first received.
    // No additional prefetch logic needed here.
  }

  /**
   * Default playback: simply waits for the item's duration.
   * Actual media rendering is handled externally via the playbackFn callback.
   */
  private async defaultPlayback(_item: ManifestItem): Promise<PlaybackResult> {
    await delay(_item.duration_seconds * 1000);
    return 'success';
  }
}
