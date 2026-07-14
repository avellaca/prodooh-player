/**
 * PreviewContentHandler — Handles 'preview_content' commands from heartbeat.
 *
 * When a preview_content command is received:
 * 1. Downloads the asset at the specified URL
 * 2. If download fails: ignores the command silently and continues
 * 3. If download succeeds: queues the preview for playback
 * 4. The ManifestEngine plays the preview ONE time after the current item finishes
 * 5. No impression is recorded for preview playback
 * 6. Manifest resumes from where it left off
 *
 * Validates: Requirements 21.4, 21.5, 21.7
 */

import type { CommandHandler, DeviceCommand } from '../sync/HeartbeatService';
import type { MediaDownloader } from '../sync/types';
import type { ManifestEngine } from '../engine/ManifestEngine';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PreviewItem {
  content_id: string;
  asset_url: string;
  local_url: string;
  duration_seconds: number;
}

export interface PreviewContentHandlerOptions {
  /** The ManifestEngine to inject preview items into */
  manifestEngine: ManifestEngine;

  /** Media downloader to fetch the preview asset */
  downloader: MediaDownloader;

  /** Default duration in seconds if none specified (default: 10) */
  defaultDurationSeconds?: number;
}

// ─── PreviewContentHandler ───────────────────────────────────────────────────

export class PreviewContentHandler implements CommandHandler {
  private manifestEngine: ManifestEngine;
  private downloader: MediaDownloader;
  private defaultDurationSeconds: number;

  constructor(options: PreviewContentHandlerOptions) {
    this.manifestEngine = options.manifestEngine;
    this.downloader = options.downloader;
    this.defaultDurationSeconds = options.defaultDurationSeconds ?? 10;
  }

  /**
   * Handle a device command from the heartbeat response.
   * Only processes 'preview_content' commands; ignores others.
   */
  async handleCommand(command: DeviceCommand): Promise<void> {
    if (command.type !== 'preview_content') {
      return;
    }

    const payload = command.payload as {
      content_id?: string;
      asset_url?: string;
      duration_seconds?: number;
    };

    // Validate required fields
    if (!payload.content_id || !payload.asset_url) {
      return;
    }

    const durationSeconds = payload.duration_seconds ?? this.defaultDurationSeconds;

    // Try to download the content
    const localUrl = await this.downloader.download(payload.asset_url, payload.content_id);

    if (!localUrl) {
      // Download failed — ignore silently and continue normal playback (Req 21.7)
      return;
    }

    // Queue the preview item on the ManifestEngine
    const previewItem: PreviewItem = {
      content_id: payload.content_id,
      asset_url: payload.asset_url,
      local_url: localUrl,
      duration_seconds: durationSeconds,
    };

    this.manifestEngine.queuePreview(previewItem);
  }
}
