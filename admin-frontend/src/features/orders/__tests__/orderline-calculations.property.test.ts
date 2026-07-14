/**
 * Property Tests for OrderLine Calculations
 *
 * Property 4: Validación de spots rechaza valores inválidos
 * Para cualquier valor numérico que sea menor a 1, no entero, o vacío,
 * el schema de validación de spots_input debe rechazarlo.
 * Para cualquier entero >= 1, debe aceptarlo.
 *
 * **Validates: Requirements 2.2**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { orderLineSchema } from '../schemas';
import { sumOrderLineSpots } from '../utils/orderline-calculations';

const spotsInputSchema = orderLineSchema.shape.spots_input;

describe('Property 4: Validación de spots rechaza valores inválidos', () => {
  /**
   * Property 4a: Integers >= 1 MUST be accepted by spots_input schema.
   */
  it('accepts integers >= 1', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), (value) => {
        const result = spotsInputSchema.safeParse(value);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe(value);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 4b: Numbers < 1 (zero and negatives) MUST be rejected.
   */
  it('rejects numbers less than 1 (zero and negative integers)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000, max: 0 }), (value) => {
        const result = spotsInputSchema.safeParse(value);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 4c: Non-integer numbers (floats) MUST be rejected.
   */
  it('rejects non-integer numbers (floats)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 100_000, noNaN: true, noDefaultInfinity: true }).filter(
          (v) => !Number.isInteger(v),
        ),
        (value) => {
          const result = spotsInputSchema.safeParse(value);
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 4d: Empty string and NaN MUST be rejected.
   */
  it('rejects empty string and NaN', () => {
    const invalidValues = ['', NaN];
    for (const value of invalidValues) {
      const result = spotsInputSchema.safeParse(value);
      expect(result.success).toBe(false);
    }
  });

  /**
   * Property 4e: String representations of valid integers >= 1 are accepted
   * (due to z.coerce.number() coercion behavior).
   */
  it('accepts string representations of valid integers >= 1 via coercion', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), (value) => {
        const result = spotsInputSchema.safeParse(String(value));
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe(value);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 4f: String representations of invalid numbers are rejected via coercion.
   */
  it('rejects string representations of numbers < 1 via coercion', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000, max: 0 }), (value) => {
        const result = spotsInputSchema.safeParse(String(value));
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});


// --- Property 3: Suma de spots con nulos ---

describe('Property 3: Suma de spots con nulos', () => {
  /**
   * **Validates: Requirements 3.1, 3.2, 3.3**
   *
   * Para cualquier array de objetos con campo target_spots (entero positivo o null),
   * sumOrderLineSpots debe retornar la suma de todos los valores no nulos,
   * tratando cada null como 0. Para un array vacío, debe retornar 0.
   */

  const targetSpotsArb = fc.oneof(fc.integer({ min: 1 }), fc.constant(null));
  const orderLinesArb = fc.array(
    fc.record({ target_spots: targetSpotsArb }),
  );

  it('suma correctamente target_spots tratando null como 0', () => {
    fc.assert(
      fc.property(orderLinesArb, (orderLines) => {
        const expected = orderLines.reduce(
          (sum, line) => sum + (line.target_spots ?? 0),
          0,
        );
        expect(sumOrderLineSpots(orderLines)).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('array vacío retorna 0', () => {
    expect(sumOrderLineSpots([])).toBe(0);
  });
});
