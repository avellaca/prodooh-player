/**
 * Property-based test: ManifestEngine Sequential Loop Playback
 *
 * **Validates: Requirements 10.1**
 *
 * Property 17: Sequential loop playback — For any manifest of N items,
 * the ManifestEngine plays items in strict sequential order (0, 1, ..., N-1)
 * and wraps back to position 0 after completing position N-1, continuously.
 *
 * Uses fast-check to generate random manifests (1–50 items) and verifies
 * the engine plays them in the correct sequential order across multiple cycles.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ManifestEngine } from '../../src/engine/ManifestEngine';
import type { Manifest, ManifestItem } from '../../src/sync/ManifestSyncManager';

// --- Arbitraries ---

/**
 * Generate a random ManifestItem type.
 */
const itemTypeArb = fc.constantFrom(
  'order_line_creative' as const,
  'prodooh_ssp_call' as const,
  'playlist_item' as const,
);

/**
 * Generate a random manifest with N items (1–50).
 * Each item has a position, random type, and a fixed duration.
 * Ensures at least one playlist_item exists so that prodooh_ssp_call
 * can fall back to it (avoiding real delay in tests).
 */
const manifestArb = fc.integer({ min: 1, max: 50 }).chain((n) =>
  fc.tuple(
    fc.array(itemTypeArb, { minLength: n, maxLength: n }),
    fc.integer({ min: 2, max: 3 }), // number of full cycles to run
  ).map(([types, cycles]) => {
    // Ensure at least one playlist_item exists for SSP fallback
    const hasPlaylist = types.some((t) => t === 'playlist_item');
    if (!hasPlaylist && types.length > 0) {
      types[0] = 'playlist_item';
    }

    return {
      manifest: {
        version: `test-v1-${n}`,
        generated_at: '2026-07-09T00:00:00Z',
        items: types.map((type, i) => ({
          position: i,
          type,
          duration_seconds: 1,
          // Add required fields per type
          ...(type === 'order_line_creative' ? {
            asset_url: `https://cdn.example.com/${i}.mp4`,
            checksum_sha256: `sha256-${i}`,
            order_line_id: `ol-${i}`,
            creative_id: `cr-${i}`,
          } : {}),
          ...(type === 'playlist_item' ? {
            asset_url: `https://cdn.example.com/playlist-${i}.jpg`,
            checksum_sha256: `sha256-pl-${i}`,
            playlist_item_id: `pl-${i}`,
          } : {}),
        })) as ManifestItem[],
      } satisfies Manifest,
      cycles,
      n,
    };
  }),
);

describe('Property 17: Sequential loop playback', () => {
  it('plays items in strict order 0..N-1 and wraps to 0 after N-1', async () => {
    await fc.assert(
      fc.asyncProperty(
        manifestArb,
        async ({ manifest, cycles, n }) => {
          const playedPositions: number[] = [];
          const totalItemsToPlay = n * cycles;
          let itemsPlayed = 0;

          const engine = new ManifestEngine({
            manifest,
            onItemStart: (item: ManifestItem) => {
              playedPositions.push(item.position);
              itemsPlayed++;
              // Stop after enough iterations
              if (itemsPlayed >= totalItemsToPlay) {
                engine.stop();
              }
            },
            // Immediate playback — no real delay
            playbackFn: async () => 'success',
          });

          await engine.run();

          // Assert: we played the expected number of items
          expect(playedPositions.length).toBe(totalItemsToPlay);

          // Assert: items played in strict sequential order 0, 1, ..., N-1, 0, 1, ...
          for (let i = 0; i < totalItemsToPlay; i++) {
            const expectedPosition = i % n;
            expect(playedPositions[i]).toBe(expectedPosition);
          }

          // Assert: wraps correctly from N-1 back to 0
          // Check each cycle boundary (end of cycle → start of next)
          for (let cycle = 0; cycle < cycles - 1; cycle++) {
            const lastInCycle = playedPositions[cycle * n + (n - 1)];
            const firstInNextCycle = playedPositions[(cycle + 1) * n];
            expect(lastInCycle).toBe(n - 1);
            expect(firstInNextCycle).toBe(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('getCurrentIndex reflects sequential advancement and wraps correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 2, max: 4 }),
        async (n, cycles) => {
          const manifest: Manifest = {
            version: `idx-test-${n}`,
            generated_at: '2026-07-09T00:00:00Z',
            items: Array.from({ length: n }, (_, i) => ({
              position: i,
              type: 'playlist_item' as const,
              duration_seconds: 1,
              asset_url: `https://cdn.example.com/${i}.jpg`,
              checksum_sha256: `sha-${i}`,
              playlist_item_id: `pl-${i}`,
            })),
          };

          const observedIndices: number[] = [];
          const totalItems = n * cycles;
          let count = 0;

          const engine = new ManifestEngine({
            manifest,
            onItemStart: () => {
              observedIndices.push(engine.getCurrentIndex());
              count++;
              if (count >= totalItems) {
                engine.stop();
              }
            },
            playbackFn: async () => 'success',
          });

          await engine.run();

          // Verify getCurrentIndex tracks sequential progress
          expect(observedIndices.length).toBe(totalItems);
          for (let i = 0; i < totalItems; i++) {
            expect(observedIndices[i]).toBe(i % n);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
