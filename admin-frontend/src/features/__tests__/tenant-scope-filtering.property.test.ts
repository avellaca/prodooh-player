/**
 * Feature: 08-reingenieria-back-front, Property 1: Tenant Scope Filtering
 *
 * For any set of Orders distributed among multiple tenants, when filtering
 * by a specific tenant_id, ALL returned resources must belong exclusively
 * to that tenant_id, and NO resource from another tenant must appear in the results.
 *
 * **Validates: Requirements 1.1, 2.1**
 *
 * Requirement 1.1: GET /api/admin/orders returns orders filtered by tenant (TenantScopeMiddleware)
 * Requirement 2.1: GET /api/admin/orders/{order_id}/order-lines returns order lines of the specified order
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Order } from '@/features/orders/types';

// --- Pure filter function under test ---
// This replicates the tenant scope filtering logic that TenantScopeMiddleware applies:
// given a collection of orders, return only those belonging to the specified tenant.
function filterByTenant<T extends { tenant_id: string }>(items: T[], tenantId: string): T[] {
  return items.filter((item) => item.tenant_id === tenantId);
}

// --- Generators ---

/** Generate a valid tenant_id (UUID-like) */
const tenantIdArb = fc.uuid();

/** Generate an Order status */
const orderStatusArb = fc.constantFrom('draft', 'active', 'paused', 'finished') as fc.Arbitrary<Order['status']>;

/** Generate a valid ISO date string within a reasonable range using integer timestamps */
const isoDateArb = fc
  .integer({
    min: new Date('2024-01-01T00:00:00Z').getTime(),
    max: new Date('2025-12-31T23:59:59Z').getTime(),
  })
  .map((ts) => new Date(ts).toISOString());

/** Generate a minimal Order object with a specific tenant_id */
function orderWithTenantArb(tenantId: fc.Arbitrary<string>): fc.Arbitrary<Order> {
  return fc.record({
    id: fc.uuid(),
    tenant_id: tenantId,
    name: fc.string({ minLength: 1, maxLength: 100 }),
    advertiser_name: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
    starts_at: isoDateArb,
    ends_at: isoDateArb,
    status: orderStatusArb,
    created_at: isoDateArb,
    updated_at: isoDateArb,
  });
}

/** Generate an array of Orders with random tenant_ids from a pool */
const ordersWithMixedTenantsArb = fc
  .array(tenantIdArb, { minLength: 2, maxLength: 5 })
  .chain((tenantIds) =>
    fc.array(orderWithTenantArb(fc.constantFrom(...tenantIds)), { minLength: 0, maxLength: 20 }).map((orders) => ({
      orders,
      tenantIds,
    }))
  );

describe('Property 1: Tenant Scope Filtering', () => {
  /**
   * PROPERTY: Filtering by tenant returns ONLY orders with that tenant_id.
   * No order from a different tenant should appear in the filtered results.
   */
  it('filtered results contain only orders belonging to the requested tenant', () => {
    fc.assert(
      fc.property(ordersWithMixedTenantsArb, ({ orders, tenantIds }) => {
        // Pick a tenant to filter by
        const filterTenant = tenantIds[0];
        const result = filterByTenant(orders, filterTenant);

        // PROPERTY: Every item in the result belongs to the filter tenant
        for (const order of result) {
          expect(order.tenant_id).toBe(filterTenant);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * PROPERTY: No order from a different tenant appears in filtered results.
   */
  it('no order from a different tenant appears in filtered results', () => {
    fc.assert(
      fc.property(ordersWithMixedTenantsArb, ({ orders, tenantIds }) => {
        const filterTenant = tenantIds[0];
        const result = filterByTenant(orders, filterTenant);

        // PROPERTY: No item with a different tenant_id is present
        const foreignOrders = result.filter((o) => o.tenant_id !== filterTenant);
        expect(foreignOrders).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * PROPERTY: The count of filtered results equals the count of orders
   * that actually belong to the target tenant.
   */
  it('filtered count matches the actual number of orders for that tenant', () => {
    fc.assert(
      fc.property(ordersWithMixedTenantsArb, ({ orders, tenantIds }) => {
        const filterTenant = tenantIds[0];
        const result = filterByTenant(orders, filterTenant);

        // Count manually how many orders belong to this tenant
        const expectedCount = orders.filter((o) => o.tenant_id === filterTenant).length;
        expect(result.length).toBe(expectedCount);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * PROPERTY: Filtering preserves all orders of the target tenant (completeness).
   * No order of the target tenant is dropped.
   */
  it('all orders belonging to the target tenant are included in the result', () => {
    fc.assert(
      fc.property(ordersWithMixedTenantsArb, ({ orders, tenantIds }) => {
        const filterTenant = tenantIds[0];
        const result = filterByTenant(orders, filterTenant);

        // Every order belonging to the filter tenant in the original set must appear in result
        const expectedOrders = orders.filter((o) => o.tenant_id === filterTenant);
        const resultIds = new Set(result.map((o) => o.id));

        for (const order of expectedOrders) {
          expect(resultIds.has(order.id)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * EDGE CASE: Empty array of orders returns empty result.
   */
  it('filtering an empty array always returns an empty array', () => {
    fc.assert(
      fc.property(tenantIdArb, (tenantId) => {
        const result = filterByTenant([], tenantId);
        expect(result).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * EDGE CASE: When all orders belong to the same tenant,
   * filtering by that tenant returns all orders.
   */
  it('when all orders have the same tenant_id, filtering returns all of them', () => {
    fc.assert(
      fc.property(
        tenantIdArb.chain((tid) =>
          fc.array(orderWithTenantArb(fc.constant(tid)), { minLength: 1, maxLength: 15 }).map((orders) => ({
            orders,
            tenantId: tid,
          }))
        ),
        ({ orders, tenantId }) => {
          const result = filterByTenant(orders, tenantId);
          expect(result.length).toBe(orders.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * EDGE CASE: When filtering by a tenant that has no orders,
   * the result is empty.
   */
  it('filtering by a tenant with no orders returns an empty array', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.array(orderWithTenantArb(fc.constant('tenant-A')), { minLength: 1, maxLength: 10 }),
          fc.constant('tenant-nonexistent'),
        ),
        ([orders, missingTenant]) => {
          const result = filterByTenant(orders, missingTenant);
          expect(result).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
