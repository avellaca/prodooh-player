// Feature: 08-reingenieria-back-front, Property 6: Target XOR Constraint

/**
 * Property 6: Target XOR Constraint
 *
 * For any OrderLineTarget creation payload, the system must accept it if and only if
 * exactly one of `screen_id` or `screen_group_id` is present and non-null.
 * If both are present, or if neither is present, it must reject with error 422.
 *
 * **Validates: Requirements 4.3, 4.4**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// --- Pure validation function implementing the XOR logic ---

export interface TargetInput {
  screen_id?: string | null;
  screen_group_id?: string | null;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates that exactly one of screen_id or screen_group_id is present and non-null.
 * This mirrors the backend XOR constraint for OrderLineTarget creation.
 */
export function validateTargetXor(input: TargetInput): ValidationResult {
  const hasScreenId = input.screen_id != null && input.screen_id !== undefined;
  const hasScreenGroupId = input.screen_group_id != null && input.screen_group_id !== undefined;

  if (hasScreenId && hasScreenGroupId) {
    return {
      valid: false,
      error: 'Exactly one of screen_id or screen_group_id must be provided, not both.',
    };
  }

  if (!hasScreenId && !hasScreenGroupId) {
    return {
      valid: false,
      error: 'Exactly one of screen_id or screen_group_id is required.',
    };
  }

  return { valid: true };
}

// --- Property-Based Tests ---

describe('Property 6: Target XOR Constraint', () => {
  // Generator: a non-null UUID string (representing a present value)
  const uuidArb = fc.uuid();

  // Generator: an optional/nullable UUID (undefined, null, or a valid UUID)
  const optionalUuidArb = fc.option(uuidArb, { nil: undefined });
  const nullableUuidArb = fc.option(uuidArb, { nil: null });

  it('accepts when only screen_id is present (screen_group_id absent/null/undefined)', () => {
    fc.assert(
      fc.property(
        uuidArb,
        fc.constantFrom(undefined, null),
        (screenId, screenGroupId) => {
          const input: TargetInput = {
            screen_id: screenId,
            screen_group_id: screenGroupId,
          };
          const result = validateTargetXor(input);
          expect(result.valid).toBe(true);
          expect(result.error).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('accepts when only screen_group_id is present (screen_id absent/null/undefined)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(undefined, null),
        uuidArb,
        (screenId, screenGroupId) => {
          const input: TargetInput = {
            screen_id: screenId,
            screen_group_id: screenGroupId,
          };
          const result = validateTargetXor(input);
          expect(result.valid).toBe(true);
          expect(result.error).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects when both screen_id and screen_group_id are present', () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        (screenId, screenGroupId) => {
          const input: TargetInput = {
            screen_id: screenId,
            screen_group_id: screenGroupId,
          };
          const result = validateTargetXor(input);
          expect(result.valid).toBe(false);
          expect(result.error).toContain('not both');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects when neither screen_id nor screen_group_id is present', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(undefined, null),
        fc.constantFrom(undefined, null),
        (screenId, screenGroupId) => {
          const input: TargetInput = {
            screen_id: screenId,
            screen_group_id: screenGroupId,
          };
          const result = validateTargetXor(input);
          expect(result.valid).toBe(false);
          expect(result.error).toContain('required');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('XOR property: for any combination of optional screen_id and screen_group_id, exactly one must be non-null for acceptance', () => {
    fc.assert(
      fc.property(
        optionalUuidArb,
        nullableUuidArb,
        (screenId, screenGroupId) => {
          const input: TargetInput = {
            screen_id: screenId,
            screen_group_id: screenGroupId,
          };
          const result = validateTargetXor(input);

          const hasScreen = screenId != null && screenId !== undefined;
          const hasGroup = screenGroupId != null && screenGroupId !== undefined;

          // XOR: exactly one must be true for valid
          const exactlyOne = (hasScreen && !hasGroup) || (!hasScreen && hasGroup);

          expect(result.valid).toBe(exactlyOne);

          if (!exactlyOne) {
            expect(result.error).toBeDefined();
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
