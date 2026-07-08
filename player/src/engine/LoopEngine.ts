/**
 * LoopEngine — Fixed-slot sequential execution engine.
 *
 * Executes slots in strict sequential order (0, 1, ..., N-1, 0, 1, ...),
 * calling the assigned ContentSource for each slot. On source failure,
 * fills with FallbackBuffer content. Supports dynamic config updates
 * without restart.
 *
 * Validates: Requirements 7.1, 7.3, 7.8, 6.1, 6.2
 */

import type { ContentSource, PreparedContent, SourceType } from '../sources/types';
import type { FallbackBuffer } from '../sources/FallbackBuffer';
import type { LoopConfig } from '../storage/types';

export interface LoopEngineOptions {
  config: LoopConfig;
  sources: Map<SourceType, ContentSource>;
  fallbackBuffer: FallbackBuffer;
  onPlay?: (content: PreparedContent) => void;
}

export class LoopEngine {
  private config: LoopConfig;
  private sources: Map<SourceType, ContentSource>;
  private fallbackBuffer: FallbackBuffer;
  private onPlay?: (content: PreparedContent) => void;

  private currentIndex: number = 0;
  private currentContent: PreparedContent | null = null;
  private running: boolean = false;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private stopResolve: (() => void) | null = null;

  constructor(options: LoopEngineOptions) {
    this.config = options.config;
    this.sources = options.sources;
    this.fallbackBuffer = options.fallbackBuffer;
    this.onPlay = options.onPlay;
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

  /**
   * Executes the next slot in the loop sequence.
   * This method is called recursively via setTimeout to maintain the loop.
   */
  private async executeNextSlot(): Promise<void> {
    if (!this.running) return;

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

    // Try to get content from the assigned source
    if (source && source.isAvailable()) {
      try {
        content = await source.prefetch();
      } catch {
        // Source threw an error — fall through to fallback
        content = null;
      }
    }

    // On failure, use fallback buffer
    if (!content) {
      content = this.fallbackBuffer.getNext();
    }

    if (!this.running) return;

    // Set current content and notify listener
    this.currentContent = content;
    this.onPlay?.(content);

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
}
