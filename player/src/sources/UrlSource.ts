/**
 * UrlSource — Content source for web content loaded via URL.
 *
 * Cycles through configured URLs sequentially, supports dynamic variable
 * injection (venue_id, tenant_id, timestamp), and handles load timeouts.
 * Loads URLs in hidden iframes and swaps to visible when ready.
 *
 * Validates: Requirements 27.1, 27.2, 27.3, 27.4, 27.5, 27.6
 */

import type { ContentSource, PreparedContent, SourceType } from './types';

/** Configuration for a single URL entry in the source */
export interface UrlConfig {
  /** The URL to load (may contain template variables like {venue_id}) */
  url: string;
  /** Display duration in seconds */
  duration: number;
  /** Optional refresh interval in seconds (how often to reload while visible) */
  refresh_interval?: number;
}

/** Constructor options for UrlSource */
export interface UrlSourceConfig {
  /** List of URL entries to rotate through */
  urls: UrlConfig[];
  /** Load timeout in milliseconds (default: 10000) */
  timeout?: number;
  /** Dynamic variables to inject into URL templates */
  variables?: Record<string, string>;
  /** Optional: custom iframe loader (for testing / DI) */
  iframeLoader?: IframeLoader;
}

/**
 * Abstraction for iframe loading, enabling testability and DI.
 * The default implementation creates real DOM iframes.
 */
export interface IframeLoader {
  /**
   * Load a URL in a hidden iframe. Returns the iframe element on success,
   * or null if the load times out or fails.
   */
  load(url: string, timeoutMs: number): Promise<HTMLIFrameElement | null>;

  /**
   * Clean up a previously loaded iframe (remove from DOM).
   */
  dispose(iframe: HTMLIFrameElement): void;
}

/** Default load timeout in milliseconds */
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Default iframe loader that creates hidden iframes in the DOM,
 * waits for load events, and handles timeouts.
 *
 * Validates: Requirement 27.4 (load in iframe/webview)
 */
export class DomIframeLoader implements IframeLoader {
  /**
   * Load a URL in a hidden iframe. The iframe starts hidden and will be
   * swapped to visible by the renderer when it's time to display.
   *
   * Validates: Requirement 27.3 (timeout), 27.6 (handle load failures)
   */
  load(url: string, timeoutMs: number): Promise<HTMLIFrameElement | null> {
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.src = url;
      iframe.style.position = 'absolute';
      iframe.style.top = '0';
      iframe.style.left = '0';
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = 'none';
      iframe.style.visibility = 'hidden';
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');

      let settled = false;

      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          // Timeout reached — clean up and return null
          this.dispose(iframe);
          resolve(null);
        }
      }, timeoutMs);

      const onLoad = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          // Successfully loaded — keep iframe hidden until renderer shows it
          resolve(iframe);
        }
      };

      const onError = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          this.dispose(iframe);
          resolve(null);
        }
      };

      iframe.addEventListener('load', onLoad, { once: true });
      iframe.addEventListener('error', onError, { once: true });

      // Append to DOM (hidden) to trigger the load
      document.body.appendChild(iframe);
    });
  }

  /**
   * Remove iframe from DOM and clear its src to stop any ongoing loads.
   */
  dispose(iframe: HTMLIFrameElement): void {
    iframe.removeEventListener('load', () => {});
    iframe.removeEventListener('error', () => {});
    iframe.src = 'about:blank';
    if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  }
}

/**
 * Content source that loads web pages by URL in the player loop.
 * Rotates sequentially through configured URLs, injecting dynamic
 * variables and respecting per-URL duration settings.
 *
 * Loads URLs in hidden iframes and provides the pre-loaded element
 * in PreparedContent for instant swap to visible when displayed.
 */
export class UrlSource implements ContentSource {
  readonly id: SourceType = 'url';

  private readonly urls: UrlConfig[];
  private readonly timeout: number;
  private readonly variables: Record<string, string>;
  private readonly iframeLoader: IframeLoader;
  private currentIndex: number = 0;

  constructor(config: UrlSourceConfig) {
    this.urls = config.urls;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
    this.variables = config.variables ?? {};
    this.iframeLoader = config.iframeLoader ?? new DomIframeLoader();
  }

  /**
   * Pre-fetch next URL content by loading it in a hidden iframe.
   * Returns PreparedContent with the loaded iframe element, or null
   * if no URLs are configured or the load fails/times out.
   *
   * Advances the internal rotation index each call, wrapping at end.
   *
   * Validates: Requirements 27.1, 27.2, 27.3, 27.4, 27.6
   */
  async prefetch(): Promise<PreparedContent | null> {
    if (this.urls.length === 0) {
      return null;
    }

    // Wrap index if needed
    if (this.currentIndex >= this.urls.length) {
      this.currentIndex = 0;
    }

    const urlConfig = this.urls[this.currentIndex]!;
    this.currentIndex = (this.currentIndex + 1) % this.urls.length;

    const resolvedUrl = this.injectVariables(urlConfig.url);

    // Load the URL in a hidden iframe with timeout
    const iframe = await this.iframeLoader.load(resolvedUrl, this.timeout);

    if (!iframe) {
      // Load failed or timed out (Req 27.3, 27.6)
      return null;
    }

    return {
      id: `url-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'url',
      source: 'url',
      mediaUrl: resolvedUrl,
      duration: urlConfig.duration,
      metadata: {
        originalUrl: urlConfig.url,
        timeout: this.timeout,
        refresh_interval: urlConfig.refresh_interval ?? null,
      },
      element: iframe,
    };
  }

  /**
   * Confirm content was played. Cleans up the iframe element.
   */
  async confirmPlay(content: PreparedContent): Promise<void> {
    if (content.element && content.element instanceof HTMLIFrameElement) {
      this.iframeLoader.dispose(content.element);
    }
  }

  /**
   * Report that content could not be played (e.g. display error).
   * Cleans up the iframe and logs the failure.
   */
  async reportFailure(content: PreparedContent, reason: string): Promise<void> {
    if (content.element && content.element instanceof HTMLIFrameElement) {
      this.iframeLoader.dispose(content.element);
    }
    console.error(
      `[UrlSource] Failed to load URL ${content.mediaUrl}: ${reason}`
    );
  }

  /**
   * Returns true if at least one URL is configured.
   */
  isAvailable(): boolean {
    return this.urls.length > 0;
  }

  /**
   * Replace template variables in a URL string.
   * Supported patterns: {venue_id}, {tenant_id}, {timestamp}, and any
   * key present in the variables map.
   *
   * Validates: Requirement 27.5
   */
  injectVariables(url: string): string {
    let resolved = url;

    // Replace {timestamp} with current epoch milliseconds
    resolved = resolved.replace(/\{timestamp\}/g, Date.now().toString());

    // Replace all other variables from the map
    for (const [key, value] of Object.entries(this.variables)) {
      const pattern = new RegExp(`\\{${key}\\}`, 'g');
      resolved = resolved.replace(pattern, value);
    }

    return resolved;
  }
}
