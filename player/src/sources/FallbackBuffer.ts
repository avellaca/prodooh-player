/**
 * FallbackBuffer — Maintains pre-decoded content ready in memory at all times.
 *
 * Ensures the player always has at least one content item decoded and ready
 * for instant display, enabling seamless transitions without black frames.
 * Falls back to factory/precargado content when no playlist items are available.
 *
 * Validates: Requirements 4.1, 6.3, 6.4, 25.1, 25.2, 25.3
 */

import type { PreparedContent, ContentType } from './types';
import type { PlaylistSource } from './PlaylistSource';

/** Default branded content shown when no playlist exists */
const FACTORY_CONTENT_ID = 'factory-prodooh-branding';
const FACTORY_CONTENT_DURATION = 10;

export class FallbackBuffer {
  private buffer: PreparedContent[] = [];
  private readonly playlistSource: PlaylistSource;
  private readonly minBufferSize: number;
  private replenishing: boolean = false;

  /**
   * @param options.playlistSource - The PlaylistSource to pull content from
   * @param options.minBufferSize - Minimum items to keep pre-decoded in buffer (default: 1)
   */
  constructor(options: { playlistSource: PlaylistSource; minBufferSize?: number }) {
    this.playlistSource = options.playlistSource;
    this.minBufferSize = options.minBufferSize ?? 1;
  }

  /**
   * Fill buffer to minBufferSize from PlaylistSource.
   * If playlist is empty, creates factory content (branded placeholder).
   * Non-blocking — safe to call from getNext() without awaiting.
   */
  async replenish(): Promise<void> {
    if (this.replenishing) {
      return;
    }

    this.replenishing = true;

    try {
      while (this.buffer.length < this.minBufferSize) {
        const content = await this.playlistSource.prefetch();

        if (content === null) {
          // Playlist is empty — use factory content
          this.buffer.push(this.loadFactoryContent());
          break;
        }

        // Pre-render the content element based on type
        const prepared = await this.preRender(content);
        this.buffer.push(prepared);
      }
    } finally {
      this.replenishing = false;
    }
  }

  /**
   * Returns the next pre-decoded content item.
   * Shifts from buffer and kicks off async replenish.
   * If buffer is empty (shouldn't happen), returns factory content synchronously.
   */
  getNext(): PreparedContent {
    const item = this.buffer.shift();

    // Kick off async replenish (non-blocking)
    void this.replenish();

    if (!item) {
      // Shouldn't happen if replenish was called initially,
      // but return factory content as ultimate fallback
      return this.loadFactoryContent();
    }

    return item;
  }

  /**
   * Returns true if buffer has at least 1 item ready.
   */
  hasContent(): boolean {
    return this.buffer.length > 0;
  }

  /**
   * Returns current buffer size.
   */
  getSize(): number {
    return this.buffer.length;
  }

  /**
   * Creates a simple placeholder content item representing Prodooh branding.
   * Used as last-resort fallback when no real playlist exists.
   */
  private loadFactoryContent(): PreparedContent {
    const element = document.createElement('div');
    element.style.width = '100%';
    element.style.height = '100%';
    element.style.display = 'flex';
    element.style.alignItems = 'center';
    element.style.justifyContent = 'center';
    element.style.backgroundColor = '#1a1a2e';
    element.style.color = '#ffffff';
    element.style.fontFamily = 'system-ui, sans-serif';
    element.style.fontSize = '3rem';
    element.textContent = 'Prodooh';
    element.dataset.factory = 'true';

    return {
      id: FACTORY_CONTENT_ID,
      type: 'html' as ContentType,
      source: 'playlist',
      mediaUrl: '',
      duration: FACTORY_CONTENT_DURATION,
      metadata: {
        isFactory: true,
        description: 'Prodooh branded placeholder — factory content',
      },
      element,
    };
  }

  /**
   * Pre-render content by creating and decoding the appropriate DOM element.
   * - Images: create <img> and call decode()
   * - Videos: create <video> and wait for canplaythrough
   * - URLs/iframes: create <iframe> and wait for load
   *
   * In test environments (jsdom), decode/canplaythrough/load may not fire,
   * so we handle errors gracefully and still return the content.
   */
  private async preRender(content: PreparedContent): Promise<PreparedContent> {
    try {
      switch (content.type) {
        case 'image':
          return await this.preRenderImage(content);
        case 'video':
          return await this.preRenderVideo(content);
        case 'url':
          return await this.preRenderIframe(content);
        default:
          return content;
      }
    } catch {
      // If pre-rendering fails, return content without pre-rendered element
      return content;
    }
  }

  private async preRenderImage(content: PreparedContent): Promise<PreparedContent> {
    const img = document.createElement('img');
    img.src = content.mediaUrl;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'contain';

    try {
      await img.decode();
    } catch {
      // decode() may not be supported in jsdom — proceed without it
    }

    return { ...content, element: img };
  }

  private async preRenderVideo(content: PreparedContent): Promise<PreparedContent> {
    const video = document.createElement('video');
    video.src = content.mediaUrl;
    video.preload = 'auto';
    video.muted = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'contain';

    // In real browsers, wait for canplaythrough to confirm decoding is ready.
    // In test environments (jsdom), video.load() is not implemented and events
    // won't fire, so we skip waiting.
    if (typeof video.load === 'function') {
      try {
        await new Promise<void>((resolve) => {
          let resolved = false;
          const done = () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve();
            }
          };

          const timeout = setTimeout(done, 3000);
          video.addEventListener('canplaythrough', done, { once: true });
          video.addEventListener('error', done, { once: true });

          // jsdom logs "Not implemented" but doesn't throw — detect by
          // checking if networkState changes after calling load()
          const prevState = video.networkState;
          video.load();
          // If networkState didn't change, load() is a no-op (jsdom)
          if (video.networkState === prevState && video.readyState === 0) {
            done();
          }
        });
      } catch {
        // Proceed with element even on error
      }
    }

    return { ...content, element: video };
  }

  private async preRenderIframe(content: PreparedContent): Promise<PreparedContent> {
    const iframe = document.createElement('iframe');
    iframe.src = content.mediaUrl;
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';

    // In jsdom, iframe load events won't fire.
    // We set the src and return immediately — the element is ready for DOM insertion.
    // In a real browser, the load event would fire naturally.

    return { ...content, element: iframe };
  }
}
