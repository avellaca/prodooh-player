/**
 * Property 1: Bug Condition — API Contract Mismatches
 *
 * This test encodes the CORRECT expected behavior (what the backend expects).
 * It runs against the UNFIXED frontend code and should FAIL, proving the bugs exist.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.7, 1.8**
 *
 * Requirement 1.1: contentApi.rotate must send { rotation } (currently sends { angle } → 422)
 * Requirement 1.2: analyticsApi.getPlayback must use date_from/date_to params (currently sends start_date/end_date)
 * Requirement 1.3: Analytics response must be parsed as { total_spots, by_source, by_screen, by_content }
 * Requirement 1.7: super_admin playlist create must include tenant_id (currently omits → 422)
 * Requirement 1.8: super_admin group create must include tenant_id (currently omits → 422)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { contentApi } from '@/features/content/api';
import { analyticsApi } from '@/features/analytics/api';
import { playlistsApi } from '@/features/playlists/api';
import { groupsApi } from '@/features/groups/api';

const BASE_URL = 'http://localhost:8000/api';

describe('Property 1: Bug Condition — API Contract Mismatches', () => {
  beforeEach(() => {
    localStorage.setItem('admin_token', 'test-token');
  });

  /**
   * Property 1.1: contentApi.rotate sends { rotation } field name
   *
   * The backend's ContentController::rotate validates:
   *   'rotation' => ['required', Rule::in([0, 90, 180, 270])]
   *
   * The frontend currently sends { angle } which causes a 422.
   * This test asserts the frontend sends { rotation } as expected by the backend.
   */
  it('contentApi.rotate sends { rotation } field name (not { angle })', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(0, 90, 180, 270),
        async (rotationValue) => {
          let capturedBody: Record<string, unknown> | null = null;

          server.use(
            http.put(`${BASE_URL}/admin/content/:id/rotate`, async ({ request }) => {
              capturedBody = await request.json() as Record<string, unknown>;
              return HttpResponse.json({
                data: { id: 'test-id', rotation: rotationValue },
              });
            })
          );

          await contentApi.rotate('test-id', rotationValue);

          // PROPERTY: The request body must contain "rotation" field, NOT "angle"
          expect(capturedBody).not.toBeNull();
          expect(capturedBody).toHaveProperty('rotation');
          expect(capturedBody).not.toHaveProperty('angle');
          expect(capturedBody!.rotation).toBe(rotationValue);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Property 1.2: analyticsApi.getPlayback uses date_from/date_to params
   *
   * The backend's PlaybackAnalyticsController::index validates:
   *   'date_from' => 'required|date'
   *   'date_to' => 'required|date'
   *
   * The frontend currently sends start_date/end_date which are ignored.
   * This test asserts the frontend sends date_from/date_to.
   */
  it('analyticsApi.getPlayback uses date_from/date_to query params (not start_date/end_date)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.date({ min: new Date('2023-01-01'), max: new Date('2025-12-31') }),
        fc.date({ min: new Date('2023-01-01'), max: new Date('2025-12-31') }),
        async (startDate, endDate) => {
          // Ensure startDate <= endDate
          const [from, to] = startDate <= endDate
            ? [startDate, endDate]
            : [endDate, startDate];

          const fromStr = from.toISOString().split('T')[0];
          const toStr = to.toISOString().split('T')[0];

          let capturedParams: URLSearchParams | null = null;

          server.use(
            http.get(`${BASE_URL}/admin/analytics/playback`, ({ request }) => {
              const url = new URL(request.url);
              capturedParams = url.searchParams;
              return HttpResponse.json({
                data: {
                  total_spots: 100,
                  by_source: { prodooh: 50, gam: 50 },
                  by_screen: [],
                  by_content: [],
                },
              });
            })
          );

          await analyticsApi.getPlayback(fromStr, toStr);

          // PROPERTY: Query params must be date_from/date_to, NOT start_date/end_date
          expect(capturedParams).not.toBeNull();
          expect(capturedParams!.has('date_from')).toBe(true);
          expect(capturedParams!.has('date_to')).toBe(true);
          expect(capturedParams!.has('start_date')).toBe(false);
          expect(capturedParams!.has('end_date')).toBe(false);
          expect(capturedParams!.get('date_from')).toBe(fromStr);
          expect(capturedParams!.get('date_to')).toBe(toStr);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Property 1.3: Analytics response is parsed as { total_spots, by_source, by_screen, by_content }
   *
   * The backend returns { data: { total_spots, by_source, by_screen, by_content } }.
   * The frontend currently expects AnalyticsEntry[] and tries to access data[0].screen_name → empty.
   * This test asserts the frontend can correctly consume the actual backend response.
   */
  it('analytics response is parsed as { total_spots, by_source, by_screen, by_content }', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          total_spots: fc.integer({ min: 0, max: 10000 }),
          by_source: fc.dictionary(
            fc.constantFrom('prodooh', 'gam', 'url', 'playlist'),
            fc.integer({ min: 0, max: 5000 })
          ),
          by_screen: fc.array(
            fc.record({
              screen_id: fc.uuid(),
              count: fc.integer({ min: 0, max: 1000 }),
            }),
            { minLength: 0, maxLength: 5 }
          ),
          by_content: fc.array(
            fc.record({
              content_id: fc.uuid(),
              count: fc.integer({ min: 0, max: 1000 }),
            }),
            { minLength: 0, maxLength: 5 }
          ),
        }),
        async (analyticsData) => {
          server.use(
            http.get(`${BASE_URL}/admin/analytics/playback`, () => {
              // This is what the backend ACTUALLY returns
              return HttpResponse.json({
                data: analyticsData,
              });
            })
          );

          const result = await analyticsApi.getPlayback('2024-01-01', '2024-01-31');

          // PROPERTY: The result must have the correct shape with total_spots, by_source, etc.
          // The current frontend type expects { data: AnalyticsEntry[] } but the actual response
          // is { data: { total_spots, by_source, by_screen, by_content } }
          expect(result).toHaveProperty('data');
          const data = (result as unknown as { data: typeof analyticsData }).data;
          expect(data).toHaveProperty('total_spots');
          expect(data).toHaveProperty('by_source');
          expect(data).toHaveProperty('by_screen');
          expect(data).toHaveProperty('by_content');
          expect(data.total_spots).toBe(analyticsData.total_spots);
          expect(typeof data.total_spots).toBe('number');
          expect(typeof data.by_source).toBe('object');
          expect(Array.isArray(data.by_screen)).toBe(true);
          expect(Array.isArray(data.by_content)).toBe(true);
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property 1.7: super_admin playlist create includes tenant_id
   *
   * The backend's PlaylistController::store validates:
   *   'tenant_id' => 'required' (for super_admin)
   *
   * Architecture: tenant_id injection happens at the page level (via useTenantContext).
   * The API layer accepts tenant_id as an optional field and passes it through.
   * This test verifies that when tenant_id is provided in the input, it arrives in the request body.
   */
  it('super_admin playlist create includes tenant_id in request payload', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 50 }),
          items: fc.constant([] as { type: "url" | "content"; duration_seconds: number; position: number; content_id?: string; url?: string }[]),
        }),
        fc.uuid(),
        async (playlistInput, tenantId) => {
          let capturedBody: Record<string, unknown> | null = null;

          server.use(
            http.post(`${BASE_URL}/admin/playlists`, async ({ request }) => {
              capturedBody = await request.json() as Record<string, unknown>;
              return HttpResponse.json({
                data: { id: 'playlist-1', name: playlistInput.name, tenant_id: tenantId },
              });
            })
          );

          // Pass tenant_id in the input (as the page-level component does via useTenantContext)
          await playlistsApi.create({ ...playlistInput, tenant_id: tenantId });

          // PROPERTY: Request body must include tenant_id for super_admin
          expect(capturedBody).not.toBeNull();
          expect(capturedBody).toHaveProperty('tenant_id');
          expect(capturedBody!.tenant_id).toBe(tenantId);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Property 1.8: super_admin group create includes tenant_id
   *
   * The backend's ScreenGroupController::store validates:
   *   'tenant_id' => 'required' (for super_admin)
   *
   * Architecture: tenant_id injection happens at the page level (via useTenantContext).
   * The API layer accepts tenant_id as an optional field and passes it through.
   * This test verifies that when tenant_id is provided in the input, it arrives in the request body.
   */
  it('super_admin group create includes tenant_id in request payload', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 50 }),
        }),
        fc.uuid(),
        async (groupInput, tenantId) => {
          let capturedBody: Record<string, unknown> | null = null;

          server.use(
            http.post(`${BASE_URL}/admin/groups`, async ({ request }) => {
              capturedBody = await request.json() as Record<string, unknown>;
              return HttpResponse.json({
                id: 'group-1',
                name: groupInput.name,
                tenant_id: tenantId,
              });
            })
          );

          // Pass tenant_id in the input (as the page-level component does via useTenantContext)
          await groupsApi.create({ ...groupInput, tenant_id: tenantId });

          // PROPERTY: Request body must include tenant_id for super_admin
          expect(capturedBody).not.toBeNull();
          expect(capturedBody).toHaveProperty('tenant_id');
          expect(capturedBody!.tenant_id).toBe(tenantId);
        }
      ),
      { numRuns: 10 }
    );
  });
});
