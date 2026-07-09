/**
 * LoopEngine — Fixed-slot sequential execution engine.
 *
 * Executes slots in strict sequential order (0, 1, ..., N-1, 0, 1, ...),
 * calling the assigned ContentSource for each slot. On source failure,
 * fills with FallbackBuffer content. Supports dynamic config updates
 * without restart.
 *
 * Integrates with ScheduleManager for operating hours enforcement and
 * supports prefetching the next slot's content while the current one plays.
 *
 * Validates: Requirements 7.1, 7.3, 7.8, 6.1, 6.2
 */

import type { ContentSource, PreparedContent, SourceType } from '../sources/types';
import type { FallbackBuffer } from '../sources/FallbackBuffer';
import type { LoopConfig } from '../storage/types';
import { PrefetchManager } from './PrefetchManager';

/**
 * Interface for checking operating hours.
 * The full ScheduleManager implementation is in task 17.3 —
 * this interface defines the contract used by LoopEngine.
 */
export interface ScheduleChecker {
  /** Returns true if playback should be active based on current time and schedule rules. */
  isWithinOperatingHours(): boolean;
}

export interface LoopEngineOptions {
  config: LoopConfig;
  sources: Map<SourceType, ContentSource>;
  fallbackBuffer: FallbackBuffer;
  scheduleChecker?: ScheduleChecker;
  onPlay?: (content: PreparedContent) => void;
  onSleep?: () => void;
  onWake?: () => void;
}

export class LoopEngine {
  private config: LoopConfig;
  private sources: Map<SourceType, ContentSource>;
  private fallbackBuffer: FallbackBuffer;
  private scheduleChecker?: ScheduleChecker;
  private onPlay?: (content: PreparedContent) => void;
  private onSleep?: () => void;
  private onWake?: () => void;

  private currentIndex: number = 0;
  private currentContent: PreparedContent | null = null;
  private running: boolean = false;
  private sleeping: boolean = false;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private stopResolve: (() => void) | null = null;
  private prefetchedContent: PreparedContent | null = null;
  private prefetchManager: PrefetchManager;

  constructor(options: LoopEngineOptions) {
    this.config = options.config;
    this.sources = options.sources;
    this.fallbackBuffer = options.fallbackBuffer;
    this.scheduleChecker = options.scheduleChecker;
    this.onPlay = options.onPlay;
    this.onSleep = options.onSleep;
    this.onWake = options.onWake;
    this.prefetchManager = new PrefetchManager({
      sources: this.sources,
      fallbackBuffer: this.fallbackBuffer,
    });
  }

  /**
   * Starts the loop — runs continuously until stop() is called.
   * Resolves when the loop has been stopped.
   */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;

    return new Promise<void>((resolve) => {
      this.stopResolve = resolve;
      void this.executeNextSlot();
    });
  }

  /**
   * Stops the loop gracefully. The current slot finishes but no new slot starts.
   */
  stop(): void {
    this.running = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.stopResolve) {
      this.stopResolve();
      this.stopResolve = null;
    }
  }

  /**
   * Hot-update config without restart.
   * Takes effect on the next iteration (after the current slot finishes).
   * Resets currentIndex to 0 if the new config has fewer slots than currentIndex.
   */
  updateConfig(newConfig: LoopConfig): void {
    this.config = newConfig;
    if (this.currentIndex >= newConfig.slots.length) {
      this.currentIndex = 0;
    }
    // Invalidate prefetched content since config changed
    this.prefetchedContent = null;
    this.prefetchManager.clear();
  }

  /** Returns current slot position in the loop. */
  getCurrentSlotIndex(): number {
    return this.currentIndex;
  }

  /** Returns what's currently playing, or null if nothing yet. */
  getCurrentContent(): PreparedContent | null {
    return this.currentContent;
  }

  /** Returns whether the loop is currently running. */
  isRunning(): boolean {
    return this.running;
  }

  /** Returns whether the engine is in sleep mode (outside operating hours). */
  isSleeping(): boolean {
    return this.sleeping;
  }

  /** Check if the playlist source has real content (not just factory) */
  private hasRealPlaylist(): boolean {
    const playlistSource = this.sources.get('playlist');
    return playlistSource ? playlistSource.isAvailable() : false;
  }

  /**
   * Executes the next slot in the loop sequence.
   * This method is called recursively via setTimeout to maintain the loop.
   */
  private async executeNextSlot(): Promise<void> {
    if (!this.running) return;

    // Check operating hours via ScheduleChecker
    if (this.scheduleChecker && !this.scheduleChecker.isWithinOperatingHours()) {
      if (!this.sleeping) {
        this.sleeping = true;
        this.currentContent = null;
        this.onSleep?.();
      }
      // Poll every 10 seconds until operating hours resume
      this.timerId = setTimeout(() => {
        this.timerId = null;
        void this.executeNextSlot();
      }, 10_000);
      return;
    }

    // Waking up from sleep
    if (this.sleeping) {
      this.sleeping = false;
      this.onWake?.();
    }

    const slots = this.config.slots;
    if (slots.length === 0) {
      // No slots configured — wait a bit and retry
      this.timerId = setTimeout(() => {
        void this.executeNextSlot();
      }, 1000);
      return;
    }

    const slot = slots[this.currentIndex]!;
    const source = this.sources.get(slot.source);

    let content: PreparedContent | null = null;

    // Use prefetched content if available for this slot's source (via PrefetchManager)
    content = this.prefetchManager.getReady(slot.source);

    // If no prefetched content, check legacy inline prefetch
    if (!content && this.prefetchedContent && this.prefetchedContent.source === slot.source) {
      content = this.prefetchedContent;
      this.prefetchedContent = null;
    }

    // Try to get content from the assigned source
    if (!content && source && source.isAvailable()) {
      try {
        content = await source.prefetch();
      } catch {
        // Source threw an error — fall through to fallback
        content = null;
      }
    }

    // On failure, use fallback buffer
    if (!content) {
      // If the failed source is not playlist and playlist has content,
      // get content directly from playlist source to fill this slot
      if (slot.source !== 'playlist') {
        const playlistSource = this.sources.get('playlist');
        if (playlistSource && playlistSource.isAvailable()) {
          try {
            content = await playlistSource.prefetch();
          } catch {
            content = null;
          }
        }
      }

      // Last resort: factory fallback
      if (!content) {
        content = this.fallbackBuffer.getNext();
      }
    }

    if (!this.running) return;

    // Set current content and notify listener
    this.currentContent = content;
    this.onPlay?.(content);

    // Kick off prefetch for the NEXT slot while current one plays (Req 6.1)
    this.prefetchNextSlot();

    // Wait for slot duration
    const durationMs = content.duration * 1000;

    await new Promise<void>((resolve) => {
      this.timerId = setTimeout(() => {
        this.timerId = null;
        resolve();
      }, durationMs);
    });

    if (!this.running) return;

    // Confirm play if content came from a real source (not fallback/playlist)
    if (source && content.source !== 'playlist') {
      try {
        await source.confirmPlay(content);
      } catch {
        // confirmPlay failure is non-fatal
      }
    }

    // Advance index (wrap around)
    this.currentIndex = (this.currentIndex + 1) % this.config.slots.length;

    // Continue to next slot
    void this.executeNextSlot();
  }

  /**
   * Prefetch content for the next slot in sequence (Req 6.1).
   * Runs in the background while the current slot is playing.
   *
   * NOTE: Playlist source is excluded from prefetch because it has a stateful
   * internal index — calling prefetch() advances the index, which would cause
   * items to be skipped during normal playback.
   */
  private prefetchNextSlot(): void {
    const slots = this.config.slots;
    if (slots.length === 0) return;

    const nextIndex = (this.currentIndex + 1) % slots.length;
    const nextSlot = slots[nextIndex]!;
    const nextSource = this.sources.get(nextSlot.source);

    // Skip prefetch for playlist source (stateful index)
    if (nextSlot.source === 'playlist') {
      return;
    }

    // Use PrefetchManager for structured prefetch (non-playlist sources)
    this.prefetchManager.startPrefetch(nextSlot.source);

    // Also use legacy inline prefetch for backward compatibility
    if (nextSource && nextSource.isAvailable()) {
      nextSource.prefetch().then(
        (content) => {
          if (content && this.running) {
            this.prefetchedContent = content;
          }
        },
        () => {
          this.prefetchedContent = null;
        }
      );
    }
  }
}
