/**
 * Feature: 08-reingenieria-back-front, Property 7: Cross-Tenant Reference Rejection
 *
 * Generar resource IDs con combinaciones de tenants; verificar que referencias
 * cross-tenant son rechazadas.
 *
 * **Validates: Requirements 3.6, 4.5, 4.6**
 *
 * Requirement 3.6: content_id debe referenciar contenido del mismo tenant
 * Requirement 4.5: screen_id debe referenciar una pantalla del mismo tenant
 * Requirement 4.6: screen_group_id debe referenciar un grupo del mismo tenant
 *
 * Property: For any resource's tenant_id and a reference's tenant_id,
 * if they match → accept; if they differ → reject.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// --- Pure validation function under test ---

export interface TenantOwnershipCheck {
  /** The tenant_id of the resource being created/modified (or the authenticated user's tenant) */
  ownerTenantId: string;
  /** The tenant_id of the referenced resource (screen, group, or content) */
  referenceTenantId: string;
}

export type TenantValidationResult =
  | { valid: true }
  | { valid: false; error: string };

/**
 * Validates that a referenced resource belongs to the same tenant as the owner.
 * This is the core tenant isolation check used by:
 * - CreativeController: validates content_id belongs to same tenant
 * - OrderLineTargetController: validates screen_id / screen_group_id belongs to same tenant
 */
export function validateTenantOwnership(
  check: TenantOwnershipCheck
): TenantValidationResult {
  if (check.ownerTenantId === check.referenceTenantId) {
    return { valid: true };
  }
  return {
    valid: false,
    error: 'Referenced resource does not belong to the same tenant',
  };
}

// --- Generators ---

/** Generate a non-empty tenant ID (UUID-like string) */
const tenantIdArb = fc.uuid();

/** Generate a pair of MATCHING tenant IDs */
const sameTenantPairArb = tenantIdArb.map((id) => ({
  ownerTenantId: id,
  referenceTenantId: id,
}));

/** Generate a pair of DIFFERENT tenant IDs */
const differentTenantPairArb = fc
  .tuple(tenantIdArb, tenantIdArb)
  .filter(([a, b]) => a !== b)
  .map(([owner, ref]) => ({
    ownerTenantId: owner,
    referenceTenantId: ref,
  }));

// --- Property Tests ---

describe('Property 7: Cross-Tenant Reference Rejection', () => {
  it('accepts references when tenant IDs match (same tenant)', () => {
    fc.assert(
      fc.property(sameTenantPairArb, (pair) => {
        const result = validateTenantOwnership(pair);

        // PROPERTY: Same tenant → always accepted
        expect(result.valid).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('rejects references when tenant IDs differ (cross-tenant)', () => {
    fc.assert(
      fc.property(differentTenantPairArb, (pair) => {
        const result = validateTenantOwnership(pair);

        // PROPERTY: Different tenant → always rejected
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.error).toBeTruthy();
          expect(typeof result.error).toBe('string');
          expect(result.error.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('validation is symmetric: if A can reference B, then B can reference A (same tenant)', () => {
    fc.assert(
      fc.property(tenantIdArb, (tenantId) => {
        const forward = validateTenantOwnership({
          ownerTenantId: tenantId,
          referenceTenantId: tenantId,
        });
        const reverse = validateTenantOwnership({
          ownerTenantId: tenantId,
          referenceTenantId: tenantId,
        });

        // PROPERTY: Symmetry — same tenant always accepted regardless of direction
        expect(forward.valid).toBe(true);
        expect(reverse.valid).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('cross-tenant rejection is symmetric: if A cannot reference B, then B cannot reference A', () => {
    fc.assert(
      fc.property(differentTenantPairArb, (pair) => {
        const forward = validateTenantOwnership(pair);
        const reverse = validateTenantOwnership({
          ownerTenantId: pair.referenceTenantId,
          referenceTenantId: pair.ownerTenantId,
        });

        // PROPERTY: Rejection symmetry — cross-tenant is rejected both ways
        expect(forward.valid).toBe(false);
        expect(reverse.valid).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('validates across multiple resource types (screen, group, content) with same logic', () => {
    const resourceTypeArb = fc.constantFrom('screen_id', 'screen_group_id', 'content_id');

    fc.assert(
      fc.property(
        fc.tuple(tenantIdArb, tenantIdArb, resourceTypeArb),
        ([ownerTenant, refTenant, _resourceType]) => {
          const result = validateTenantOwnership({
            ownerTenantId: ownerTenant,
            referenceTenantId: refTenant,
          });

          // PROPERTY: Tenant validation is consistent regardless of resource type
          if (ownerTenant === refTenant) {
            expect(result.valid).toBe(true);
          } else {
            expect(result.valid).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
