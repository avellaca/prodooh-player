# Implementation Plan

## Overview

Fix 10 integration mismatches between admin-frontend, Laravel backend, and browser player. The strategy adapts the frontend to match the backend's actual contracts (field names, query params, response structures), adds a global tenant context for super_admin, and implements player heartbeat.

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - API Contract Mismatches
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bugs exist
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the 10 integration mismatches
  - **Scoped PBT Approach**: Scope properties to the concrete failing cases for each defect
  - Test that `contentApi.rotate` sends `{ rotation }` field name (currently sends `{ angle }` → 422)
  - Test that `analyticsApi.getPlayback` uses `date_from`/`date_to` params (currently sends `start_date`/`end_date` → filters ignored)
  - Test that analytics response is parsed as `{ total_spots, by_source, by_screen, by_content }` (currently expects `AnalyticsEntry[]` → empty render)
  - Test that `screensApi.updateSources` sends batch format `{ sources: { name: { enabled: bool } } }` (currently sends flat booleans → 422)
  - Test that super_admin playlist create includes `tenant_id` (currently omits → 422)
  - Test that super_admin group create includes `tenant_id` (currently omits → 422)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct — it proves the bugs exist)
  - Document counterexamples found (e.g., "rotate sends { angle: 90 } → 422 'The rotation field is required'")
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.7, 1.8, 1.10_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Existing API Contracts Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe: `screensApi.list()` unwraps `{ data: ... }` envelope and transforms `loop_config`/`sources_config` on unfixed code
  - Observe: `playlistsApi.list()` unwraps `{ data: ... }` envelope on unfixed code
  - Observe: `contentApi.list()` unwraps `{ data: ... }` envelope on unfixed code
  - Observe: auth login returns `{ token, user }` and token is stored in localStorage on unfixed code
  - Observe: `tenant_admin` creates resources without needing explicit `tenant_id` on unfixed code
  - Observe: `PUT /screens/{id}/loop` with `{ slots: [...] }` works correctly on unfixed code
  - Write property-based tests: for all screens/playlists/content API calls, envelope unwrapping produces correct data shape
  - Write property-based tests: for all auth calls, token extraction and storage behaves identically
  - Write property-based tests: for all tenant_admin operations, implicit scoping is unchanged
  - Verify tests PASS on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 3. Fix field/param renames (one-line fixes)

  - [x] 3.1 Rename `angle` to `rotation` in content rotate API call
    - File: `admin-frontend/src/features/content/api.ts`
    - Change `contentApi.rotate` to send `{ rotation }` instead of `{ angle }`
    - Update function parameter name from `angle` to `rotation`
    - _Bug_Condition: input.type == "rotate" AND input.payload.fieldName == "angle"_
    - _Expected_Behavior: PUT /admin/content/{id}/rotate sends { rotation: value } → 200_
    - _Preservation: Content list/upload/delete envelope unwrapping unchanged_
    - _Requirements: 2.1_

  - [x] 3.2 Rename analytics query params from `start_date`/`end_date` to `date_from`/`date_to`
    - File: `admin-frontend/src/features/analytics/api.ts`
    - Change `analyticsApi.getPlayback` params from `{ start_date, end_date }` to `{ date_from, date_to }`
    - _Bug_Condition: input.type == "analytics_query" AND input.params CONTAINS "start_date"_
    - _Expected_Behavior: GET /admin/analytics/playback?date_from=...&date_to=... → filters work_
    - _Preservation: Analytics endpoint continues to return correct data structure_
    - _Requirements: 2.2_

- [x] 4. Fix source toggle format transformation

  - [x] 4.1 Transform flat SourcesConfig to batch format in updateSources
    - File: `admin-frontend/src/features/screens/api.ts`
    - Change `screensApi.updateSources` to transform `{ prodooh: true, gam: false }` into `{ sources: { prodooh: { enabled: true }, gam: { enabled: false } } }`
    - Use `Object.fromEntries(Object.entries(sources).map(([key, enabled]) => [key, { enabled }]))` wrapped in `{ sources: ... }`
    - _Bug_Condition: input.type == "source_toggle" AND input.payload.format == "flat_booleans"_
    - _Expected_Behavior: PUT /admin/screens/{id}/sources sends { sources: { name: { enabled: bool } } } → 200_
    - _Preservation: Screens CRUD envelope unwrapping and loop_config/sources_config transforms unchanged_
    - _Requirements: 2.10_

- [x] 5. Add global tenant context (new file + Header update)

  - [x] 5.1 Create TenantContext provider
    - Create new file: `admin-frontend/src/contexts/TenantContext.tsx`
    - Implement React context with `selectedTenantId` and `setSelectedTenantId`
    - Persist selected tenant_id in localStorage (key: `selected_tenant_id`)
    - Only active for `super_admin` users; returns `null` for other roles
    - Export `TenantProvider` wrapper and `useTenantContext` hook
    - _Requirements: 2.7_

  - [x] 5.2 Add tenant selector dropdown to Header
    - File: `admin-frontend/src/components/layout/Header.tsx`
    - Add a `Select` dropdown on the right side of the header
    - Only render when `user.role === 'super_admin'`
    - Populate with tenant list from `tenantsApi.list()`
    - Read/write from `TenantContext` via `useTenantContext` hook
    - _Bug_Condition: input.type == "tenant_context" AND input.user.role == "super_admin" AND globalTenantSelected == false_
    - _Expected_Behavior: Super_admin sees tenant selector, selection persists across navigation_
    - _Preservation: tenant_admin users do NOT see the selector (3.7)_
    - _Requirements: 2.7, 2.9_

  - [x] 5.3 Wrap App with TenantProvider
    - File: `admin-frontend/src/App.tsx`
    - Wrap the app component tree with `<TenantProvider>` so context is available everywhere
    - _Requirements: 2.7_

- [x] 6. Inject tenant_id into playlist/group create forms

  - [x] 6.1 Add tenant_id to playlist creation for super_admin
    - File: `admin-frontend/src/features/playlists/api.ts` (and associated schema/form if separate)
    - Add optional `tenant_id` field to `CreatePlaylistInput` type
    - Inject `tenant_id` from `useTenantContext()` when user is super_admin
    - _Bug_Condition: input.type == "playlist_create" AND input.user.role == "super_admin" AND input.payload.tenant_id == null_
    - _Expected_Behavior: POST /admin/playlists includes tenant_id → 201_
    - _Preservation: tenant_admin playlist creation unchanged (implicit scoping)_
    - _Requirements: 2.8_

  - [x] 6.2 Add tenant_id to group creation for super_admin
    - File: `admin-frontend/src/features/groups/api.ts` (and associated schema/form if separate)
    - Add optional `tenant_id` field to `CreateGroupInput` type
    - Inject `tenant_id` from `useTenantContext()` when user is super_admin
    - _Bug_Condition: input.type == "group_create" AND input.user.role == "super_admin" AND input.payload.tenant_id == null_
    - _Expected_Behavior: POST /admin/groups includes tenant_id → 201_
    - _Preservation: tenant_admin group creation unchanged (implicit scoping)_
    - _Requirements: 2.9_

- [x] 7. Fix analytics response type + UI redesign

  - [x] 7.1 Update PlaybackAnalytics type definition
    - File: `admin-frontend/src/types/models.ts`
    - Replace `PlaybackAnalytics { data: AnalyticsEntry[] }` with correct structure:
      ```typescript
      export interface PlaybackAnalytics {
        total_spots: number;
        by_source: Record<string, number>;
        by_screen: Array<{ screen_id: string; count: number }>;
        by_content: Array<{ content_id: string; count: number }>;
      }
      ```
    - Remove unused `AnalyticsEntry` interface
    - _Bug_Condition: input.type == "analytics_response" AND input.expectsShape == "AnalyticsEntry[]"_
    - _Expected_Behavior: Frontend types match { total_spots, by_source, by_screen, by_content }_
    - _Requirements: 2.3_

  - [x] 7.2 Redesign AnalyticsPage to render new response structure
    - File: `admin-frontend/src/features/analytics/pages/AnalyticsPage.tsx`
    - Replace the DataTable rendering (which expected `AnalyticsEntry[]`) with:
      - Summary card showing `total_spots`
      - Breakdown table/cards for `by_source` (source name → count)
      - Breakdown table for `by_screen` (screen_id → count)
      - Breakdown table for `by_content` (content_id → count)
    - Update the `usePlaybackAnalytics` hook usage to destructure the new shape
    - _Expected_Behavior: Analytics page renders meaningful data from actual backend response_
    - _Preservation: Analytics date picker and query triggering remain unchanged_
    - _Requirements: 2.3_

- [x] 8. Add player heartbeat functionality

  - [x] 8.1 Implement heartbeat interval in player boot script
    - File: `player/dist/index.html`
    - After `bootPlayer()` resolves successfully, start `setInterval` at `heartbeat_interval_seconds * 1000`
    - Each tick sends `POST /api/device/heartbeat` with headers `Authorization: Bearer <token>` and payload:
      ```json
      { "venue_id": "<from config>", "timestamp": "<ISO 8601>", "storage": "<navigator.storage estimate>", "uptime_seconds": "<elapsed since boot>", "playlist_version": "<from config>" }
      ```
    - Handle errors gracefully (log and retry on next interval, don't crash the player)
    - Clear interval if player is deactivated or auth expires
    - _Bug_Condition: input.type == "heartbeat" AND input.playerSendsHeartbeat == false_
    - _Expected_Behavior: Player sends POST /api/device/heartbeat at configured interval → screen shows "Online"_
    - _Preservation: Player auth flow (POST /api/device/auth) unchanged (3.5)_
    - _Requirements: 2.4_

- [x] 9. Fix for integration API mismatches — verification

  - [x] 9.1 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - API Contract Mismatches Fixed
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior for all 10 defects
    - When this test passes, it confirms all API contracts are aligned
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bugs are fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7, 2.8, 2.9, 2.10_

  - [x] 9.2 Verify preservation tests still pass
    - **Property 2: Preservation** - Existing API Contracts Still Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm screens/playlists/content envelope unwrapping still works
    - Confirm auth flow unchanged
    - Confirm tenant_admin implicit scoping unchanged
    - Confirm loop config endpoint unchanged

- [x] 10. Checkpoint — Ensure all tests pass and build succeeds
  - Run `npm run build` in `admin-frontend/` — must complete with zero errors
  - Run full test suite (unit + property-based tests) — all must pass
  - Manual verification: login as super_admin → tenant selector visible in header
  - Manual verification: login as tenant_admin → NO tenant selector in header
  - Manual verification: rotate content → no 422, rotation applied
  - Manual verification: view analytics with date range → data renders correctly (summary + breakdowns)
  - Manual verification: toggle screen sources → no 422, sources updated
  - Manual verification: super_admin creates playlist with tenant selected → no 422
  - Manual verification: super_admin creates group with tenant selected → no 422
  - Manual verification: player boots and heartbeat requests appear in network tab at configured interval
  - Ensure all tests pass, ask the user if questions arise.


## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2"] },
    { "id": 2, "tasks": ["3.1", "3.2", "4.1", "7.1", "8.1"] },
    { "id": 3, "tasks": ["5.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "7.2"] },
    { "id": 5, "tasks": ["6.1", "6.2"] },
    { "id": 6, "tasks": ["9.1", "9.2"] },
    { "id": 7, "tasks": ["10"] }
  ]
}
```

Tasks 3, 4, 7, and 8 are independent of each other and can be parallelized after task 2 completes. Task 6 depends on task 5 (needs TenantContext). Tasks 9 and 10 must run last.

## Notes

- Tasks 1 and 2 MUST be completed before any implementation tasks (3–8) begin.
- The exploration test (task 1) is expected to FAIL on unfixed code — this confirms the bugs exist.
- The preservation test (task 2) is expected to PASS on unfixed code — this captures baseline behavior.
- After all fixes (tasks 3–8), re-running both test suites (task 9) confirms the fix works without regressions.
- Defects 1.5 and 1.6 (groups/tenants envelope inconsistency) are acknowledged but NOT fixed — the backend already returns correct data and the frontend already handles it. These are noted as technical debt, not blocking bugs.
