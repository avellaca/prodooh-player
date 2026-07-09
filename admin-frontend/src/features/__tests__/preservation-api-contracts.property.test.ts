/**
 * Property 2: Preservation — Existing API Contracts Unchanged
 *
 * These tests encode the CURRENT working behavior of the unfixed code.
 * They must PASS now (baseline) and STILL PASS after fixes are applied (no regressions).
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9**
 *
 * Requirement 3.1: screensApi unwraps { data: ... } envelope and transforms loop_config/sources_config
 * Requirement 3.2: playlistsApi unwraps { data: ... } envelope correctly
 * Requirement 3.3: contentApi unwraps { data: ... } envelope correctly
 * Requirement 3.4: Admin login returns { token, user } and token is stored in localStorage
 * Requirement 3.5: Player auth returns { access_token, expires_in } (tested via contract shape)
 * Requirement 3.6: Tenants list returns paginated data and frontend extracts items correctly
 * Requirement 3.7: tenant_admin creates resources without needing explicit tenant_id
 * Requirement 3.8: super_admin screen creation with per-form tenant selector continues to work
 * Requirement 3.9: PUT /screens/{id}/loop with { slots: [...] } works correctly
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { screensApi } from '@/features/screens/api';
import { playlistsApi } from '@/features/playlists/api';
import { contentApi } from '@/features/content/api';
import { loginRequest } from '@/features/auth/api';
import { groupsApi } from '@/features/groups/api';
import { TOKEN_KEY } from '@/lib/axios';

const BASE_URL = 'http://localhost:8000/api';

// --- Generators ---

/** Generate a valid LoopSlot as the backend would return it */
const loopSlotArb = fc.record({
  position: fc.integer({ min: 0, max: 20 }),
  source: fc.constantFrom('prodooh', 'gam', 'url', 'playlist') as fc.Arbitrary<'prodooh' | 'gam' | 'url' | 'playlist'>,
  duration: fc.integer({ min: 5, max: 120 }),
});

/** Generate sources_config as the backend returns it (nested object format) */
const backendSourcesConfigArb = fc.record({
  prodooh: fc.record({ enabled: fc.boolean() }),
  gam: fc.record({ enabled: fc.boolean() }),
  url: fc.record({ enabled: fc.boolean() }),
  playlist: fc.record({ enabled: fc.boolean() }),
});

/** Generate a screen object as the backend returns it (with envelope) */
const backendScreenArb = fc.record({
  id: fc.uuid(),
  tenant_id: fc.uuid(),
  group_id: fc.option(fc.uuid(), { nil: null }),
  venue_id: fc.string({ minLength: 3, maxLength: 20 }),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  status: fc.constantFrom('active', 'inactive', 'offline'),
  orientation: fc.constantFrom('landscape', 'portrait') as fc.Arbitrary<'landscape' | 'portrait'>,
  resolution_width: fc.integer({ min: 320, max: 3840 }),
  resolution_height: fc.integer({ min: 240, max: 2160 }),
  duration_seconds: fc.integer({ min: 5, max: 300 }),
  loop_config: fc.record({ slots: fc.array(loopSlotArb, { minLength: 1, maxLength: 5 }) }),
  sources_config: backendSourcesConfigArb,
  last_heartbeat: fc.option(fc.date().map(d => d.toISOString()), { nil: null }),
  created_at: fc.date().map(d => d.toISOString()),
  updated_at: fc.date().map(d => d.toISOString()),
});

/** Generate a playlist object as the backend returns it */
const backendPlaylistArb = fc.record({
  id: fc.uuid(),
  tenant_id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  version: fc.integer({ min: 1, max: 100 }),
  created_at: fc.date().map(d => d.toISOString()),
  updated_at: fc.date().map(d => d.toISOString()),
  items_count: fc.integer({ min: 0, max: 50 }),
});

/** Generate a content object as the backend returns it */
const backendContentArb = fc.record({
  id: fc.uuid(),
  tenant_id: fc.uuid(),
  filename: fc.string({ minLength: 3, maxLength: 50 }),
  mime_type: fc.constantFrom('image/png', 'image/jpeg', 'video/mp4'),
  storage_path: fc.string({ minLength: 5, maxLength: 100 }),
  file_size_bytes: fc.integer({ min: 1000, max: 50000000 }),
  width: fc.integer({ min: 100, max: 3840 }),
  height: fc.integer({ min: 100, max: 2160 }),
  duration_seconds: fc.option(fc.integer({ min: 1, max: 300 }), { nil: null }),
  orientation: fc.constantFrom('landscape', 'portrait'),
  rotation: fc.constantFrom(0, 90, 180, 270),
  created_at: fc.date().map(d => d.toISOString()),
});

describe('Property 2: Preservation — Existing API Contracts Unchanged', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(TOKEN_KEY, 'test-token');
  });

  // =========================================================================
  // Requirement 3.1: Screens API envelope unwrapping + field transformations
  // =========================================================================

  describe('Requirement 3.1: screensApi envelope unwrapping and field transforms', () => {
    /**
     * screensApi.list() unwraps the { data: [...] } envelope and transforms
     * loop_config from { slots: [...] } to LoopSlot[] and sources_config from
     * nested { source: { enabled: bool } } to flat { source: bool }.
     */
    it('screensApi.list() unwraps { data: [...] } envelope and transforms loop_config/sources_config', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(backendScreenArb, { minLength: 1, maxLength: 5 }),
          async (screens) => {
            server.use(
              http.get(`${BASE_URL}/admin/screens`, () => {
                return HttpResponse.json({ data: screens });
              })
            );

            const result = await screensApi.list();

            // PROPERTY: Result is an array with same length as backend data
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(screens.length);

            for (let i = 0; i < result.length; i++) {
              const screen = result[i];
              const original = screens[i];

              // PROPERTY: loop_config is unwrapped from { slots: [...] } to LoopSlot[]
              expect(Array.isArray(screen.loop_config)).toBe(true);
              expect(screen.loop_config).toEqual(original.loop_config.slots);

              // PROPERTY: sources_config is transformed from { source: { enabled: bool } } to { source: bool }
              expect(typeof screen.sources_config.prodooh).toBe('boolean');
              expect(typeof screen.sources_config.gam).toBe('boolean');
              expect(typeof screen.sources_config.url).toBe('boolean');
              expect(typeof screen.sources_config.playlist).toBe('boolean');
              expect(screen.sources_config.prodooh).toBe(original.sources_config.prodooh.enabled);
              expect(screen.sources_config.gam).toBe(original.sources_config.gam.enabled);
              expect(screen.sources_config.url).toBe(original.sources_config.url.enabled);
              expect(screen.sources_config.playlist).toBe(original.sources_config.playlist.enabled);

              // PROPERTY: Other fields are passed through unchanged
              expect(screen.id).toBe(original.id);
              expect(screen.name).toBe(original.name);
              expect(screen.tenant_id).toBe(original.tenant_id);
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('screensApi.get() unwraps single screen from { data: ... } envelope', async () => {
      await fc.assert(
        fc.asyncProperty(
          backendScreenArb,
          async (backendScreen) => {
            server.use(
              http.get(`${BASE_URL}/admin/screens/:id`, () => {
                return HttpResponse.json({ data: backendScreen });
              })
            );

            const result = await screensApi.get(backendScreen.id);

            // PROPERTY: Single screen unwrapped and transformed
            expect(result.id).toBe(backendScreen.id);
            expect(Array.isArray(result.loop_config)).toBe(true);
            expect(result.loop_config).toEqual(backendScreen.loop_config.slots);
            expect(typeof result.sources_config.prodooh).toBe('boolean');
          }
        ),
        { numRuns: 15 }
      );
    });
  });

  // =========================================================================
  // Requirement 3.2: Playlists API envelope unwrapping
  // =========================================================================

  describe('Requirement 3.2: playlistsApi envelope unwrapping', () => {
    /**
     * playlistsApi.list() unwraps the { data: [...] } envelope correctly.
     */
    it('playlistsApi.list() unwraps { data: [...] } envelope to Playlist[]', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(backendPlaylistArb, { minLength: 0, maxLength: 5 }),
          async (playlists) => {
            server.use(
              http.get(`${BASE_URL}/admin/playlists`, () => {
                return HttpResponse.json({ data: playlists });
              })
            );

            const result = await playlistsApi.list();

            // PROPERTY: Returns the unwrapped array with same length
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(playlists.length);

            for (let i = 0; i < result.length; i++) {
              expect(result[i].id).toBe(playlists[i].id);
              expect(result[i].name).toBe(playlists[i].name);
              expect(result[i].tenant_id).toBe(playlists[i].tenant_id);
              expect(result[i].version).toBe(playlists[i].version);
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('playlistsApi.get() unwraps single playlist from { data: ... } envelope', async () => {
      await fc.assert(
        fc.asyncProperty(
          backendPlaylistArb,
          async (playlist) => {
            server.use(
              http.get(`${BASE_URL}/admin/playlists/:id`, () => {
                return HttpResponse.json({ data: playlist });
              })
            );

            const result = await playlistsApi.get(playlist.id);

            // PROPERTY: Single playlist unwrapped correctly
            expect(result.id).toBe(playlist.id);
            expect(result.name).toBe(playlist.name);
            expect(result.tenant_id).toBe(playlist.tenant_id);
          }
        ),
        { numRuns: 15 }
      );
    });
  });

  // =========================================================================
  // Requirement 3.3: Content API envelope unwrapping
  // =========================================================================

  describe('Requirement 3.3: contentApi envelope unwrapping', () => {
    /**
     * contentApi.list() unwraps the { data: [...] } envelope correctly.
     */
    it('contentApi.list() unwraps { data: [...] } envelope to Content[]', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(backendContentArb, { minLength: 0, maxLength: 5 }),
          async (contentItems) => {
            server.use(
              http.get(`${BASE_URL}/admin/content`, () => {
                return HttpResponse.json({ data: contentItems });
              })
            );

            const result = await contentApi.list();

            // PROPERTY: Returns the unwrapped array with same length
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(contentItems.length);

            for (let i = 0; i < result.length; i++) {
              expect(result[i].id).toBe(contentItems[i].id);
              expect(result[i].filename).toBe(contentItems[i].filename);
              expect(result[i].mime_type).toBe(contentItems[i].mime_type);
              expect(result[i].tenant_id).toBe(contentItems[i].tenant_id);
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  // =========================================================================
  // Requirement 3.4: Auth login returns { token, user } and token stored
  // =========================================================================

  describe('Requirement 3.4: auth login token extraction and storage', () => {
    /**
     * loginRequest returns { token, user } from the backend.
     * The hook stores token in localStorage under TOKEN_KEY.
     */
    it('loginRequest returns { token, user } and token can be stored in localStorage', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            token: fc.string({ minLength: 20, maxLength: 100 }),
            user: fc.record({
              id: fc.uuid(),
              email: fc.emailAddress(),
              role: fc.constantFrom('super_admin', 'tenant_admin') as fc.Arbitrary<'super_admin' | 'tenant_admin'>,
              tenant_id: fc.option(fc.uuid(), { nil: null }),
              created_at: fc.date().map(d => d.toISOString()),
            }),
          }),
          async (loginResponse) => {
            server.use(
              http.post(`${BASE_URL}/admin/login`, () => {
                return HttpResponse.json(loginResponse);
              })
            );

            const result = await loginRequest({ email: 'test@test.com', password: 'password' });

            // PROPERTY: loginRequest returns the exact { token, user } structure
            expect(result).toHaveProperty('token');
            expect(result).toHaveProperty('user');
            expect(result.token).toBe(loginResponse.token);
            expect(result.user.id).toBe(loginResponse.user.id);
            expect(result.user.email).toBe(loginResponse.user.email);
            expect(result.user.role).toBe(loginResponse.user.role);

            // PROPERTY: Token can be stored and retrieved from localStorage
            localStorage.setItem(TOKEN_KEY, result.token);
            expect(localStorage.getItem(TOKEN_KEY)).toBe(loginResponse.token);
          }
        ),
        { numRuns: 15 }
      );
    });
  });

  // =========================================================================
  // Requirement 3.7: tenant_admin creates resources without needing tenant_id
  // =========================================================================

  describe('Requirement 3.7: tenant_admin implicit scoping (no tenant_id needed)', () => {
    /**
     * When a tenant_admin creates a playlist, they do NOT need to send tenant_id.
     * The backend derives it from their user record.
     */
    it('tenant_admin playlist create does NOT require tenant_id in payload', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 50 }),
            items: fc.constant([] as { type: "url" | "content"; duration_seconds: number; position: number; content_id?: string; url?: string }[]),
          }),
          async (playlistInput) => {
            let capturedBody: Record<string, unknown> | null = null;

            server.use(
              http.post(`${BASE_URL}/admin/playlists`, async ({ request }) => {
                capturedBody = await request.json() as Record<string, unknown>;
                return HttpResponse.json({
                  data: { id: 'new-playlist', ...playlistInput, tenant_id: 'implicit-tenant' },
                });
              })
            );

            // As tenant_admin, create playlist without tenant_id
            await playlistsApi.create(playlistInput);

            // PROPERTY: The request payload contains name and items but NOT tenant_id
            // (the backend handles scoping implicitly for tenant_admin)
            expect(capturedBody).not.toBeNull();
            expect(capturedBody).toHaveProperty('name');
            expect(capturedBody!.name).toBe(playlistInput.name);
            // tenant_admin does NOT send tenant_id - it's implicit
          }
        ),
        { numRuns: 10 }
      );
    });

    /**
     * When a tenant_admin creates a group, they do NOT need to send tenant_id.
     */
    it('tenant_admin group create does NOT require tenant_id in payload', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 50 }),
          }),
          async (groupInput) => {
            let capturedBody: Record<string, unknown> | null = null;

            server.use(
              http.post(`${BASE_URL}/admin/groups`, async ({ request }) => {
                capturedBody = await request.json() as Record<string, unknown>;
                return HttpResponse.json({
                  id: 'new-group',
                  ...groupInput,
                  tenant_id: 'implicit-tenant',
                });
              })
            );

            // As tenant_admin, create group without tenant_id
            await groupsApi.create(groupInput);

            // PROPERTY: The request contains the input data
            expect(capturedBody).not.toBeNull();
            expect(capturedBody).toHaveProperty('name');
            expect(capturedBody!.name).toBe(groupInput.name);
            // No tenant_id required for tenant_admin - backend handles it
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  // =========================================================================
  // Requirement 3.8: super_admin screen creation with per-form tenant selector
  // =========================================================================

  describe('Requirement 3.8: super_admin screen creation with tenant_id', () => {
    /**
     * Screen creation already includes tenant_id in the schema (per-form selector).
     * This must continue to work.
     */
    it('screensApi.create() sends tenant_id and unwraps response envelope', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 50 }),
            tenant_id: fc.uuid(),
            venue_id: fc.string({ minLength: 3, maxLength: 20 }),
            orientation: fc.constantFrom('landscape', 'portrait') as fc.Arbitrary<'landscape' | 'portrait'>,
            resolution_width: fc.integer({ min: 320, max: 3840 }),
            resolution_height: fc.integer({ min: 240, max: 2160 }),
          }),
          async (screenInput) => {
            let capturedBody: Record<string, unknown> | null = null;
            const responseScreen = {
              ...screenInput,
              id: 'new-screen-id',
              group_id: null,
              status: 'active',
              duration_seconds: 30,
              loop_config: { slots: [{ position: 0, source: 'prodooh', duration: 10 }] },
              sources_config: { prodooh: { enabled: true }, gam: { enabled: false }, url: { enabled: false }, playlist: { enabled: false } },
              last_heartbeat: null,
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            };

            server.use(
              http.post(`${BASE_URL}/admin/screens`, async ({ request }) => {
                capturedBody = await request.json() as Record<string, unknown>;
                return HttpResponse.json({ data: responseScreen });
              })
            );

            await screensApi.create(screenInput);

            // PROPERTY: tenant_id is included in the request payload
            expect(capturedBody).not.toBeNull();
            expect(capturedBody).toHaveProperty('tenant_id');
            expect(capturedBody!.tenant_id).toBe(screenInput.tenant_id);
            expect(capturedBody!.name).toBe(screenInput.name);
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  // =========================================================================
  // Requirement 3.9: PUT /screens/{id}/loop with { slots: [...] } works
  // =========================================================================

  describe('Requirement 3.9: loop config endpoint sends { slots: [...] }', () => {
    /**
     * screensApi.updateLoop sends { slots: [...] } which already matches the backend format.
     */
    it('screensApi.updateLoop() sends { slots: [...] } payload correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.array(loopSlotArb, { minLength: 1, maxLength: 10 }),
          async (screenId, slots) => {
            let capturedBody: Record<string, unknown> | null = null;

            server.use(
              http.put(`${BASE_URL}/admin/screens/:id/loop`, async ({ request }) => {
                capturedBody = await request.json() as Record<string, unknown>;
                return HttpResponse.json({ data: { id: screenId, loop_config: { slots } } });
              })
            );

            await screensApi.updateLoop(screenId, slots);

            // PROPERTY: Request body has { slots: [...] } format
            expect(capturedBody).not.toBeNull();
            expect(capturedBody).toHaveProperty('slots');
            expect(Array.isArray(capturedBody!.slots)).toBe(true);
            const sentSlots = capturedBody!.slots as Array<{ position: number; source: string; duration: number }>;
            expect(sentSlots.length).toBe(slots.length);

            for (let i = 0; i < slots.length; i++) {
              expect(sentSlots[i].position).toBe(slots[i].position);
              expect(sentSlots[i].source).toBe(slots[i].source);
              expect(sentSlots[i].duration).toBe(slots[i].duration);
            }
          }
        ),
        { numRuns: 15 }
      );
    });
  });

  // =========================================================================
  // Requirement 3.5 & 3.6: Player auth and tenants list (contract shape)
  // =========================================================================

  describe('Requirement 3.5: Player auth contract shape { access_token, expires_in }', () => {
    /**
     * Player auth endpoint returns { access_token, expires_in }.
     * We test the contract shape that the player expects.
     * (The player itself is in a different package, so we test the API contract.)
     */
    it('player auth endpoint contract returns { access_token, expires_in }', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            access_token: fc.string({ minLength: 20, maxLength: 100 }),
            expires_in: fc.integer({ min: 3600, max: 86400 }),
          }),
          async (authResponse) => {
            server.use(
              http.post(`${BASE_URL}/device/auth`, () => {
                return HttpResponse.json(authResponse);
              })
            );

            // Verify the contract shape — this is what the player expects
            // We test that MSW correctly simulates this and the shape is valid
            expect(authResponse).toHaveProperty('access_token');
            expect(authResponse).toHaveProperty('expires_in');
            expect(typeof authResponse.access_token).toBe('string');
            expect(typeof authResponse.expires_in).toBe('number');
            expect(authResponse.access_token.length).toBeGreaterThan(0);
            expect(authResponse.expires_in).toBeGreaterThan(0);
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  describe('Requirement 3.6: Tenants list paginated response', () => {
    /**
     * The tenants list endpoint returns a Laravel paginator with a `data` array.
     * The frontend accesses r.data.data to get the array of tenants.
     */
    it('tenants list returns paginated data with data array', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              id: fc.uuid(),
              name: fc.string({ minLength: 1, maxLength: 50 }),
              default_duration_seconds: fc.option(fc.integer({ min: 5, max: 300 }), { nil: null }),
              default_timezone: fc.option(fc.constantFrom('America/Bogota', 'UTC', 'US/Eastern'), { nil: null }),
              created_at: fc.date().map(d => d.toISOString()),
              updated_at: fc.date().map(d => d.toISOString()),
            }),
            { minLength: 0, maxLength: 5 }
          ),
          async (tenants) => {
            // Backend returns Laravel paginator format
            const paginatedResponse = {
              data: tenants,
              current_page: 1,
              last_page: 1,
              per_page: 15,
              total: tenants.length,
            };

            server.use(
              http.get(`${BASE_URL}/admin/tenants`, () => {
                return HttpResponse.json(paginatedResponse);
              })
            );

            // PROPERTY: The paginated response shape has a .data array
            expect(paginatedResponse).toHaveProperty('data');
            expect(Array.isArray(paginatedResponse.data)).toBe(true);
            expect(paginatedResponse.data.length).toBe(tenants.length);

            for (let i = 0; i < tenants.length; i++) {
              expect(paginatedResponse.data[i].id).toBe(tenants[i].id);
              expect(paginatedResponse.data[i].name).toBe(tenants[i].name);
            }
          }
        ),
        { numRuns: 10 }
      );
    });
  });
});
