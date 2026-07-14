/**
 * Property Tests for Frontend Validation Schemas (Properties 5, 6)
 *
 * Property 5: Validación de weight como entero positivo
 * Para cualquier valor arbitrario, solo enteros >= 1 pasan la validación del campo weight.
 *
 * Property 6: Contención de active_dates en rango de OrderLine
 * Para cualquier conjunto de fechas y un rango de OrderLine, solo conjuntos donde
 * TODAS las fechas caen dentro del rango [starts_at, ends_at] son aceptados.
 *
 * **Validates: Requirements 4.6, 4.7, 13.5**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { creativeForTargetSchema, bulkByResolutionSchema } from '../schemas';

// --- Helper: date containment check (same logic as backend) ---

/**
 * Checks if ALL dates in the array fall within [starts_at, ends_at] (inclusive).
 */
function allDatesContained(
  orderLineRange: { starts_at: string; ends_at: string },
  dates: string[],
): boolean {
  const rangeStart = new Date(orderLineRange.starts_at).getTime();
  const rangeEnd = new Date(orderLineRange.ends_at).getTime();

  return dates.every((d) => {
    const ts = new Date(d).getTime();
    return ts >= rangeStart && ts <= rangeEnd;
  });
}

// --- Generators ---

/** Generate a valid OrderLine date range (starts_at <= ends_at, at least 1 day) */
const orderLineRangeArb = fc
  .tuple(
    fc.integer({ min: 0, max: 1000 }), // start offset in days from baseline
    fc.integer({ min: 1, max: 90 }),    // duration in days (at least 1)
  )
  .map(([startOffset, duration]) => {
    const baseline = new Date('2024-01-01T00:00:00Z');
    const startDate = new Date(baseline.getTime() + startOffset * 86400000);
    const endDate = new Date(startDate.getTime() + duration * 86400000);
    return {
      starts_at: startDate.toISOString().split('T')[0],
      ends_at: endDate.toISOString().split('T')[0],
    };
  });

/** Generate a set of dates ALL within the given OrderLine range */
function datesInsideRangeArb(range: { starts_at: string; ends_at: string }) {
  const rangeStartTs = new Date(range.starts_at).getTime();
  const rangeEndTs = new Date(range.ends_at).getTime();
  const durationDays = Math.floor((rangeEndTs - rangeStartTs) / 86400000);

  return fc
    .array(fc.integer({ min: 0, max: durationDays }), { minLength: 1, maxLength: 10 })
    .map((offsets) =>
      offsets.map(
        (offset) => new Date(rangeStartTs + offset * 86400000).toISOString().split('T')[0],
      ),
    );
}

/** Generate a set of dates where AT LEAST ONE is outside the given OrderLine range */
function datesWithOutsideArb(range: { starts_at: string; ends_at: string }) {
  const rangeStartTs = new Date(range.starts_at).getTime();
  const rangeEndTs = new Date(range.ends_at).getTime();
  const durationDays = Math.floor((rangeEndTs - rangeStartTs) / 86400000);

  // Generate one date guaranteed to be outside, plus optionally some inside dates
  const outsideDateArb = fc.oneof(
    // Before range start
    fc.integer({ min: 1, max: 365 }).map(
      (daysBefore) => new Date(rangeStartTs - daysBefore * 86400000).toISOString().split('T')[0],
    ),
    // After range end
    fc.integer({ min: 1, max: 365 }).map(
      (daysAfter) => new Date(rangeEndTs + daysAfter * 86400000).toISOString().split('T')[0],
    ),
  );

  const insideDatesArb = fc
    .array(fc.integer({ min: 0, max: durationDays }), { minLength: 0, maxLength: 5 })
    .map((offsets) =>
      offsets.map(
        (offset) => new Date(rangeStartTs + offset * 86400000).toISOString().split('T')[0],
      ),
    );

  return fc.tuple(outsideDateArb, insideDatesArb).map(([outside, inside]) => {
    // Shuffle so the outside date isn't always first
    const all = [outside, ...inside];
    return all.sort(() => Math.random() - 0.5);
  });
}

// --- Property Tests ---

describe('Property 5: Weight validation (entero positivo >= 1)', () => {
  const weightSchemaTarget = creativeForTargetSchema.shape.weight;
  const weightSchemaBulk = bulkByResolutionSchema.shape.weight;

  /**
   * Property 5a: Valid integers >= 1 MUST pass weight validation.
   */
  it('accepts integers >= 1 in creativeForTargetSchema', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10000 }), (value) => {
        const result = weightSchemaTarget.safeParse(value);
        expect(result.success).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it('accepts integers >= 1 in bulkByResolutionSchema', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10000 }), (value) => {
        const result = weightSchemaBulk.safeParse(value);
        expect(result.success).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * Property 5b: Zero and negative integers MUST be rejected.
   */
  it('rejects zero and negative integers', () => {
    fc.assert(
      fc.property(fc.integer({ min: -10000, max: 0 }), (value) => {
        const result = weightSchemaTarget.safeParse(value);
        expect(result.success).toBe(false);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * Property 5c: Non-integer numbers (floats) MUST be rejected.
   */
  it('rejects floating point numbers', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 10000, noNaN: true, noDefaultInfinity: true }).filter(
          (v) => !Number.isInteger(v),
        ),
        (value) => {
          const result = weightSchemaTarget.safeParse(value);
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * Property 5d: Non-number types MUST be rejected.
   */
  it('rejects non-number types (strings, booleans, null, undefined, objects)', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.boolean(),
          fc.constant(null),
          fc.constant(undefined),
          fc.object(),
          fc.array(fc.integer()),
        ),
        (value) => {
          const result = weightSchemaTarget.safeParse(value);
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe('Property 6: Date containment in OrderLine range', () => {
  /**
   * Property 6a: When ALL active_dates fall within OrderLine [starts_at, ends_at],
   * the containment check MUST accept.
   */
  it('accepts date sets where all dates are within OrderLine range', () => {
    fc.assert(
      fc.property(
        orderLineRangeArb.chain((range) =>
          datesInsideRangeArb(range).map((dates) => ({ range, dates })),
        ),
        ({ range, dates }) => {
          const result = allDatesContained(range, dates);
          expect(result).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * Property 6b: When at least one active_date falls outside OrderLine range,
   * the containment check MUST reject.
   */
  it('rejects date sets where at least one date is outside OrderLine range', () => {
    fc.assert(
      fc.property(
        orderLineRangeArb.chain((range) =>
          datesWithOutsideArb(range).map((dates) => ({ range, dates })),
        ),
        ({ range, dates }) => {
          const result = allDatesContained(range, dates);
          expect(result).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * Property 6c: Boundary dates (exactly starts_at and ends_at) MUST be accepted.
   */
  it('accepts dates exactly at OrderLine boundaries', () => {
    fc.assert(
      fc.property(orderLineRangeArb, (range) => {
        // Dates at both boundaries
        const dates = [range.starts_at, range.ends_at];
        const result = allDatesContained(range, dates);
        expect(result).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  // Property 6d and 6e removed: active_dates no longer exists on creativeForTargetSchema
  // (migrated to orderLineSchema per Requirement 4.6)
});
