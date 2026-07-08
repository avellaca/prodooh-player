/**
 * ProDooh Ad Serving API content source.
 * Implements the ContentSource interface to fetch ads from the Prodooh API,
 * handle proof-of-play confirmations, and manage rate limiting.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5
 */

import type { ContentSource, ContentType, PreparedContent } from './types';

/** Configuration for the ProDooh content source */
export interface ProDoohSourceConfig {
  apiKey: string;
  networkId: string;
  venueId: string;
  baseUrl: string;
  width: number;
  height: number;
}

/** Shape of a successful ad response from the Prodooh API */
export interface ProDoohAdResponse {
  media: string;
  type: string;
  print_id: string;
  proof_of_play: string;
  expiration: string;
  media_id?: number;
  campaign_id?: number;
}

/** Shape of a no-fill response */
export interface ProDoohNoFillResponse {
  status?: string;
  error?: string;
}

/** Minimum interval between API requests in milliseconds */
const MIN_REQUEST_INTERVAL_MS = 10_000;

/** Supported media types sent to the API */
const SUPPORTED_MEDIA = ['image/jpeg', 'image/png', 'video/mp4'];

/**
 * Maps a MIME type from the API response to a player ContentType.
 */
function mimeToContentType(mime: string): ContentType {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  return 'image'; // fallback
}

export class ProDoohSource implements ContentSource {
  readonly id = 'prodooh' as const;

  private config: ProDoohSourceConfig;
  private lastRequestTime: number = 0;

  constructor(config: ProDoohSourceConfig) {
    this.config = config;
  }

  /**
   * Pre-fetch the next ad from the Prodooh Ad Serving API.
   * Enforces rate limiting (minimum 10s between requests).
   * Returns null on no-fill, error, or rate limit.
   */
  async prefetch(): Promise<PreparedContent | null> {
    // Rate limit check
    const now = Date.now();
    if (now - this.lastRequestTime < MIN_REQUEST_INTERVAL_MS) {
      return null;
    }

    this.lastRequestTime = now;

    try {
      const url = `${this.config.baseUrl.replace(/\/+$/, '')}/public/v1/ad`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          api_key: this.config.apiKey,
          network_id: this.config.networkId,
          venue_id: this.config.venueId,
          width: this.config.width,
          height: this.config.height,
          supported_media: SUPPORTED_MEDIA,
        }),
      });

      if (!response.ok) {
        // HTTP error (401, 404, 422, 429, 500, etc.)
        return null;
      }

      const data = await response.json();

      // Check for no-fill responses
      if (this.isNoFill(data)) {
        return null;
      }

      // Successful ad response
      const adResponse = data as ProDoohAdResponse;

      if (!adResponse.media || !adResponse.print_id) {
        return null;
      }

      const content: PreparedContent = {
        id: adResponse.print_id,
        type: mimeToContentType(adResponse.type),
        source: 'prodooh',
        mediaUrl: adResponse.media,
        duration: 10, // Default duration, resolved by loop engine
        metadata: {
          print_id: adResponse.print_id,
          proof_of_play_url: adResponse.proof_of_play,
          expiration_url: adResponse.expiration,
          media_id: adResponse.media_id,
          campaign_id: adResponse.campaign_id,
        },
      };

      return content;
    } catch {
      // Network error, timeout, or JSON parse failure
      return null;
    }
  }

  /**
   * Confirm that content was played successfully by calling the proof_of_play URL.
   * In production this would be queued in the POP queue for reliable delivery.
   */
  async confirmPlay(content: PreparedContent): Promise<void> {
    const popUrl = content.metadata.proof_of_play_url as string | undefined;
    if (!popUrl) return;

    try {
      await fetch(popUrl, { method: 'GET' });
    } catch {
      // In a full implementation, this would be enqueued in the POP queue
      // for retry with exponential backoff. Silently fail here.
    }
  }

  /**
   * Report that content could not be played by calling the expiration URL.
   */
  async reportFailure(content: PreparedContent, _reason: string): Promise<void> {
    const expirationUrl = content.metadata.expiration_url as string | undefined;
    if (!expirationUrl) return;

    try {
      await fetch(expirationUrl, { method: 'GET' });
    } catch {
      // In a full implementation, this would be enqueued in the POP queue
      // for retry with exponential backoff. Silently fail here.
    }
  }

  /**
   * Check if the source is configured and available.
   * Returns true if apiKey and networkId are present.
   */
  isAvailable(): boolean {
    return !!(this.config.apiKey && this.config.networkId);
  }

  /**
   * Check if a response indicates no ad is available (no-fill).
   */
  private isNoFill(data: unknown): boolean {
    if (!data || typeof data !== 'object') return true;
    const response = data as ProDoohNoFillResponse;
    if (response.status === 'no fill') return true;
    if (response.error) return true;
    return false;
  }
}
