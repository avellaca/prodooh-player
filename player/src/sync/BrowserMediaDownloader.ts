/**
 * BrowserMediaDownloader — Browser-compatible MediaDownloader implementation.
 *
 * In the browser environment (Chromium kiosk on Raspberry Pi or local dev),
 * media files of type 'url' don't need downloading — they're loaded directly
 * by the browser at playback time. For image/video items, we fetch the blob
 * and create an object URL for offline-capable playback.
 *
 * Supports authenticated downloads for content served by the backend
 * (e.g., /api/device/content/{id}/file) using the Bearer token.
 *
 * This implementation works in both:
 * - Raspberry Pi (Chromium kiosk mode)
 * - Developer machine (browser for local testing)
 */

import type { MediaDownloader } from './PlaylistSyncManager';

export interface BrowserMediaDownloaderOptions {
  /** Function that returns the current Bearer token for authenticated requests */
  getToken?: () => string | null;
}

export class BrowserMediaDownloader implements MediaDownloader {
  private getToken: () => string | null;

  constructor(options?: BrowserMediaDownloaderOptions) {
    this.getToken = options?.getToken ?? (() => null);
  }

  /**
   * Download a media file from url to local storage.
   * In the browser, this fetches the file as a blob and creates an object URL.
   * Attaches Bearer token for backend URLs that require authentication.
   * Returns the object URL on success, null on failure.
   */
  async download(url: string, _itemId: string): Promise<string | null> {
    try {
      const headers: Record<string, string> = {};
      const token = this.getToken();
      if (token && this.isBackendUrl(url)) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(url, { headers });
      if (!response.ok) {
        console.warn(`[BrowserMediaDownloader] Failed to fetch ${url}: ${response.status}`);
        return null;
      }
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (error) {
      console.warn(`[BrowserMediaDownloader] Network error downloading ${url}:`, error);
      return null;
    }
  }

  /**
   * Compute SHA-256 checksum of a local file (blob URL).
   * In the browser, we re-fetch the blob URL and use Web Crypto for hashing.
   */
  async computeChecksum(blobUrl: string): Promise<string> {
    try {
      const response = await fetch(blobUrl);
      const buffer = await response.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // If checksum computation fails, return empty string (validation will fail gracefully)
      return '';
    }
  }

  /**
   * Check if a URL points to the backend API (needs auth token).
   * Matches /api/device/content/ paths on any host.
   */
  private isBackendUrl(url: string): boolean {
    return url.includes('/api/device/content/');
  }
}
