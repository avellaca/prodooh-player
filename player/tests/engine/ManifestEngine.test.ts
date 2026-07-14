/**
 * Unit tests for ManifestEngine.
 *
 * Validates: Requirements 10.2, 10.3, 10.4, 10.5, 10.6, 10.7
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ManifestEngine, type PlaybackResult } from '../../src/engine/ManifestEngine';
import type { Manifest, ManifestItem } from '../../src/sync/ManifestSyncManager';
import type { SspPrefetcher } from '../../src/engine/SspPrefetcher';

// --- Helpers ---

function createManifest(items: ManifestItem[]): Manifest {
  return {
    version: 'test-v1',
    generated_at: '2026-01-01T00:00:00Z',
    items,
  };
}

function createOrderLineCreativeItem(position: number): ManifestItem {
  return {
    position,
    type: 'order_line_creative',
    duration_seconds: 10,
    asset_url: 'https://cdn.example.com/creative.mp4',
    checksum_sha256: 'abc123',
    order_line_id: `ol-${position}`,
    creative_id: `cr-${position}`,
  };
}

function createPlaylistItem(position: number): ManifestItem {
  return {
    position,
    type: 'playlist_item',
    duration_seconds: 10,
    asset_url: 'https://cdn.example.com/playlist.jpg',
    checksum_sha256: 'def456',
    playlist_item_id: `pl-${position}`,
  };
}

function createSspCallItem(position: number): ManifestItem {
  return {
    position,
    type: 'prodooh_ssp_call',
    duration_seconds: 10,
  };
}

/**
 * Creates a mock SspPrefetcher with configurable behavior.
 */
function createMockSspPrefetcher(opts: { isReady: boolean } = { isReady: false }): SspPrefetcher {
  return {
    prefetch: vi.fn().mockResolvedValue(null),
    expire: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn(),
    isReady: vi.fn().mockReturnValue(opts.isReady),
    getContent: vi.fn().mockReturnValue(
      opts.isReady
        ? { printId: 'print-1', assetUrl: 'https://ssp.example.com/ad.mp4', durationSeconds: 10, popUrl: 'https://ssp.example.com/pop/print-1', expireUrl: 'https://ssp.example.com/expire/print-1' }
        : null,
    ),
  };
}

// --- Tests ---

describe('ManifestEngine', () => {
  let playbackFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    playbackFn = vi.fn().mockResolvedValue('success' as PlaybackResult);
  });

  describe('order_line_creative emits impression on completion', () => {
    it('calls onItemComplete with item and success for order_line_creative', async () => {
      const item = createOrderLineCreativeItem(0);
      const manifest = createManifest([item]);
      const onItemComplete = vi.fn();

      let playCount = 0;
      const engine = new ManifestEngine({
        manifest,
        onItemComplete,
        playbackFn: async (i) => {
          playCount++;
          if (playCount >= 1) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      expect(onItemComplete).toHaveBeenCalledTimes(1);
      expect(onItemComplete).toHaveBeenCalledWith(item, 'success');
    });
  });

  describe('playlist_item does not emit impression', () => {
    it('does NOT call onItemComplete for playlist_item', async () => {
      const item = createPlaylistItem(0);
      const manifest = createManifest([item]);
      const onItemComplete = vi.fn();

      let playCount = 0;
      const engine = new ManifestEngine({
        manifest,
        onItemComplete,
        playbackFn: async () => {
          playCount++;
          if (playCount >= 1) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      expect(onItemComplete).not.toHaveBeenCalled();
    });
  });

  describe('prodooh_ssp_call with fallback to playlist if SSP not ready', () => {
    it('falls back to playlist_item when SSP is not ready', async () => {
      const sspItem = createSspCallItem(0);
      const playlistFallback = createPlaylistItem(1);
      const manifest = createManifest([sspItem, playlistFallback]);

      const sspPrefetcher = createMockSspPrefetcher({ isReady: false });
      const playedItems: ManifestItem[] = [];

      let playCount = 0;
      const engine = new ManifestEngine({
        manifest,
        sspPrefetcher,
        playbackFn: async (item) => {
          playedItems.push(item);
          playCount++;
          if (playCount >= 1) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      // The fallback playlist item should have been played
      expect(playedItems.length).toBe(1);
      expect(playedItems[0]!.type).toBe('playlist_item');
    });
  });

  describe('prefetch of next SSP item', () => {
    it('calls sspPrefetcher.prefetch when next item is prodooh_ssp_call', async () => {
      const firstItem = createOrderLineCreativeItem(0);
      const sspItem = createSspCallItem(1);
      const manifest = createManifest([firstItem, sspItem]);

      const sspPrefetcher = createMockSspPrefetcher({ isReady: false });

      let playCount = 0;
      const engine = new ManifestEngine({
        manifest,
        sspPrefetcher,
        playbackFn: async () => {
          playCount++;
          if (playCount >= 1) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      // prefetch should have been called for the next item (sspItem) during play of firstItem
      expect(sspPrefetcher.prefetch).toHaveBeenCalledWith(sspItem.duration_seconds);
    });
  });

  describe('atomic swap on new manifest', () => {
    it('resets index to 0 and plays new items after updateManifest', async () => {
      const item1 = createOrderLineCreativeItem(0);
      const item2 = createPlaylistItem(1);
      const originalManifest = createManifest([item1, item2]);

      const newItem = createOrderLineCreativeItem(0);
      newItem.order_line_id = 'new-ol-0';
      newItem.creative_id = 'new-cr-0';
      const newManifest: Manifest = {
        version: 'test-v2',
        generated_at: '2026-01-02T00:00:00Z',
        items: [newItem],
      };

      const playedItems: ManifestItem[] = [];
      let playCount = 0;

      const engine = new ManifestEngine({
        manifest: originalManifest,
        playbackFn: async (item) => {
          playedItems.push(item);
          playCount++;

          // After playing 2 items from original, swap manifest
          if (playCount === 2) {
            engine.updateManifest(newManifest);
          }

          // After playing one from new manifest, stop
          if (playCount >= 3) {
            engine.stop();
          }

          return 'success';
        },
      });

      await engine.run();

      // First 2 items from original manifest
      expect(playedItems[0]!.order_line_id).toBe('ol-0');
      expect(playedItems[1]!.type).toBe('playlist_item');

      // Third item should be from the new manifest (index reset to 0)
      expect(playedItems[2]!.order_line_id).toBe('new-ol-0');

      // Engine index should have reset
      // After stop, currentIndex will be 1 (advanced after playing index 0 of new manifest)
      // but the important thing is we got the right items
      expect(playedItems.length).toBe(3);
    });
  });

  describe('reproduces indefinitely offline (loop resilience)', () => {
    it('loops through items correctly without any network dependency', async () => {
      const item0 = createOrderLineCreativeItem(0);
      const item1 = createPlaylistItem(1);
      const item2 = createOrderLineCreativeItem(2);
      const manifest = createManifest([item0, item1, item2]);

      const playedPositions: number[] = [];
      let playCount = 0;
      const totalPlays = 9; // 3 full loops

      const engine = new ManifestEngine({
        manifest,
        playbackFn: async (item) => {
          playedPositions.push(item.position);
          playCount++;
          if (playCount >= totalPlays) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      expect(playedPositions.length).toBe(totalPlays);

      // Verify correct looping: 0, 1, 2, 0, 1, 2, 0, 1, 2
      for (let i = 0; i < totalPlays; i++) {
        expect(playedPositions[i]).toBe(i % 3);
      }
    });
  });

  describe('preview_content playback (Req 21.4, 21.5)', () => {
    it('plays preview item after current item finishes, then resumes manifest from same position', async () => {
      const item0 = createOrderLineCreativeItem(0);
      const item1 = createOrderLineCreativeItem(1);
      const item2 = createOrderLineCreativeItem(2);
      const manifest = createManifest([item0, item1, item2]);

      const playedItems: ManifestItem[] = [];
      const onItemComplete = vi.fn();
      let playCount = 0;

      const engine = new ManifestEngine({
        manifest,
        onItemComplete,
        playbackFn: async (item) => {
          playedItems.push(item);
          playCount++;

          // After playing item at position 0, queue a preview
          if (playCount === 1) {
            engine.queuePreview({
              content_id: 'preview-1',
              asset_url: '/api/device/content/preview-1/file',
              local_url: 'blob:preview-local',
              duration_seconds: 5,
            });
          }

          // Stop after playing: item0, preview, item1
          if (playCount >= 3) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      expect(playedItems.length).toBe(3);

      // First item: normal manifest item at position 0
      expect(playedItems[0]!.position).toBe(0);
      expect(playedItems[0]!.type).toBe('order_line_creative');

      // Second item: the preview (position -1, playlist_item type)
      expect(playedItems[1]!.position).toBe(-1);
      expect(playedItems[1]!.asset_url).toBe('blob:preview-local');
      expect(playedItems[1]!.duration_seconds).toBe(5);

      // Third item: resumes manifest from position 1 (not 0 again)
      expect(playedItems[2]!.position).toBe(1);
      expect(playedItems[2]!.type).toBe('order_line_creative');
    });

    it('does NOT emit onItemComplete for preview playback (no impression)', async () => {
      const item0 = createOrderLineCreativeItem(0);
      const manifest = createManifest([item0]);

      const onItemComplete = vi.fn();
      let playCount = 0;

      const engine = new ManifestEngine({
        manifest,
        onItemComplete,
        playbackFn: async () => {
          playCount++;

          // Queue preview after first item
          if (playCount === 1) {
            engine.queuePreview({
              content_id: 'preview-1',
              asset_url: '/preview',
              local_url: 'blob:preview',
              duration_seconds: 5,
            });
          }

          // Stop after preview is played
          if (playCount >= 2) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      // onItemComplete should only be called once (for the order_line_creative item)
      // NOT for the preview
      expect(onItemComplete).toHaveBeenCalledTimes(1);
      expect(onItemComplete).toHaveBeenCalledWith(item0, 'success');
    });

    it('plays preview only ONCE even if no other items are queued', async () => {
      const item0 = createOrderLineCreativeItem(0);
      const item1 = createOrderLineCreativeItem(1);
      const manifest = createManifest([item0, item1]);

      const playedItems: ManifestItem[] = [];
      let playCount = 0;

      const engine = new ManifestEngine({
        manifest,
        playbackFn: async (item) => {
          playedItems.push(item);
          playCount++;

          // Queue preview after first play
          if (playCount === 1) {
            engine.queuePreview({
              content_id: 'preview-1',
              asset_url: '/preview',
              local_url: 'blob:preview',
              duration_seconds: 5,
            });
          }

          // Stop after 4 plays: item0, preview, item1, item0
          if (playCount >= 4) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      // Preview should appear exactly once (at position 1 in the sequence)
      const previewPlays = playedItems.filter(i => i.position === -1);
      expect(previewPlays.length).toBe(1);

      // After preview, manifest continues from where it left off (position 1)
      expect(playedItems[2]!.position).toBe(1);
      // Then wraps around to position 0
      expect(playedItems[3]!.position).toBe(0);
    });

    it('emits onItemStart for preview items (so renderer can display them)', async () => {
      const item0 = createOrderLineCreativeItem(0);
      const manifest = createManifest([item0]);

      const onItemStart = vi.fn();
      let playCount = 0;

      const engine = new ManifestEngine({
        manifest,
        onItemStart,
        playbackFn: async () => {
          playCount++;
          if (playCount === 1) {
            engine.queuePreview({
              content_id: 'p1',
              asset_url: '/p',
              local_url: 'blob:p',
              duration_seconds: 5,
            });
          }
          if (playCount >= 2) engine.stop();
          return 'success';
        },
      });

      await engine.run();

      // onItemStart called for both the manifest item and the preview
      expect(onItemStart).toHaveBeenCalledTimes(2);
      // Second call should be the preview item
      const previewCall = onItemStart.mock.calls[1]![0] as ManifestItem;
      expect(previewCall.position).toBe(-1);
      expect(previewCall.asset_url).toBe('blob:p');
    });
  });
});
