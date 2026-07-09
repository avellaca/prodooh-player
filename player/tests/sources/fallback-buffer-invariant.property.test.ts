/**
 * Property-based test: Fallback Buffer Invariant
 *
 * Simulates random sequences of getNext() and replenish() operations and verifies
 * that the buffer ALWAYS returns content (never null/undefined). The invariant
 * guarantees there is always at least one item available for display.
 *
 * **Validates: Requirements 4.1, 6.4**
 *
 * Requirement 4.1: Player must always have at least one local playlist item available.
 * Requirement 6.4: Maintain a secondary fallback buffer (at least one pre-decoded item
 *                  ready in memory at all times).
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { FallbackBuffer } from '../../src/sources/FallbackBuffer';
import type { PlaylistSource } from '../../src/sources/PlaylistSource';
import type { PreparedContent } from '../../src/sources/types';

/**
 * Creates a mock PlaylistSource that cycles through a given set of items.
 * If items is empty, prefetch() returns null (simulating empty playlist).
 */
function createMockPlaylistSource(items: PreparedContent[]): PlaylistSource {
  let index = 0;
  return {
    id: 'playlist',
    prefetch: vi.fn(async () => {
      if (items.length === 0) return null;
      if (index >= items.length) index = 0;
      const item = items[index]!;
      index++;
      return item;
    }),
    confirmPlay: vi.fn(async () => {}),
    reportFailure: vi.fn(async () => {}),
    isAvailable: vi.fn(() => items.length > 0),
  } as unknown as PlaylistSource;
}

/**
 * Creates a PreparedContent item for testing.
 */
function makePreparedContent(id: string): PreparedContent {
  return {
    id,
    type: 'image',
    source: 'playlist',
    mediaUrl: `/media/${id}.jpg`,
    duration: 10,
    metadata: { position: 0 },
  };
}

/** Arbitrary for the two possible operations on FallbackBuffer */
type BufferOp = { type: 'getNext' } | { type: 'replenish' };

const bufferOpArb: fc.Arbitrary<BufferOp> = fc.oneof(
  fc.constant({ type: 'getNext' } as BufferOp),
  fc.constant({ type: 'replenish' } as BufferOp),
);

/** Arbitrary for a sequence of operations */
const operationSequenceArb = fc.array(bufferOpArb, { minLength: 1, maxLength: 50 });

/** Arbitrary for playlist items (0 to 10 items, covering empty and non-empty playlists) */
const playlistItemsArb = fc.nat({ max: 10 }).map(count =>
  Array.from({ length: count }, (_, i) => makePreparedContent(`item-${i}`))
);

describe('Property 6: Fallback Buffer Invariant', () => {
  it('getNext() always returns valid PreparedContent, never null or undefined, regardless of operation sequence', async () => {
    await fc.assert(
      fc.asyncProperty(
        playlistItemsArb,
        operationSequenceArb,
        async (items, operations) => {
          const source = createMockPlaylistSource(items);
          const buffer = new FallbackBuffer({ playlistSource: source });

          // Initial replenish to fill the buffer
          await buffer.replenish();

          // Execute random sequence of operations
          for (const op of operations) {
            if (op.type === 'getNext') {
              const content = buffer.getNext();

              // INVARIANT: getNext() must NEVER return null or undefined
              expect(content).not.toBeNull();
              expect(content).not.toBeUndefined();

              // Verify the returned content has required fields
              expect(content).toHaveProperty('id');
              expect(content).toHaveProperty('type');
              expect(content).toHaveProperty('source');
              expect(content).toHaveProperty('mediaUrl');
              expect(content).toHaveProperty('duration');
              expect(content).toHaveProperty('metadata');
              expect(typeof content.id).toBe('string');
              expect(content.id.length).toBeGreaterThan(0);
              expect(content.duration).toBeGreaterThan(0);
            } else {
              // replenish
              await buffer.replenish();
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('getNext() returns content even without prior replenish (synchronous factory fallback)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: 20 }),
        async (callCount) => {
          // Empty playlist — no replenish ever called
          const source = createMockPlaylistSource([]);
          const buffer = new FallbackBuffer({ playlistSource: source });

          // Call getNext() multiple times without ever calling replenish first
          for (let i = 0; i <= callCount; i++) {
            const content = buffer.getNext();

            // INVARIANT: always returns content, falls back to factory
            expect(content).not.toBeNull();
            expect(content).not.toBeUndefined();
            expect(content.id).toBe('factory-prodooh-branding-landscape');
            expect(content.type).toBe('html');
            expect(content.duration).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('after draining the buffer completely, getNext() still returns content (never throws or returns undefined)', async () => {
    await fc.assert(
      fc.asyncProperty(
        playlistItemsArb,
        fc.nat({ max: 30 }).map(n => n + 1), // drainCount: 1..31
        async (items, drainCount) => {
          const source = createMockPlaylistSource(items);
          const buffer = new FallbackBuffer({ playlistSource: source });

          // Fill the buffer once
          await buffer.replenish();

          // Drain more times than items exist (forces empty buffer scenario)
          for (let i = 0; i < drainCount; i++) {
            const content = buffer.getNext();

            // INVARIANT: content is always valid
            expect(content).not.toBeNull();
            expect(content).not.toBeUndefined();
            expect(typeof content.id).toBe('string');
            expect(content.id.length).toBeGreaterThan(0);
            expect(typeof content.duration).toBe('number');
            expect(content.duration).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('interleaved getNext() and replenish() operations maintain the invariant across varying playlist sizes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: 5 }), // playlist size
        fc.array(
          fc.oneof(
            fc.constant('getNext' as const),
            fc.constant('replenish' as const),
            fc.constant('getNext' as const), // bias toward getNext to stress-test the invariant
            fc.constant('getNext' as const),
          ),
          { minLength: 5, maxLength: 30 }
        ),
        async (playlistSize, ops) => {
          const items = Array.from({ length: playlistSize }, (_, i) =>
            makePreparedContent(`content-${i}`)
          );
          const source = createMockPlaylistSource(items);
          const buffer = new FallbackBuffer({ playlistSource: source });

          // Execute operations
          for (const op of ops) {
            if (op === 'getNext') {
              const content = buffer.getNext();

              // Core invariant
              expect(content).toBeDefined();
              expect(content).not.toBeNull();
              expect(content.id).toBeTruthy();
              expect(content.duration).toBeGreaterThan(0);

              // Content must be either from playlist or factory fallback
              expect(['playlist']).toContain(content.source);
            } else {
              await buffer.replenish();
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
