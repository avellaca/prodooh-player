/**
 * FullscreenRenderer — Manages the visible canvas with layered display.
 *
 * Three layers:
 * 1. Primary layer — shows the current content
 * 2. Transition layer — used for animated swaps between content
 * 3. Fallback layer — used for instant synchronous swap when content isn't ready
 *
 * The renderer ensures transitions between content happen without perceptible
 * black frames, regardless of content source.
 *
 * Validates: Requirements 6.2, 6.3
 */

import type { PreparedContent } from '../sources/types';

/** Configuration for transition animations */
export interface TransitionConfig {
  type: 'cut' | 'fade' | 'slide';
  durationMs: number;
}

const DEFAULT_TRANSITION: TransitionConfig = {
  type: 'fade',
  durationMs: 500,
};

/**
 * FullscreenRenderer manages three DOM layers for seamless content display.
 *
 * - show() sets the initial content (no animation).
 * - transitionTo() animates from current to next content.
 * - showFallback() is a synchronous instant swap for emergency fallback.
 */
export class FullscreenRenderer {
  private container: HTMLElement;
  private primaryLayer: HTMLElement;
  private transitionLayer: HTMLElement;
  private fallbackLayer: HTMLElement;
  private transitionConfig: TransitionConfig;

  private currentContent: PreparedContent | null = null;
  private transitioning: boolean = false;

  constructor(container: HTMLElement, transitionConfig?: TransitionConfig) {
    this.container = container;
    this.transitionConfig = transitionConfig ?? DEFAULT_TRANSITION;

    // Set up the container as a fullscreen stacking context
    this.container.style.position = 'relative';
    this.container.style.width = '100%';
    this.container.style.height = '100%';
    this.container.style.overflow = 'hidden';
    this.container.style.backgroundColor = '#000';

    // Create the three layers
    this.primaryLayer = this.createLayer('primary-layer', 1);
    this.transitionLayer = this.createLayer('transition-layer', 2);
    this.fallbackLayer = this.createLayer('fallback-layer', 3);

    // All layers start hidden except when in use
    this.transitionLayer.style.visibility = 'hidden';
    this.fallbackLayer.style.visibility = 'hidden';

    this.container.appendChild(this.primaryLayer);
    this.container.appendChild(this.transitionLayer);
    this.container.appendChild(this.fallbackLayer);
  }

  /**
   * Initial display of content. No transition animation.
   * Sets the content on the primary layer immediately.
   */
  show(content: PreparedContent): void {
    this.clearLayer(this.primaryLayer);
    const element = this.getContentElement(content);
    this.primaryLayer.appendChild(element);
    this.primaryLayer.style.visibility = 'visible';
    this.currentContent = content;

    // Ensure transition and fallback layers are hidden
    this.transitionLayer.style.visibility = 'hidden';
    this.fallbackLayer.style.visibility = 'hidden';
  }

  /**
   * Animated transition from current content to new content.
   * The new content is placed on the transition layer, animated in,
   * then promoted to the primary layer once the animation completes.
   *
   * Validates: Requirement 6.2 (no perceptible black frames)
   */
  async transitionTo(content: PreparedContent): Promise<void> {
    if (this.transitioning) {
      // If already transitioning, do a cut (instant swap)
      this.show(content);
      return;
    }

    const config = this.transitionConfig;

    // For 'cut' transitions, just do an instant swap
    if (config.type === 'cut' || config.durationMs <= 0) {
      this.show(content);
      return;
    }

    this.transitioning = true;

    try {
      // Place new content on the transition layer
      this.clearLayer(this.transitionLayer);
      const element = this.getContentElement(content);
      this.transitionLayer.appendChild(element);

      // Set initial state for animation
      this.applyTransitionStart(this.transitionLayer, config);
      this.transitionLayer.style.visibility = 'visible';

      // Wait for the animation to complete
      await this.animate(this.transitionLayer, config);

      // Promote: move new content to primary, hide transition layer
      this.clearLayer(this.primaryLayer);
      this.primaryLayer.appendChild(element);
      this.primaryLayer.style.visibility = 'visible';

      this.transitionLayer.style.visibility = 'hidden';
      this.clearLayer(this.transitionLayer);
      this.resetTransitionStyles(this.transitionLayer);

      this.currentContent = content;
    } finally {
      this.transitioning = false;
    }
  }

  /**
   * Synchronous instant swap to fallback content.
   * This method is NOT async — it must be instant for emergency use
   * when the next content isn't ready (Requirement 6.3).
   *
   * Shows fallback content on the top-most fallback layer immediately,
   * hiding primary and transition layers.
   */
  showFallback(content: PreparedContent): void {
    this.clearLayer(this.fallbackLayer);
    const element = this.getContentElement(content);
    this.fallbackLayer.appendChild(element);
    this.fallbackLayer.style.visibility = 'visible';

    // Hide other layers beneath
    this.primaryLayer.style.visibility = 'hidden';
    this.transitionLayer.style.visibility = 'hidden';

    this.currentContent = content;
    this.transitioning = false;
  }

  /**
   * Dismiss the fallback layer, revealing the primary layer again.
   * Used after new content is ready to take over from fallback.
   */
  dismissFallback(): void {
    this.fallbackLayer.style.visibility = 'hidden';
    this.clearLayer(this.fallbackLayer);
    this.primaryLayer.style.visibility = 'visible';
  }

  /** Returns the content currently being displayed. */
  getCurrentContent(): PreparedContent | null {
    return this.currentContent;
  }

  /** Returns whether a transition animation is currently in progress. */
  isTransitioning(): boolean {
    return this.transitioning;
  }

  /** Returns the container element managed by this renderer. */
  getContainer(): HTMLElement {
    return this.container;
  }

  /** Returns the primary layer element (for testing). */
  getPrimaryLayer(): HTMLElement {
    return this.primaryLayer;
  }

  /** Returns the transition layer element (for testing). */
  getTransitionLayer(): HTMLElement {
    return this.transitionLayer;
  }

  /** Returns the fallback layer element (for testing). */
  getFallbackLayer(): HTMLElement {
    return this.fallbackLayer;
  }

  /** Update transition configuration at runtime. */
  setTransitionConfig(config: TransitionConfig): void {
    this.transitionConfig = config;
  }

  // --- Private helpers ---

  private createLayer(id: string, zIndex: number): HTMLElement {
    const layer = document.createElement('div');
    layer.setAttribute('data-layer', id);
    layer.style.position = 'absolute';
    layer.style.top = '0';
    layer.style.left = '0';
    layer.style.width = '100%';
    layer.style.height = '100%';
    layer.style.zIndex = String(zIndex);
    layer.style.visibility = 'visible';
    return layer;
  }

  private clearLayer(layer: HTMLElement): void {
    while (layer.firstChild) {
      layer.removeChild(layer.firstChild);
    }
  }

  private getContentElement(content: PreparedContent): HTMLElement {
    if (content.element) {
      // Use pre-rendered element if available (from FallbackBuffer or prefetch)
      return content.element;
    }

    // Create a basic element based on content type
    switch (content.type) {
      case 'image': {
        const img = document.createElement('img');
        img.src = content.mediaUrl;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'contain';
        return img;
      }
      case 'video': {
        const video = document.createElement('video');
        video.src = content.mediaUrl;
        video.autoplay = true;
        video.muted = true;
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'contain';
        return video;
      }
      case 'url':
      case 'html': {
        // Detect media URLs by extension — render as img/video instead of iframe
        const url = content.mediaUrl.toLowerCase();
        if (/\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?.*)?$/i.test(url)) {
          const img = document.createElement('img');
          img.src = content.mediaUrl;
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.objectFit = 'contain';
          return img;
        }
        if (/\.(mp4|webm|ogv|mov)(\?.*)?$/i.test(url)) {
          const video = document.createElement('video');
          video.src = content.mediaUrl;
          video.autoplay = true;
          video.muted = true;
          video.style.width = '100%';
          video.style.height = '100%';
          video.style.objectFit = 'contain';
          return video;
        }
        const iframe = document.createElement('iframe');
        iframe.src = content.mediaUrl;
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        return iframe;
      }
      default: {
        const div = document.createElement('div');
        div.textContent = 'Unsupported content type';
        return div;
      }
    }
  }

  private applyTransitionStart(layer: HTMLElement, config: TransitionConfig): void {
    switch (config.type) {
      case 'fade':
        layer.style.opacity = '0';
        break;
      case 'slide':
        layer.style.transform = 'translateX(100%)';
        break;
    }
  }

  private animate(layer: HTMLElement, config: TransitionConfig): Promise<void> {
    return new Promise((resolve) => {
      // Set up CSS transition
      switch (config.type) {
        case 'fade':
          layer.style.transition = `opacity ${config.durationMs}ms ease-in-out`;
          break;
        case 'slide':
          layer.style.transition = `transform ${config.durationMs}ms ease-in-out`;
          break;
      }

      // Force a reflow to ensure the initial state is rendered
      void layer.offsetHeight;

      // Apply end state
      switch (config.type) {
        case 'fade':
          layer.style.opacity = '1';
          break;
        case 'slide':
          layer.style.transform = 'translateX(0)';
          break;
      }

      // Wait for transition to complete
      const onEnd = () => {
        layer.removeEventListener('transitionend', onEnd);
        clearTimeout(fallbackTimer);
        resolve();
      };

      layer.addEventListener('transitionend', onEnd, { once: true });

      // Safety fallback in case transitionend doesn't fire (jsdom, etc.)
      const fallbackTimer = setTimeout(() => {
        layer.removeEventListener('transitionend', onEnd);
        resolve();
      }, config.durationMs + 50);
    });
  }

  private resetTransitionStyles(layer: HTMLElement): void {
    layer.style.transition = '';
    layer.style.opacity = '';
    layer.style.transform = '';
  }

  /**
   * Wait for a media element (img/video) to load before showing it.
   * Resolves immediately for non-media elements or already-loaded content.
   * Times out after 3 seconds to avoid blocking forever.
   */
  private waitForLoad(element: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
      if (element instanceof HTMLImageElement) {
        if (element.complete && element.naturalWidth > 0) {
          resolve();
          return;
        }
        const timeout = setTimeout(resolve, 3000);
        element.onload = () => { clearTimeout(timeout); resolve(); };
        element.onerror = () => { clearTimeout(timeout); resolve(); };
      } else if (element instanceof HTMLVideoElement) {
        if (element.readyState >= 2) {
          resolve();
          return;
        }
        const timeout = setTimeout(resolve, 3000);
        element.onloadeddata = () => { clearTimeout(timeout); resolve(); };
        element.onerror = () => { clearTimeout(timeout); resolve(); };
      } else {
        resolve();
      }
    });
  }
}
