/**
 * UrlSource — Content source for web content loaded via URL.
 *
 * Cycles through configured URLs sequentially, supports dynamic variable
 * injection (venue_id, tenant_id, timestamp), and handles load timeouts.
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
}

/** Default load timeout in milliseconds */
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Content source that loads web pages by URL in the player loop.
 * Rotates sequentially through configured URLs, injecting dynamic
 * variables and respecting per-URL duration settings.
 */
export class UrlSource implements ContentSource {
  readonly id: SourceType = 'url';

  private readonly urls: UrlConfig[];
  private readonly timeout: number;
  private readonly variables: Record<string, string>;
  private currentIndex: number = 0;

  constructor(config: UrlSourceConfig) {
    this.urls = config.urls;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
    this.variables = config.variables ?? {};
  }

  /**
   * Pre-fetch next URL content. Returns PreparedContent or null if no URLs configured.
   * Advances the internal rotation index each call, wrapping at end.
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
    };
  }

  /**
   * Confirm content was played. No-op for URL source.
   */
  async confirmPlay(_content: PreparedContent): Promise<void> {
    // No-op: URL source doesn't require play confirmation
  }

  /**
   * Report that content could not be played (e.g. load timeout).
   * Logs the failure; the index has already been advanced by prefetch.
   */
  async reportFailure(content: PreparedContent, reason: string): Promise<void> {
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
   */
  private injectVariables(url: string): string {
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
