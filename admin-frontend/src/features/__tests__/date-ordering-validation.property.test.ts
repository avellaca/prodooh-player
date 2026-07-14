/**
 * Feature: 08-reingenieria-back-front, Property 2: Date Ordering Validation
 *
 * Generar pares de fechas arbitrarios; verificar que Zod schema rechaza ends_at < starts_at
 * y acepta ends_at >= starts_at.
 *
 * **Validates: Requirements 1.6, 7.6**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { orderSchema } from '@/features/orders/schemas';

/**
 * Helper: Format a Date as YYYY-MM-DD string
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Build a valid order payload with the given date pair.
 * All other fields are valid so the only variable under test is the date ordering.
 */
function buildOrderPayload(startsAt: string, endsAt: string) {
  return {
    name: 'Test Order',
    advertiser_name: null,
    starts_at: startsAt,
    ends_at: endsAt,
    status: 'draft' as const,
  };
}

describe('Property 2: Date Ordering Validation', () => {
  /**
   * Property: For any pair of dates where ends_at < starts_at,
   * the orderSchema MUST reject the input (safeParse fails).
   */
  it('rejects orders where ends_at < starts_at', () => {
    const validDate = fc.integer({
      min: new Date('2020-01-01').getTime(),
      max: new Date('2030-12-31').getTime(),
    }).map((ts) => new Date(ts));

    fc.assert(
      fc.property(
        validDate,
        validDate,
        (dateA, dateB) => {
          // Ensure starts_at is strictly after ends_at (invalid ordering)
          const [later, earlier] = dateA.getTime() > dateB.getTime()
            ? [dateA, dateB]
            : [dateB, dateA];

          // Skip if dates are the same day (equal dates are valid)
          const laterStr = formatDate(later);
          const earlierStr = formatDate(earlier);
          if (laterStr === earlierStr) return; // skip equal dates

          // starts_at = later date, ends_at = earlier date → invalid
          const payload = buildOrderPayload(laterStr, earlierStr);
          const result = orderSchema.safeParse(payload);

          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: For any pair of dates where ends_at >= starts_at,
   * the orderSchema MUST accept the input (safeParse succeeds), given valid fields.
   */
  it('accepts orders where ends_at >= starts_at', () => {
    const validDate = fc.integer({
      min: new Date('2020-01-01').getTime(),
      max: new Date('2030-12-31').getTime(),
    }).map((ts) => new Date(ts));

    fc.assert(
      fc.property(
        validDate,
        validDate,
        (dateA, dateB) => {
          // Ensure starts_at <= ends_at (valid ordering)
          const [earlier, later] = dateA.getTime() <= dateB.getTime()
            ? [dateA, dateB]
            : [dateB, dateA];

          const startsAtStr = formatDate(earlier);
          const endsAtStr = formatDate(later);

          const payload = buildOrderPayload(startsAtStr, endsAtStr);
          const result = orderSchema.safeParse(payload);

          expect(result.success).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
