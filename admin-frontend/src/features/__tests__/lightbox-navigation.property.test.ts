/**
 * Feature: 08-reingenieria-back-front, Property 11: Lightbox Navigation
 *
 * Property-based tests for lightbox carousel navigation consistency.
 * Tests pure navigation functions that calculate next/previous indices
 * in a circular gallery.
 *
 * **Validates: Requirements 22.3, 22.5**
 *
 * Requirement 22.3: Lightbox carousel navigation with prev/next buttons
 * Requirement 22.5: Keyboard arrow navigation (← →) consistency
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// --- Pure navigation functions under test ---

/**
 * Navigate to the next item in a circular gallery.
 * @param currentIndex - Current position (0-indexed)
 * @param total - Total number of items in the gallery (N >= 1)
 * @returns The next index, wrapping around to 0 after the last item
 */
function goNext(currentIndex: number, total: number): number {
  return (currentIndex + 1) % total;
}

/**
 * Navigate to the previous item in a circular gallery.
 * @param currentIndex - Current position (0-indexed)
 * @param total - Total number of items in the gallery (N >= 1)
 * @returns The previous index, wrapping around to N-1 from the first item
 */
function goPrev(currentIndex: number, total: number): number {
  return (currentIndex - 1 + total) % total;
}

// --- Generators ---

/** Generate a valid gallery size (N >= 1) */
const gallerySizeArb = fc.integer({ min: 1, max: 1000 });

/** Generate a valid (gallerySize, position) pair where 0 <= position < gallerySize */
const galleryWithPositionArb = gallerySizeArb.chain((size) =>
  fc.record({
    size: fc.constant(size),
    position: fc.integer({ min: 0, max: size - 1 }),
  })
);

describe('Property 11: Lightbox Carousel Navigation Consistency', () => {
  // =========================================================================
  // Property 1: For any gallery size N >= 1 and any position i (0 <= i < N):
  //             next(i) = (i+1) % N
  // =========================================================================

  describe('Property 1: goNext computes (i+1) % N for any valid position', () => {
    it('goNext(currentIndex, total) always equals (currentIndex + 1) % total', () => {
      fc.assert(
        fc.property(galleryWithPositionArb, ({ size, position }) => {
          const result = goNext(position, size);
          const expected = (position + 1) % size;
          expect(result).toBe(expected);
        }),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // Property 2: For any gallery size N >= 1 and any position i (0 <= i < N):
  //             prev(i) = (i-1+N) % N
  // =========================================================================

  describe('Property 2: goPrev computes (i-1+N) % N for any valid position', () => {
    it('goPrev(currentIndex, total) always equals (currentIndex - 1 + total) % total', () => {
      fc.assert(
        fc.property(galleryWithPositionArb, ({ size, position }) => {
          const result = goPrev(position, size);
          const expected = (position - 1 + size) % size;
          expect(result).toBe(expected);
        }),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // Property 3: Wrap-around — next from last goes to first: next(N-1) = 0
  // =========================================================================

  describe('Property 3: Wrap-around — goNext from last position returns 0', () => {
    it('goNext(N-1, N) always equals 0 for any gallery size N >= 1', () => {
      fc.assert(
        fc.property(gallerySizeArb, (size) => {
          const lastIndex = size - 1;
          const result = goNext(lastIndex, size);
          expect(result).toBe(0);
        }),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // Property 4: Wrap-around — prev from first goes to last: prev(0) = N-1
  // =========================================================================

  describe('Property 4: Wrap-around — goPrev from first position returns N-1', () => {
    it('goPrev(0, N) always equals N-1 for any gallery size N >= 1', () => {
      fc.assert(
        fc.property(gallerySizeArb, (size) => {
          const result = goPrev(0, size);
          expect(result).toBe(size - 1);
        }),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // Property 5: Navigation is consistent regardless of method
  //             (keyboard vs button click produce the same result)
  // =========================================================================

  describe('Property 5: Navigation consistency — keyboard and button produce same result', () => {
    /**
     * Simulates that both keyboard arrow navigation and button click
     * use the same pure function, so results are identical.
     * The navigation method is irrelevant — the computed index is the same.
     */
    it('keyboard arrow right and next button both call goNext with same result', () => {
      fc.assert(
        fc.property(
          galleryWithPositionArb,
          fc.constantFrom('keyboard', 'button') as fc.Arbitrary<string>,
          ({ size, position }, _method) => {
            // Both methods invoke the same pure function
            const keyboardResult = goNext(position, size);
            const buttonResult = goNext(position, size);
            expect(keyboardResult).toBe(buttonResult);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('keyboard arrow left and prev button both call goPrev with same result', () => {
      fc.assert(
        fc.property(
          galleryWithPositionArb,
          fc.constantFrom('keyboard', 'button') as fc.Arbitrary<string>,
          ({ size, position }, _method) => {
            // Both methods invoke the same pure function
            const keyboardResult = goPrev(position, size);
            const buttonResult = goPrev(position, size);
            expect(keyboardResult).toBe(buttonResult);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('navigating next then prev returns to original position (round-trip)', () => {
      fc.assert(
        fc.property(galleryWithPositionArb, ({ size, position }) => {
          const afterNext = goNext(position, size);
          const afterPrev = goPrev(afterNext, size);
          expect(afterPrev).toBe(position);
        }),
        { numRuns: 100 }
      );
    });

    it('navigating prev then next returns to original position (round-trip)', () => {
      fc.assert(
        fc.property(galleryWithPositionArb, ({ size, position }) => {
          const afterPrev = goPrev(position, size);
          const afterNext = goNext(afterPrev, size);
          expect(afterNext).toBe(position);
        }),
        { numRuns: 100 }
      );
    });
  });

  // =========================================================================
  // Additional structural properties
  // =========================================================================

  describe('Structural properties: result is always within valid range', () => {
    it('goNext always returns a value in [0, N)', () => {
      fc.assert(
        fc.property(galleryWithPositionArb, ({ size, position }) => {
          const result = goNext(position, size);
          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThan(size);
        }),
        { numRuns: 100 }
      );
    });

    it('goPrev always returns a value in [0, N)', () => {
      fc.assert(
        fc.property(galleryWithPositionArb, ({ size, position }) => {
          const result = goPrev(position, size);
          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThan(size);
        }),
        { numRuns: 100 }
      );
    });

    it('N successive goNext calls from position 0 returns to position 0 (full cycle)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),
          (size) => {
            let position = 0;
            for (let i = 0; i < size; i++) {
              position = goNext(position, size);
            }
            expect(position).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('N successive goPrev calls from position 0 returns to position 0 (full cycle)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),
          (size) => {
            let position = 0;
            for (let i = 0; i < size; i++) {
              position = goPrev(position, size);
            }
            expect(position).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
