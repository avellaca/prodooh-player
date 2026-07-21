/**
 * Feature: 08-reingenieria-back-front, Property 4: Enum Validation Strictness
 *
 * Para cualquier string arbitrario proporcionado como `priority_tier`, el sistema debe
 * aceptarlo sí y solo sí pertenece al conjunto {"patrocinio", "estandar", "red_interna"}.
 * Para cualquier string arbitrario proporcionado como `delivery_pace`, debe aceptarlo
 * sí y solo sí pertenece al conjunto {"asap", "uniform"}.
 * Todo valor fuera de estos conjuntos debe resultar en error de validación.
 *
 * **Validates: Requirements 2.7, 2.8**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { orderLineSchema } from '@/features/orders/schemas';

const VALID_PRIORITY_TIERS = ['patrocinio', 'estandar', 'red_interna'] as const;
const VALID_DELIVERY_PACES = ['asap', 'uniform'] as const;

/**
 * Helper: builds a valid OrderLine base object so we can isolate
 * the field under test without other validation failures.
 */
function buildValidOrderLineBase() {
  return {
    name: 'Test Line',
    active_dates: ['2025-01-01'],
    spots_mode: 'spots_por_linea' as const,
    spots_input: 10,
    status: 'draft' as const,
  };
}

describe('Property 4: Enum Validation Strictness', () => {
  describe('priority_tier enum validation', () => {
    it('accepts ONLY valid priority_tier values: patrocinio, estandar, red_interna', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...VALID_PRIORITY_TIERS),
          (validTier) => {
            const input = {
              ...buildValidOrderLineBase(),
              priority_tier: validTier,
              delivery_pace: 'asap' as const,
            };

            const result = orderLineSchema.safeParse(input);
            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects all arbitrary strings that are not valid priority_tier values', () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => !VALID_PRIORITY_TIERS.includes(s as typeof VALID_PRIORITY_TIERS[number])),
          (invalidTier) => {
            const input = {
              ...buildValidOrderLineBase(),
              priority_tier: invalidTier,
              delivery_pace: 'asap',
            };

            const result = orderLineSchema.safeParse(input);
            expect(result.success).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('delivery_pace enum validation', () => {
    it('accepts ONLY valid delivery_pace values: asap, uniform', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...VALID_DELIVERY_PACES),
          (validPace) => {
            const input = {
              ...buildValidOrderLineBase(),
              priority_tier: 'estandar' as const,
              delivery_pace: validPace,
            };

            const result = orderLineSchema.safeParse(input);
            expect(result.success).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('rejects all arbitrary strings that are not valid delivery_pace values', () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => !VALID_DELIVERY_PACES.includes(s as typeof VALID_DELIVERY_PACES[number])),
          (invalidPace) => {
            const input = {
              ...buildValidOrderLineBase(),
              priority_tier: 'estandar',
              delivery_pace: invalidPace,
            };

            const result = orderLineSchema.safeParse(input);
            expect(result.success).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
