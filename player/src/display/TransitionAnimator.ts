/**
 * TransitionAnimator — CSS-based transitions between content layers.
 *
 * Handles animated transitions (cut, fade, slide) between the outgoing
 * and incoming content elements. Uses CSS transitions for GPU-accelerated
 * performance on Raspberry Pi 5.
 *
 * Key design decisions:
 * - New content is always placed behind the current content and made fully
 *   visible BEFORE the transition starts. This guarantees no black frames.
 * - The transition animates the OLD content out (opacity → 0 or translateX away),
 *   revealing the already-visible new content underneath.
 * - For "cut" transition, old content is removed instantly (no animation).
 *
 * Validates: Requirements 23.1, 23.2, 23.3, 23.4, 23.5
 */

/** Supported transition types */
export type TransitionType = 'cut' | 'fade' | 'slide';

/** Configuration for the TransitionAnimator */
export interface TransitionConfig {
  /** Type of transition animation */
  type: TransitionType;
  /** Duration in milliseconds (200-2000, default 500) */
  durationMs: number;
}

/** Default transition configuration */
export const DEFAULT_TRANSITION_CONFIG: TransitionConfig = {
  type: 'fade',
  durationMs: 500,
};

/** Minimum allowed transition duration in milliseconds */
export const MIN_DURATION_MS = 200;

/** Maximum allowed transition duration in milliseconds */
export const MAX_DURATION_MS = 2000;

/**
 * Validates and clamps a transition configuration to allowed ranges.
 * Returns a valid TransitionConfig with duration clamped to [200, 2000].
 */
export function validateTransitionConfig(config: Partial<TransitionConfig>): TransitionConfig {
  const type: TransitionType =
    config.type && isValidTransitionType(config.type) ? config.type : DEFAULT_TRANSITION_CONFIG.type;

  const durationMs = clampDuration(config.durationMs ?? DEFAULT_TRANSITION_CONFIG.durationMs);

  return { type, durationMs };
}

/**
 * Checks if a string is a valid TransitionType.
 */
export function isValidTransitionType(value: string): value is TransitionType {
  return value === 'cut' || value === 'fade' || value === 'slide';
}

/**
 * Clamps a duration value to the allowed range [MIN_DURATION_MS, MAX_DURATION_MS].
 */
export function clampDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs < MIN_DURATION_MS) {
    return MIN_DURATION_MS;
  }
  if (durationMs > MAX_DURATION_MS) {
    return MAX_DURATION_MS;
  }
  return Math.round(durationMs);
}

/**
 * TransitionAnimator performs CSS-based transitions between two DOM elements.
 *
 * Usage:
 * 1. Create an instance with a container element and config.
 * 2. Call `transition(outgoing, incoming)` to animate the swap.
 * 3. The returned Promise resolves when the transition completes.
 *
 * The container should use `position: relative` with children absolutely positioned
 * and stacked via z-index. The animator manages z-index and CSS transition properties.
 */
export class TransitionAnimator {
  private config: TransitionConfig;
  private isTransitioning: boolean = false;

  constructor(config?: Partial<TransitionConfig>) {
    this.config = validateTransitionConfig(config ?? {});
  }

  /** Get the current transition configuration */
  getConfig(): TransitionConfig {
    return { ...this.config };
  }

  /** Update the transition configuration */
  setConfig(config: Partial<TransitionConfig>): void {
    this.config = validateTransitionConfig(config);
  }

  /** Returns true if a transition is currently in progress */
  isInProgress(): boolean {
    return this.isTransitioning;
  }

  /**
   * Performs a transition from the outgoing element to the incoming element.
   *
   * Strategy to prevent black frames (Req 23.3):
   * - The incoming element is placed BELOW the outgoing element (lower z-index)
   *   and made fully visible BEFORE any animation begins.
   * - The outgoing element is then animated away (fade out or slide out),
   *   revealing the already-visible incoming content.
   * - For "cut": outgoing is immediately removed, incoming is already visible.
   *
   * @param outgoing - The currently visible element (will be animated out)
   * @param incoming - The new element to show (will be placed and revealed)
   * @param container - The container element holding both layers
   * @returns Promise that resolves when the transition completes
   */
  async transition(
    outgoing: HTMLElement | null,
    incoming: HTMLElement,
    container: HTMLElement
  ): Promise<void> {
    if (this.isTransitioning) {
      // If a transition is already in progress, do an instant cut
      this.applyCut(outgoing, incoming, container);
      return;
    }

    this.isTransitioning = true;

    try {
      switch (this.config.type) {
        case 'cut':
          this.applyCut(outgoing, incoming, container);
          break;
        case 'fade':
          await this.applyFade(outgoing, incoming, container);
          break;
        case 'slide':
          await this.applySlide(outgoing, incoming, container);
          break;
        default:
          // Fallback to cut for any unknown type
          this.applyCut(outgoing, incoming, container);
      }
    } finally {
      this.isTransitioning = false;
    }
  }

  /**
   * Cut transition: instant swap with no animation.
   * Incoming is shown, outgoing is removed immediately.
   */
  private applyCut(
    outgoing: HTMLElement | null,
    incoming: HTMLElement,
    container: HTMLElement
  ): void {
    // Ensure incoming is in the container and fully visible
    this.prepareIncoming(incoming, container);
    incoming.style.opacity = '1';
    incoming.style.transform = 'none';
    incoming.style.zIndex = '2';

    // Remove outgoing immediately
    if (outgoing && outgoing.parentNode === container) {
      container.removeChild(outgoing);
    }
  }

  /**
   * Fade transition: outgoing fades out (opacity 1 → 0) revealing incoming underneath.
   * Incoming is already at full opacity below, so no black frame is possible.
   */
  private applyFade(
    outgoing: HTMLElement | null,
    incoming: HTMLElement,
    container: HTMLElement
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      // Place incoming below outgoing, fully visible
      this.prepareIncoming(incoming, container);
      incoming.style.opacity = '1';
      incoming.style.transform = 'none';
      incoming.style.zIndex = '1';

      if (!outgoing || outgoing.parentNode !== container) {
        // No outgoing element — just show incoming
        incoming.style.zIndex = '2';
        resolve();
        return;
      }

      // Place outgoing on top
      outgoing.style.zIndex = '2';
      outgoing.style.opacity = '1';

      // Force layout reflow to ensure initial state is painted
      void outgoing.offsetHeight;

      // Set up CSS transition on outgoing
      outgoing.style.transition = `opacity ${this.config.durationMs}ms ease-in-out`;

      const onTransitionEnd = () => {
        outgoing.removeEventListener('transitionend', onTransitionEnd);
        // Clean up outgoing
        if (outgoing.parentNode === container) {
          container.removeChild(outgoing);
        }
        // Promote incoming to top layer
        incoming.style.zIndex = '2';
        incoming.style.transition = '';
        resolve();
      };

      outgoing.addEventListener('transitionend', onTransitionEnd, { once: true });

      // Trigger the fade-out on next frame to ensure the transition fires
      requestAnimationFrame(() => {
        outgoing.style.opacity = '0';
      });

      // Safety timeout in case transitionend doesn't fire (e.g., element removed)
      setTimeout(() => {
        onTransitionEnd();
      }, this.config.durationMs + 50);
    });
  }

  /**
   * Slide transition: outgoing slides out to the left (translateX: 0 → -100%),
   * revealing incoming underneath at full position.
   * Incoming is already in place below, so no black frame is possible.
   */
  private applySlide(
    outgoing: HTMLElement | null,
    incoming: HTMLElement,
    container: HTMLElement
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      // Place incoming below outgoing, fully visible, in final position
      this.prepareIncoming(incoming, container);
      incoming.style.opacity = '1';
      incoming.style.transform = 'translateX(0)';
      incoming.style.zIndex = '1';

      if (!outgoing || outgoing.parentNode !== container) {
        // No outgoing element — just show incoming
        incoming.style.zIndex = '2';
        resolve();
        return;
      }

      // Place outgoing on top, in its current position
      outgoing.style.zIndex = '2';
      outgoing.style.transform = 'translateX(0)';

      // Force layout reflow
      void outgoing.offsetHeight;

      // Set up CSS transition on outgoing
      outgoing.style.transition = `transform ${this.config.durationMs}ms ease-in-out`;

      const onTransitionEnd = () => {
        outgoing.removeEventListener('transitionend', onTransitionEnd);
        // Clean up outgoing
        if (outgoing.parentNode === container) {
          container.removeChild(outgoing);
        }
        // Promote incoming to top layer
        incoming.style.zIndex = '2';
        incoming.style.transition = '';
        resolve();
      };

      outgoing.addEventListener('transitionend', onTransitionEnd, { once: true });

      // Trigger slide-out on next frame
      requestAnimationFrame(() => {
        outgoing.style.transform = 'translateX(-100%)';
      });

      // Safety timeout
      setTimeout(() => {
        onTransitionEnd();
      }, this.config.durationMs + 50);
    });
  }

  /**
   * Prepares an incoming element for display in the container.
   * Ensures it's appended, positioned absolutely, and fills the container.
   */
  private prepareIncoming(incoming: HTMLElement, container: HTMLElement): void {
    // Only append if not already in the container
    if (incoming.parentNode !== container) {
      incoming.style.position = 'absolute';
      incoming.style.top = '0';
      incoming.style.left = '0';
      incoming.style.width = '100%';
      incoming.style.height = '100%';
      container.appendChild(incoming);
    }
  }
}
