/**
 * Feature: 08-reingenieria-back-front, Property 5: Positive Integer Validation
 *
 * Para cualquier valor numérico proporcionado como `weight` en un Creativo,
 * el sistema (Zod schema frontend) debe aceptarlo sí y solo sí es un entero ≥ 1.
 * Valores como 0, negativos, decimales y no-numéricos deben ser rechazados.
 *
 * **Validates: Requirements 3.7, 9.7**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { creativeSchema } from '@/features/orders/schemas';

/**
 * Helper: builds a valid creative payload with a given weight value.
 * All other fields are valid so we isolate the weight validation.
 */
function makeCreativePayload(weight: number) {
  return {
    content_id: 'valid-content-id',
    weight,
  };
}

describe('Property 5: Positive Integer Validation (Weight)', () => {
  /**
   * Property: weight is accepted IF AND ONLY IF it is an integer >= 1
   */
  it('accepts any integer >= 1 as valid weight', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        (weight) => {
          const result = creativeSchema.safeParse(makeCreativePayload(weight));
          expect(result.success).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: zero is ALWAYS rejected as weight
   */
  it('rejects zero as weight', () => {
    const result = creativeSchema.safeParse(makeCreativePayload(0));
    expect(result.success).toBe(false);
  });

  /**
   * Property: negative integers are ALWAYS rejected as weight
   */
  it('rejects any negative integer as weight', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: -1 }),
        (weight) => {
          const result = creativeSchema.safeParse(makeCreativePayload(weight));
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: non-integer decimals are ALWAYS rejected as weight
   */
  it('rejects any non-integer decimal as weight', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1_000_000, noNaN: true, noDefaultInfinity: true }).filter(
          (n) => !Number.isInteger(n)
        ),
        (weight) => {
          const result = creativeSchema.safeParse(makeCreativePayload(weight));
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: negative decimals are ALWAYS rejected as weight
   */
  it('rejects any negative decimal as weight', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1_000_000, max: -0.01, noNaN: true, noDefaultInfinity: true }),
        (weight) => {
          const result = creativeSchema.safeParse(makeCreativePayload(weight));
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: the biconditional — weight accepted ⟺ integer >= 1
   * Uses a broad generator of arbitrary numbers to verify the if-and-only-if condition.
   */
  it('weight accepted IF AND ONLY IF it is an integer >= 1 (biconditional)', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -1000, max: 1000 }),
          fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
          fc.nat({ max: 500 })
        ),
        (weight) => {
          const result = creativeSchema.safeParse(makeCreativePayload(weight));
          const shouldBeValid = Number.isInteger(weight) && weight >= 1;

          expect(result.success).toBe(shouldBeValid);
        }
      ),
      { numRuns: 100 }
    );
  });
});
