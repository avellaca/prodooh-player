/**
 * Shared type definitions for the sync module.
 */

/** Interface for media download operations (injectable for testing) */
export interface MediaDownloader {
  /**
   * Download a media file from url to local storage.
   * Returns the local file path on success, null on failure.
   */
  download(url: string, itemId: string): Promise<string | null>;

  /**
   * Compute SHA-256 checksum of a local file.
   * Returns hex-encoded hash string.
   */
  computeChecksum(filePath: string): Promise<string>;
}
