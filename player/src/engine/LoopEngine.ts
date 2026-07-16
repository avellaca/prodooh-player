/**
 * LoopEngine — Reproduces a Loop Template in a continuous cycle.
 *
 * Replaces the flat manifest model. Instead of a linear sequence of 5,760 items,
 * the LoopEngine receives N slots (typically 10) with candidates per slot and
 * rotates candidates locally using round-robin between iterations.
 *
 * Key behaviors:
 * - Continuous loop: slot[0] → slot[N-1] → slot[0]...
 * - Round-robin candidate selection per slot across loop iterations
 * - Atomic template swap via updateTemplate() — applies at start of next loop iteration
 * - SSP slot handling: delegates to SspPrefetcher; falls back to first playlist_item on no-fill
 * - Prefetches SSP content at the start of the slot preceding an SSP slot
 *
 * Validates: Requirements 7.8, 7.9, 7.10, 7.11, 7.12
 */

import type { SspPrefetcher } from './SspPrefetcher';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface LoopSlot {
  position: number;
  type: 'ad' | 'ssp' | 'playlist';
  strategy: 'fixed' | 'round_robin';
  candidates: SlotCandidate[];
  /** Only for SSP slots */
  provider?: string;
  config?: SspConfig;
}

export interface SlotCandidate {
  order_line_id?: string;
  creative_id?: string;
  playlist_item_id?: string;
  asset_url: string;
  checksum_sha256: string;
  frequency?: string; // e.g., "1/2", "1/3"
}

export interface SspConfig {
  api_key: string;
  network_id: string;
  venue_id: string;
}

export interface LoopTemplate {
  version: string;
  generated_at: string;
  loop_config: {
    num_slots: number;
    slot_duration_seconds: number;
    loop_duration_seconds: number;
    loops_per_day: number;
  };
  slots: LoopSlot[];
  sync_interval_seconds: number;
  cache_flush_interval_hours: number;
}

export interface LoopEngineOptions {
  template: LoopTemplate;
  onSlotStart?: (slot: LoopSlot, candidate: SlotCandidate, iteration: number) => void;
  onSlotComplete?: (slot: LoopSlot, candidate: SlotCandidate, result: 'success' | 'failed') => void;
  sspPrefetcher?: SspPrefetcher;
  playbackFn?: (candidate: SlotCandidate, durationMs: number) => Promise<'success' | 'failed'>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── LoopEngine ──────────────────────────────────────────────────────────────

export class LoopEngine {
  private template: LoopTemplate;
  private iteration: number = 0;
  private currentSlotIndex: number = 0;
  private running: boolean = false;
  private pendingTemplate: LoopTemplate | null = null;
  /** Tracks round-robin offset per slot position */
  private rotationOffsets: Map<number, number> = new Map();

  private onSlotStart?: (slot: LoopSlot, candidate: SlotCandidate, iteration: number) => void;
  private onSlotComplete?: (slot: LoopSlot, candidate: SlotCandidate, result: 'success' | 'failed') => void;
  private sspPrefetcher?: SspPrefetcher;
  private playbackFn: (candidate: SlotCandidate, durationMs: number) => Promise<'success' | 'failed'>;

  /** Public setter for wiring onSlotStart after construction (e.g., from main.ts) */
  set onSlotStartCallback(fn: ((slot: LoopSlot, candidate: SlotCandidate, iteration: number) => void) | undefined) {
    this.onSlotStart = fn;
  }

  /** Public setter for wiring onSlotComplete after construction */
  set onSlotCompleteCallback(fn: ((slot: LoopSlot, candidate: SlotCandidate, result: 'success' | 'failed') => void) | undefined) {
    this.onSlotComplete = fn;
  }

  constructor(options: LoopEngineOptions) {
    this.template = options.template;
    this.onSlotStart = options.onSlotStart;
    this.onSlotComplete = options.onSlotComplete;
    this.sspPrefetcher = options.sspPrefetcher;
    this.playbackFn = options.playbackFn ?? this.defaultPlayback.bind(this);
  }

  /**
   * Starts the continuous loop. Runs indefinitely until stop() is called.
   * Plays slots in strict sequential order (0, 1, ..., N-1, 0, 1, ...).
   * At the start of each full loop iteration, checks for pending template swap.
   */
  async run(): Promise<void> {
    this.running = true;
    this.currentSlotIndex = 0;
    this.iteration = 0;

    while (this.running) {
      // At the start of each loop iteration, check for pending template swap
      if (this.currentSlotIndex === 0) {
        if (this.pendingTemplate) {
          this.template = this.pendingTemplate;
          this.pendingTemplate = null;
          // Reset rotation offsets for new template
          this.rotationOffsets.clear();
        }
      }

      const slots = this.template.slots;

      // If template has no slots, sleep and retry
      if (!slots || slots.length === 0) {
        await delay(1000);
        continue;
      }

      // Ensure index is within bounds (safety after template swap)
      if (this.currentSlotIndex >= slots.length) {
        this.currentSlotIndex = 0;
      }

      const slot = slots[this.currentSlotIndex]!;
      const durationMs = this.template.loop_config.slot_duration_seconds * 1000;

      // Skip slots with no candidates (empty ad slots)
      if (slot.type === 'ad' && slot.candidates.length === 0) {
        this.currentSlotIndex++;
        if (this.currentSlotIndex >= slots.length) {
          this.currentSlotIndex = 0;
          this.iteration++;
        }
        continue;
      }

      // Trigger SSP prefetch if the NEXT slot is an SSP slot
      this.triggerSspPrefetchIfNeeded(slots, this.currentSlotIndex);

      // Play the current slot
      await this.playSlot(slot, durationMs);

      // Advance to next slot position
      this.currentSlotIndex++;

      // If we've completed all slots, we've finished one loop iteration
      if (this.currentSlotIndex >= slots.length) {
        this.currentSlotIndex = 0;
        this.iteration++;
      }
    }
  }

  /**
   * Stops the engine loop after the current slot finishes.
   */
  stop(): void {
    this.running = false;
  }

  /**
   * Atomic template swap. The new template will be adopted at the start
   * of the next loop iteration (when currentSlotIndex wraps to 0).
   */
  updateTemplate(newTemplate: LoopTemplate): void {
    this.pendingTemplate = newTemplate;
  }

  /**
   * Returns the current loop iteration count.
   */
  getIteration(): number {
    return this.iteration;
  }

  /**
   * Returns the current slot index within the loop.
   */
  getCurrentSlotIndex(): number {
    return this.currentSlotIndex;
  }

  /**
   * Returns whether the engine is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Selects the candidate for a slot based on its strategy and current rotation state.
   *
   * - strategy 'fixed': always returns candidates[0]
   * - strategy 'round_robin': uses (rotation_offset mod N) where N = candidates.length
   *   The rotation offset for each slot position is incremented after each selection.
   */
  selectCandidate(slot: LoopSlot): SlotCandidate {
    if (slot.candidates.length === 0) {
      // Should not happen for well-formed templates, but safeguard
      return { asset_url: '', checksum_sha256: '' };
    }

    if (slot.strategy === 'fixed') {
      return slot.candidates[0]!;
    }

    // round_robin: use rotation offset for this slot position
    const position = slot.position;
    const offset = this.rotationOffsets.get(position) ?? 0;
    const candidateIndex = offset % slot.candidates.length;
    const candidate = slot.candidates[candidateIndex]!;

    // Increment offset for next time this slot is visited
    this.rotationOffsets.set(position, offset + 1);

    return candidate;
  }

  /**
   * Plays a single slot based on its type.
   */
  private async playSlot(slot: LoopSlot, durationMs: number): Promise<void> {
    switch (slot.type) {
      case 'ad':
      case 'playlist':
        await this.playContentSlot(slot, durationMs);
        break;
      case 'ssp':
        await this.playSspSlot(slot, durationMs);
        break;
    }
  }

  /**
   * Plays an ad or playlist slot by selecting the appropriate candidate
   * and invoking the playback function.
   */
  private async playContentSlot(slot: LoopSlot, durationMs: number): Promise<void> {
    const candidate = this.selectCandidate(slot);

    this.onSlotStart?.(slot, candidate, this.iteration);

    const result = await this.playbackFn(candidate, durationMs);

    this.onSlotComplete?.(slot, candidate, result);
  }

  /**
   * Handles SSP slot playback:
   * 1. If SspPrefetcher has content ready, play it
   * 2. Otherwise, fall back to the first playlist_item in the template
   * 3. If no fallback available, wait for the slot duration
   */
  private async playSspSlot(slot: LoopSlot, durationMs: number): Promise<void> {
    if (this.sspPrefetcher?.isReady()) {
      const sspContent = this.sspPrefetcher.getContent();
      if (sspContent) {
        // Create a synthetic candidate from the SSP content
        const sspCandidate: SlotCandidate = {
          asset_url: sspContent.assetUrl,
          checksum_sha256: '',
        };

        this.onSlotStart?.(slot, sspCandidate, this.iteration);

        const result = await this.playbackFn(sspCandidate, durationMs);

        this.onSlotComplete?.(slot, sspCandidate, result);
        this.sspPrefetcher.cleanup();
        return;
      }
    }

    // Fallback: use the first playlist_item from the template
    const fallback = this.findFallbackPlaylistCandidate();
    if (fallback) {
      const fallbackCandidate = fallback.candidate;
      this.onSlotStart?.(slot, fallbackCandidate, this.iteration);

      const result = await this.playbackFn(fallbackCandidate, durationMs);

      this.onSlotComplete?.(slot, fallbackCandidate, result);
    } else {
      // No fallback available — wait for duration
      await delay(durationMs);
    }
  }

  /**
   * Finds the first playlist slot's first candidate in the template to use as SSP fallback.
   * Returns the slot and candidate, or null if no playlist slots exist.
   *
   * Validates: Requirement 7.9 — fallback to first playlist_item on no-fill
   */
  private findFallbackPlaylistCandidate(): { slot: LoopSlot; candidate: SlotCandidate } | null {
    for (const slot of this.template.slots) {
      if (slot.type === 'playlist' && slot.candidates.length > 0) {
        return { slot, candidate: slot.candidates[0]! };
      }
    }
    return null;
  }

  /**
   * Triggers SSP prefetch if the NEXT slot in sequence is an SSP slot.
   * This gives the full current slot duration for the SSP to respond.
   *
   * Validates: Requirement 7.8 — pre-load SSP content before SSP slot starts
   */
  private triggerSspPrefetchIfNeeded(slots: LoopSlot[], currentIdx: number): void {
    if (!this.sspPrefetcher || slots.length <= 1) return;

    const nextIdx = (currentIdx + 1) % slots.length;
    const nextSlot = slots[nextIdx];
    if (!nextSlot) return;

    if (nextSlot.type === 'ssp') {
      const slotDuration = this.template.loop_config.slot_duration_seconds;
      void this.sspPrefetcher.prefetch(slotDuration);
    }
  }

  /**
   * Default playback: waits for the slot duration.
   * Actual media rendering is handled externally via the playbackFn callback.
   */
  private async defaultPlayback(_candidate: SlotCandidate, durationMs: number): Promise<'success' | 'failed'> {
    await delay(durationMs);
    return 'success';
  }
}
