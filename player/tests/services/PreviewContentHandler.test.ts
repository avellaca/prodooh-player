import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PreviewContentHandler } from '../../src/services/PreviewContentHandler';
import type { PreviewItem } from '../../src/services/PreviewContentHandler';
import type { DeviceCommand } from '../../src/sync/HeartbeatService';
import type { ManifestEngine } from '../../src/engine/ManifestEngine';
import type { MediaDownloader } from '../../src/sync/types';

/**
 * Tests for PreviewContentHandler.
 * Validates: Requirements 21.4, 21.5, 21.7
 */

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createMockDownloader(result: string | null = 'blob:local-url'): MediaDownloader {
  return {
    download: vi.fn(async () => result),
    computeChecksum: vi.fn(async () => 'abc123'),
  };
}

function createMockManifestEngine(): ManifestEngine {
  return {
    queuePreview: vi.fn(),
    hasPendingPreview: vi.fn(() => false),
    run: vi.fn(),
    stop: vi.fn(),
    updateManifest: vi.fn(),
    getCurrentItem: vi.fn(() => null),
    getCurrentIndex: vi.fn(() => 0),
    isRunning: vi.fn(() => true),
  } as unknown as ManifestEngine;
}

function createPreviewCommand(overrides?: Partial<{
  content_id: string;
  asset_url: string;
  duration_seconds: number;
}>): DeviceCommand {
  return {
    id: 'cmd-1',
    type: 'preview_content',
    payload: {
      content_id: overrides?.content_id ?? 'content-uuid-1',
      asset_url: overrides?.asset_url ?? '/api/device/content/content-uuid-1/file',
      duration_seconds: overrides?.duration_seconds ?? 15,
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PreviewContentHandler', () => {
  let engine: ManifestEngine;
  let downloader: MediaDownloader;
  let handler: PreviewContentHandler;

  beforeEach(() => {
    engine = createMockManifestEngine();
    downloader = createMockDownloader();
    handler = new PreviewContentHandler({
      manifestEngine: engine,
      downloader,
    });
  });

  describe('handleCommand', () => {
    it('ignores commands that are not preview_content', async () => {
      const command: DeviceCommand = {
        id: 'cmd-1',
        type: 'screenshot',
        payload: {},
      };

      await handler.handleCommand(command);

      expect(downloader.download).not.toHaveBeenCalled();
      expect(engine.queuePreview).not.toHaveBeenCalled();
    });

    it('downloads the asset and queues preview on success', async () => {
      const command = createPreviewCommand();

      await handler.handleCommand(command);

      expect(downloader.download).toHaveBeenCalledWith(
        '/api/device/content/content-uuid-1/file',
        'content-uuid-1',
      );
      expect(engine.queuePreview).toHaveBeenCalledWith({
        content_id: 'content-uuid-1',
        asset_url: '/api/device/content/content-uuid-1/file',
        local_url: 'blob:local-url',
        duration_seconds: 15,
      } satisfies PreviewItem);
    });

    it('uses default duration when duration_seconds is not provided', async () => {
      const command: DeviceCommand = {
        id: 'cmd-1',
        type: 'preview_content',
        payload: {
          content_id: 'content-uuid-2',
          asset_url: '/api/device/content/content-uuid-2/file',
        },
      };

      await handler.handleCommand(command);

      expect(engine.queuePreview).toHaveBeenCalledWith(
        expect.objectContaining({ duration_seconds: 10 }),
      );
    });

    it('uses custom default duration from options', async () => {
      handler = new PreviewContentHandler({
        manifestEngine: engine,
        downloader,
        defaultDurationSeconds: 20,
      });

      const command: DeviceCommand = {
        id: 'cmd-1',
        type: 'preview_content',
        payload: {
          content_id: 'c1',
          asset_url: '/url',
        },
      };

      await handler.handleCommand(command);

      expect(engine.queuePreview).toHaveBeenCalledWith(
        expect.objectContaining({ duration_seconds: 20 }),
      );
    });

    it('ignores silently when download fails (Req 21.7)', async () => {
      downloader = createMockDownloader(null); // Download fails
      handler = new PreviewContentHandler({
        manifestEngine: engine,
        downloader,
      });

      const command = createPreviewCommand();

      await handler.handleCommand(command);

      expect(downloader.download).toHaveBeenCalled();
      expect(engine.queuePreview).not.toHaveBeenCalled();
    });

    it('ignores when content_id is missing', async () => {
      const command: DeviceCommand = {
        id: 'cmd-1',
        type: 'preview_content',
        payload: {
          asset_url: '/api/device/content/x/file',
          duration_seconds: 10,
        },
      };

      await handler.handleCommand(command);

      expect(downloader.download).not.toHaveBeenCalled();
      expect(engine.queuePreview).not.toHaveBeenCalled();
    });

    it('ignores when asset_url is missing', async () => {
      const command: DeviceCommand = {
        id: 'cmd-1',
        type: 'preview_content',
        payload: {
          content_id: 'content-uuid-1',
          duration_seconds: 10,
        },
      };

      await handler.handleCommand(command);

      expect(downloader.download).not.toHaveBeenCalled();
      expect(engine.queuePreview).not.toHaveBeenCalled();
    });
  });
});
