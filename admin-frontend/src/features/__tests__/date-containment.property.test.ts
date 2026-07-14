/**
 * Feature: 08-reingenieria-back-front, Property 3: Date Containment
 *
 * Property: Date Containment (jerarquía padre-hijo)
 * Para cualquier combinación de fechas de una entidad hija (OrderLine o Creative) que caen
 * fuera del rango de fechas de su entidad padre (Order o OrderLine respectivamente),
 * el sistema debe rechazar la operación. Específicamente:
 * - Si child.starts_at < parent.starts_at OR child.ends_at > parent.ends_at → REJECT
 * - Si child.starts_at >= parent.starts_at AND child.ends_at <= parent.ends_at → ACCEPT
 *
 * **Validates: Requirements 2.6, 3.5, 8.6, 9.6**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// --- Pure validation function ---

export interface DateRange {
  starts_at: string; // ISO date string (YYYY-MM-DD or full ISO)
  ends_at: string;   // ISO date string (YYYY-MM-DD or full ISO)
}

/**
 * Checks whether a child date range is fully contained within a parent date range.
 * Returns true (accept) if child is within parent bounds, false (reject) otherwise.
 */
export function isDateContained(parentRange: DateRange, childRange: DateRange): boolean {
  const parentStart = new Date(parentRange.starts_at).getTime();
  const parentEnd = new Date(parentRange.ends_at).getTime();
  const childStart = new Date(childRange.starts_at).getTime();
  const childEnd = new Date(childRange.ends_at).getTime();

  return childStart >= parentStart && childEnd <= parentEnd;
}

/**
 * Checks whether a single date (e.g., from active_dates) is contained within a parent range.
 * Returns true (accept) if date is within [parent.starts_at, parent.ends_at], false otherwise.
 */
export function isSingleDateContained(parentRange: DateRange, date: string): boolean {
  const parentStart = new Date(parentRange.starts_at).getTime();
  const parentEnd = new Date(parentRange.ends_at).getTime();
  const dateTs = new Date(date).getTime();

  return dateTs >= parentStart && dateTs <= parentEnd;
}

// --- Generators ---

/** Generate a valid date range where ends_at >= starts_at using day-level precision */
const validDateRangeArb = fc
  .tuple(
    fc.integer({ min: 0, max: 3650 }), // start offset in days from epoch baseline
    fc.integer({ min: 0, max: 365 }),   // duration in days (0 means same day)
  )
  .map(([startOffset, duration]) => {
    const baseline = new Date('2020-01-01T00:00:00Z');
    const startDate = new Date(baseline.getTime() + startOffset * 86400000);
    const endDate = new Date(startDate.getTime() + duration * 86400000);
    return {
      starts_at: startDate.toISOString().split('T')[0],
      ends_at: endDate.toISOString().split('T')[0],
    } as DateRange;
  });

/** Generate an arbitrary date range (may or may not be valid ordering) */
const arbitraryDateRangeArb = fc
  .tuple(
    fc.integer({ min: 0, max: 3650 }),
    fc.integer({ min: 0, max: 3650 }),
  )
  .map(([a, b]) => {
    const baseline = new Date('2020-01-01T00:00:00Z');
    const dateA = new Date(baseline.getTime() + a * 86400000);
    const dateB = new Date(baseline.getTime() + b * 86400000);
    // Keep ordering valid for child (ends >= starts)
    const start = a <= b ? dateA : dateB;
    const end = a <= b ? dateB : dateA;
    return {
      starts_at: start.toISOString().split('T')[0],
      ends_at: end.toISOString().split('T')[0],
    } as DateRange;
  });

/** Generate a child range guaranteed to be OUTSIDE parent range */
const childOutsideParentArb = (parentRange: DateRange) => {
  const parentStartTs = new Date(parentRange.starts_at).getTime();
  const parentEndTs = new Date(parentRange.ends_at).getTime();

  return fc.oneof(
    // Case 1: child starts before parent
    fc.integer({ min: 1, max: 365 }).map((daysBefore) => {
      const childStart = new Date(parentStartTs - daysBefore * 86400000);
      // child end can be anywhere (even within parent) — still invalid because start is out
      const childEnd = new Date(parentStartTs + Math.floor(Math.random() * 30) * 86400000);
      const actualEnd = childEnd.getTime() >= childStart.getTime() ? childEnd : childStart;
      return {
        starts_at: childStart.toISOString().split('T')[0],
        ends_at: actualEnd.toISOString().split('T')[0],
      } as DateRange;
    }),
    // Case 2: child ends after parent
    fc.integer({ min: 1, max: 365 }).map((daysAfter) => {
      const childEnd = new Date(parentEndTs + daysAfter * 86400000);
      // child start can be anywhere (even within parent) — still invalid because end is out
      const childStart = new Date(parentEndTs - Math.floor(Math.random() * 30) * 86400000);
      const actualStart = childStart.getTime() <= childEnd.getTime() ? childStart : childEnd;
      return {
        starts_at: actualStart.toISOString().split('T')[0],
        ends_at: childEnd.toISOString().split('T')[0],
      } as DateRange;
    }),
    // Case 3: child completely outside (both before)
    fc.tuple(fc.integer({ min: 1, max: 365 }), fc.integer({ min: 0, max: 30 })).map(([daysBefore, duration]) => {
      const childEnd = new Date(parentStartTs - daysBefore * 86400000);
      const childStart = new Date(childEnd.getTime() - duration * 86400000);
      return {
        starts_at: childStart.toISOString().split('T')[0],
        ends_at: childEnd.toISOString().split('T')[0],
      } as DateRange;
    }),
    // Case 4: child completely outside (both after)
    fc.tuple(fc.integer({ min: 1, max: 365 }), fc.integer({ min: 0, max: 30 })).map(([daysAfter, duration]) => {
      const childStart = new Date(parentEndTs + daysAfter * 86400000);
      const childEnd = new Date(childStart.getTime() + duration * 86400000);
      return {
        starts_at: childStart.toISOString().split('T')[0],
        ends_at: childEnd.toISOString().split('T')[0],
      } as DateRange;
    }),
  );
};

/** Generate a child range guaranteed to be INSIDE parent range */
const childInsideParentArb = (parentRange: DateRange) => {
  const parentStartTs = new Date(parentRange.starts_at).getTime();
  const parentEndTs = new Date(parentRange.ends_at).getTime();
  const parentDurationDays = Math.max(0, Math.floor((parentEndTs - parentStartTs) / 86400000));

  return fc
    .tuple(
      fc.integer({ min: 0, max: parentDurationDays }),
      fc.integer({ min: 0, max: parentDurationDays }),
    )
    .map(([a, b]) => {
      const offsetStart = Math.min(a, b);
      const offsetEnd = Math.max(a, b);
      const childStart = new Date(parentStartTs + offsetStart * 86400000);
      const childEnd = new Date(parentStartTs + offsetEnd * 86400000);
      return {
        starts_at: childStart.toISOString().split('T')[0],
        ends_at: childEnd.toISOString().split('T')[0],
      } as DateRange;
    });
};

// --- Property Tests ---

describe('Property 3: Date Containment (jerarquía padre-hijo)', () => {
  /**
   * Property 3a: If child dates fall outside parent range, validation MUST reject.
   * child.starts_at < parent.starts_at OR child.ends_at > parent.ends_at → reject
   */
  it('rejects child date ranges that fall outside parent range', () => {
    fc.assert(
      fc.property(
        validDateRangeArb.filter((r) => {
          // Ensure parent has at least 1 day duration for meaningful child-outside generation
          return new Date(r.ends_at).getTime() > new Date(r.starts_at).getTime();
        }),
        fc.integer({ min: 1, max: 365 }),
        fc.constantFrom('before-start', 'after-end', 'both-before', 'both-after') as fc.Arbitrary<string>,
        (parentRange, offset, violationType) => {
          const parentStartTs = new Date(parentRange.starts_at).getTime();
          const parentEndTs = new Date(parentRange.ends_at).getTime();

          let childRange: DateRange;

          switch (violationType) {
            case 'before-start': {
              // Child starts before parent, ends within
              const childStart = new Date(parentStartTs - offset * 86400000);
              const childEnd = new Date(parentStartTs); // at boundary or within
              childRange = {
                starts_at: childStart.toISOString().split('T')[0],
                ends_at: childEnd.toISOString().split('T')[0],
              };
              break;
            }
            case 'after-end': {
              // Child starts within, ends after parent
              const childStart = new Date(parentEndTs);
              const childEnd = new Date(parentEndTs + offset * 86400000);
              childRange = {
                starts_at: childStart.toISOString().split('T')[0],
                ends_at: childEnd.toISOString().split('T')[0],
              };
              break;
            }
            case 'both-before': {
              // Child entirely before parent
              const childEnd = new Date(parentStartTs - 86400000);
              const childStart = new Date(childEnd.getTime() - offset * 86400000);
              childRange = {
                starts_at: childStart.toISOString().split('T')[0],
                ends_at: childEnd.toISOString().split('T')[0],
              };
              break;
            }
            case 'both-after': {
              // Child entirely after parent
              const childStart = new Date(parentEndTs + 86400000);
              const childEnd = new Date(childStart.getTime() + offset * 86400000);
              childRange = {
                starts_at: childStart.toISOString().split('T')[0],
                ends_at: childEnd.toISOString().split('T')[0],
              };
              break;
            }
            default:
              throw new Error(`Unknown violation type: ${violationType}`);
          }

          // PROPERTY: validation MUST reject (return false)
          const result = isDateContained(parentRange, childRange);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3b: If child dates are within parent range, validation MUST accept.
   * child.starts_at >= parent.starts_at AND child.ends_at <= parent.ends_at → accept
   */
  it('accepts child date ranges that are fully contained within parent range', () => {
    fc.assert(
      fc.property(
        validDateRangeArb,
        fc.integer({ min: 0, max: 365 }),
        fc.integer({ min: 0, max: 365 }),
        (parentRange, offsetA, offsetB) => {
          const parentStartTs = new Date(parentRange.starts_at).getTime();
          const parentEndTs = new Date(parentRange.ends_at).getTime();
          const parentDurationDays = Math.floor((parentEndTs - parentStartTs) / 86400000);

          // Clamp offsets to parent duration to ensure child is inside
          const clampedA = parentDurationDays === 0 ? 0 : offsetA % (parentDurationDays + 1);
          const clampedB = parentDurationDays === 0 ? 0 : offsetB % (parentDurationDays + 1);
          const startOffset = Math.min(clampedA, clampedB);
          const endOffset = Math.max(clampedA, clampedB);

          const childRange: DateRange = {
            starts_at: new Date(parentStartTs + startOffset * 86400000).toISOString().split('T')[0],
            ends_at: new Date(parentStartTs + endOffset * 86400000).toISOString().split('T')[0],
          };

          // PROPERTY: validation MUST accept (return true)
          const result = isDateContained(parentRange, childRange);
          expect(result).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3c: Boundary cases — child at exact parent boundaries is valid.
   * A child that starts at parent.starts_at and ends at parent.ends_at MUST be accepted.
   */
  it('accepts child ranges exactly matching parent boundaries', () => {
    fc.assert(
      fc.property(
        validDateRangeArb,
        (parentRange) => {
          // Child exactly matches parent range
          const childRange: DateRange = {
            starts_at: parentRange.starts_at,
            ends_at: parentRange.ends_at,
          };

          const result = isDateContained(parentRange, childRange);
          expect(result).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3d: Single date containment (Creative active_dates scenario).
   * A single date within [parent.starts_at, parent.ends_at] is accepted;
   * a date outside is rejected.
   */
  it('rejects single dates outside parent range (active_dates scenario)', () => {
    fc.assert(
      fc.property(
        validDateRangeArb.filter((r) => {
          return new Date(r.ends_at).getTime() > new Date(r.starts_at).getTime();
        }),
        fc.integer({ min: 1, max: 365 }),
        fc.boolean(),
        (parentRange, offset, beforeNotAfter) => {
          const parentStartTs = new Date(parentRange.starts_at).getTime();
          const parentEndTs = new Date(parentRange.ends_at).getTime();

          const outsideDate = beforeNotAfter
            ? new Date(parentStartTs - offset * 86400000).toISOString().split('T')[0]
            : new Date(parentEndTs + offset * 86400000).toISOString().split('T')[0];

          // PROPERTY: validation MUST reject single date outside parent
          const result = isSingleDateContained(parentRange, outsideDate);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('accepts single dates within parent range (active_dates scenario)', () => {
    fc.assert(
      fc.property(
        validDateRangeArb,
        fc.integer({ min: 0, max: 3650 }),
        (parentRange, rawOffset) => {
          const parentStartTs = new Date(parentRange.starts_at).getTime();
          const parentEndTs = new Date(parentRange.ends_at).getTime();
          const parentDurationDays = Math.floor((parentEndTs - parentStartTs) / 86400000);

          // Clamp offset to be within parent duration
          const offset = parentDurationDays === 0 ? 0 : rawOffset % (parentDurationDays + 1);
          const insideDate = new Date(parentStartTs + offset * 86400000).toISOString().split('T')[0];

          // PROPERTY: validation MUST accept single date inside parent
          const result = isSingleDateContained(parentRange, insideDate);
          expect(result).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
