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
 * - Supports preview_content: plays one-off item after current finishes, no impression
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 21.4, 21.5
 */

import type { Manifest, ManifestItem } from '../sync/ManifestSyncManager';
import type { SspPrefetcher } from './SspPrefetcher';
import type { PreviewItem } from '../services/PreviewContentHandler';

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
  private pendingPreview: PreviewItem | null = null;

  private onItemStart?: (item: ManifestItem) => void;
  private onItemComplete?: (item: ManifestItem, result: PlaybackResult, failureReason?: string) => void;

  /** Public setter for wiring onItemStart after construction (e.g., from main.ts) */
  set onItemStartCallback(fn: ((item: ManifestItem) => void) | undefined) {
    this.onItemStart = fn;
  }
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
   * If a preview is queued, plays it after the current item finishes, then resumes.
   */
  async run(): Promise<void> {
    this.running = true;
    this.currentIndex = 0;

    // Skip leading SSP items on startup — find first non-SSP item
    const items = this.manifest.items;
    if (items && items.length > 0) {
      while (this.currentIndex < items.length && items[this.currentIndex]?.type === 'prodooh_ssp_call') {
        this.currentIndex++;
      }
      if (this.currentIndex >= items.length) {
        this.currentIndex = 0; // All items are SSP — just start from 0
      }
    }

    while (this.running) {
      // Check for pending preview (plays between items, no impression)
      if (this.pendingPreview) {
        const preview = this.pendingPreview;
        this.pendingPreview = null;
        await this.playPreviewItem(preview);
        // Resume manifest from same position (don't advance)
        continue;
      }

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
   * Queue a preview item for one-time playback.
   * The preview will be played after the current item finishes, before
   * the next manifest item. No impression is registered.
   * Resumes the manifest from the same position afterward.
   *
   * Validates: Requirements 21.4, 21.5
   */
  queuePreview(preview: PreviewItem): void {
    this.pendingPreview = preview;
  }

  /**
   * Returns whether there is a pending preview queued.
   */
  hasPendingPreview(): boolean {
    return this.pendingPreview !== null;
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
        // Notify renderer of the actual SSP asset to display
        this.onItemStart?.(sspItem);
        const result = await this.playbackFn(sspItem);
        // Emit onItemComplete for SSP items so proof-of-play can be triggered
        this.onItemComplete?.(item, result);
        this.sspPrefetcher.cleanup();
        return;
      }
    }

    // Fallback: use the first playlist_item from the manifest
    const fallback = this.findFallbackPlaylistItem();
    if (fallback) {
      this.onItemStart?.(fallback);
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
      // Delay SSP prefetch to ~3s before the slot starts
      // Current item plays for duration_seconds; prefetch 3s before it ends
      const currentDuration = items[currentIdx]!.duration_seconds;
      const delayMs = Math.max(0, (currentDuration - 3)) * 1000;
      setTimeout(() => {
        void this.sspPrefetcher!.prefetch(nextItem.duration_seconds);
      }, delayMs);
    }
  }

  /**
   * Default playback: simply waits for the item's duration.
   * Actual media rendering is handled externally via the playbackFn callback.
   */
  private async defaultPlayback(_item: ManifestItem): Promise<PlaybackResult> {
    await delay(_item.duration_seconds * 1000);
    return 'success';
  }

  /**
   * Plays a preview item ONE time without emitting any impression.
   * Uses the playbackFn with a synthetic ManifestItem.
   * Does NOT call onItemComplete (no impression recorded).
   *
   * Validates: Requirements 21.4, 21.5
   */
  private async playPreviewItem(preview: PreviewItem): Promise<void> {
    const syntheticItem: ManifestItem = {
      position: -1, // Sentinel value: not part of manifest
      type: 'playlist_item', // Use playlist_item type (no impression)
      duration_seconds: preview.duration_seconds,
      asset_url: preview.local_url,
    };

    this.currentItem = syntheticItem;

    // Emit onItemStart so the renderer knows to display this content
    this.onItemStart?.(syntheticItem);

    // Play the preview (no onItemComplete = no impression)
    await this.playbackFn(syntheticItem);

    // Reset currentItem — the loop will pick up the next manifest item
    this.currentItem = null;
  }
}
