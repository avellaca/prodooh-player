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
        ? { printId: 'print-1', assetUrl: 'https://ssp.example.com/ad.mp4', durationSeconds: 10 }
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
});
