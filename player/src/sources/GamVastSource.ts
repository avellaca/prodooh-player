/**
 * Google Ad Manager VAST content source.
 * Fetches VAST XML from a sandbox ad tag, parses media URL and duration,
 * and returns PreparedContent for the player loop engine.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4
 */

import type { ContentSource, PreparedContent } from './types';

/** Configuration options for GamVastSource */
export interface GamVastConfig {
  /** The VAST ad tag URL (must be a sandbox/test tag) */
  adTagUrl: string;
  /** Timeout in milliseconds for the VAST request (default: 5000) */
  timeout?: number;
}

/**
 * Content source implementation for Google Ad Manager VAST (sandbox).
 * Validates that the ad tag is a test/sandbox tag before sending requests,
 * parses VAST XML responses to extract media files and duration.
 */
export class GamVastSource implements ContentSource {
  readonly id = 'gam' as const;

  private readonly adTagUrl: string;
  private readonly timeout: number;

  constructor(config: GamVastConfig) {
    this.adTagUrl = config.adTagUrl;
    this.timeout = config.timeout ?? 5000;
  }

  /**
   * Pre-fetch next content from GAM VAST.
   * 1. Validates adTagUrl is a sandbox tag
   * 2. Fetches VAST XML from the adTagUrl
   * 3. Parses XML to extract MediaFile URL and duration
   * 4. Returns PreparedContent or null on failure/no-fill
   */
  async prefetch(): Promise<PreparedContent | null> {
    if (!this.validateSandboxTag(this.adTagUrl)) {
      return null;
    }

    try {
      const xml = await this.fetchVastXml();
      if (!xml) {
        return null;
      }

      const parsed = this.parseVastXml(xml);
      if (!parsed) {
        return null;
      }

      const contentType = this.inferContentType(parsed.mediaUrl);

      return {
        id: `gam-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: contentType,
        source: 'gam',
        mediaUrl: parsed.mediaUrl,
        duration: parsed.duration,
        metadata: {
          vastDuration: parsed.duration,
          adTagUrl: this.adTagUrl,
        },
      };
    } catch {
      // Timeout, network error, or any other failure → return null
      return null;
    }
  }

  /**
   * Confirm the content was played successfully.
   * No-op for MVP — VAST tracking handled separately by the VAST spec.
   */
  async confirmPlay(_content: PreparedContent): Promise<void> {
    // No-op for MVP
  }

  /**
   * Report that content could not be played.
   * No-op for MVP.
   */
  async reportFailure(_content: PreparedContent, _reason: string): Promise<void> {
    // No-op for MVP
  }

  /**
   * Check if this source is enabled and configured.
   * Returns true if adTagUrl is set and validates as a sandbox tag.
   */
  isAvailable(): boolean {
    return !!this.adTagUrl && this.validateSandboxTag(this.adTagUrl);
  }

  /**
   * Validates that the ad tag URL corresponds to a sandbox/test tag.
   * Checks for common sandbox indicators in the URL.
   *
   * Validates: Requirement 3.1
   */
  private validateSandboxTag(url: string): boolean {
    if (!url || typeof url !== 'string') {
      return false;
    }

    const lowerUrl = url.toLowerCase();

    // Check for sandbox/test indicators in the URL
    const sandboxIndicators = [
      'test',
      'sandbox',
      'sample_tag',
      'debug',
      'adunit/test',
      'test_ad',
      '/test/',
    ];

    return sandboxIndicators.some((indicator) => lowerUrl.includes(indicator));
  }

  /**
   * Fetches VAST XML from the ad tag URL with timeout.
   * Returns the XML string or null on failure.
   */
  private async fetchVastXml(): Promise<string | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.adTagUrl, {
        signal: controller.signal,
      });

      if (!response.ok) {
        return null;
      }

      const text = await response.text();
      return text || null;
    } catch {
      // AbortError (timeout) or network error
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Parses VAST XML to extract the media file URL and duration.
   * Returns null if no MediaFile is found (no-fill).
   */
  private parseVastXml(xml: string): { mediaUrl: string; duration: number } | null {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'text/xml');

      // Check for parse errors
      const parseError = doc.querySelector('parsererror');
      if (parseError) {
        return null;
      }

      // Look for MediaFile elements
      const mediaFile = doc.querySelector('MediaFile');
      if (!mediaFile) {
        return null;
      }

      const mediaUrl = (mediaFile.textContent ?? '').trim();
      if (!mediaUrl) {
        return null;
      }

      // Parse duration from Duration element (HH:MM:SS format)
      const duration = this.parseDuration(doc);

      return { mediaUrl, duration };
    } catch {
      // Malformed XML or other parsing error
      return null;
    }
  }

  /**
   * Parses the VAST Duration element (HH:MM:SS format) to seconds.
   * Falls back to a default of 15 seconds if no Duration is found.
   */
  private parseDuration(doc: Document): number {
    const durationEl = doc.querySelector('Duration');
    if (!durationEl || !durationEl.textContent) {
      return 15; // Default duration for VAST ads
    }

    const text = durationEl.textContent.trim();
    const match = text.match(/^(\d{2}):(\d{2}):(\d{2})$/);
    if (!match) {
      return 15;
    }

    const hours = parseInt(match[1]!, 10);
    const minutes = parseInt(match[2]!, 10);
    const seconds = parseInt(match[3]!, 10);

    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    return totalSeconds > 0 ? totalSeconds : 15;
  }

  /**
   * Infers content type from the media URL extension.
   */
  private inferContentType(url: string): 'image' | 'video' {
    const lowerUrl = url.toLowerCase();
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

    if (imageExtensions.some((ext) => lowerUrl.endsWith(ext))) {
      return 'image';
    }

    return 'video'; // Default to video for VAST (most common)
  }
}
