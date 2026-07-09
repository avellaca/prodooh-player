# Integration API Fixes — Bugfix Design

## Overview

Ten integration mismatches exist between the admin-frontend, the Laravel backend, and the browser player. The fix strategy adapts the frontend to match the backend's actual contracts (field names, query params, response structures, envelope patterns) rather than standardizing the backend — because the majority of backend endpoints already work correctly and the frontend is the newer, more malleable layer. Additionally, a global tenant context is introduced for super_admin users, and the player gains heartbeat functionality.

## Glossary

- **Bug_Condition (C)**: Any API call where the frontend sends a request or interprets a response in a format that does not match the backend's actual contract
- **Property (P)**: The frontend sends the exact field names, query params, and payload structures the backend validates, and correctly parses the backend's actual response shape
- **Preservation**: Existing working behaviors (screens API envelope, playlists envelope, content upload, auth flow, tenant_admin implicit scoping, loop config) must remain unchanged
- **`contentApi.rotate`**: Function in `admin-frontend/src/features/content/api.ts` that sends rotation requests
- **`analyticsApi.getPlayback`**: Function in `admin-frontend/src/features/analytics/api.ts` that fetches playback analytics
- **`screensApi.updateSources`**: Function in `admin-frontend/src/features/screens/api.ts` that toggles screen sources
- **`SourceToggleController`**: Laravel controller at `backend/app/Http/Controllers/Admin/SourceToggleController.php` that accepts `{ sources: { name: { enabled: bool } } }` format
- **Global Tenant Context**: A React context providing the super_admin's currently-selected tenant_id, stored in localStorage for persistence across reloads

## Bug Details

### Bug Condition

The bugs manifest when the frontend API layer sends requests with field names, query parameters, or payload structures that do not match what the backend controllers validate, OR when the frontend parses responses assuming a structure different from what the backend actually returns.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type APIRequest | APIResponse
  OUTPUT: boolean

  RETURN (input.type == "rotate" AND input.payload.fieldName == "angle")
         OR (input.type == "analytics_query" AND input.params CONTAINS "start_date")
         OR (input.type == "analytics_response" AND input.expectsShape == "AnalyticsEntry[]")
         OR (input.type == "heartbeat" AND input.playerSendsHeartbeat == false)
         OR (input.type == "groups_response" AND input.expectsEnvelope == true)
         OR (input.type == "tenants_response" AND input.expectsEnvelope == true)
         OR (input.type == "playlist_create" AND input.user.role == "super_admin" AND input.payload.tenant_id == null)
         OR (input.type == "group_create" AND input.user.role == "super_admin" AND input.payload.tenant_id == null)
         OR (input.type == "source_toggle" AND input.payload.format == "flat_booleans")
         OR (input.type == "tenant_context" AND input.user.role == "super_admin" AND globalTenantSelected == false)
END FUNCTION
```

### Examples

- **Rotate**: Frontend sends `PUT /admin/content/abc/rotate` with `{ angle: 90 }` → backend returns 422 because it validates `rotation`
- **Analytics params**: Frontend sends `GET /admin/analytics/playback?start_date=2024-01-01&end_date=2024-01-31` → backend ignores filters (expects `date_from`/`date_to`)
- **Analytics response**: Frontend accesses `response.data.data` expecting `AnalyticsEntry[]` → actual response is `{ data: { total_spots, by_source, by_screen, by_content } }`, DataTable renders empty
- **Player heartbeat**: Player authenticates, receives `heartbeat_interval_seconds`, but never sends `POST /api/device/heartbeat` → screen always shows "Offline"
- **Groups envelope**: Frontend `groupsApi.list()` expects raw array at `r.data` — this works but is inconsistent with screens/content/playlists which use `{ data: ... }`
- **Tenants envelope**: Frontend `tenantsApi.list()` expects `r.data.data` (envelope) but `get`/`create`/`update` expect raw at `r.data` — index returns Laravel paginator (has `data` field), individual endpoints return raw models
- **Playlist tenant_id**: Super_admin creates playlist → 422 because `tenant_id` is required but not sent
- **Group tenant_id**: Super_admin creates group → 422 because `tenant_id` is required but not sent
- **Source toggle**: Frontend sends `{ prodooh: true, gam: false, url: true, playlist: true }` → SourceToggleController rejects (expects `{ sources: { prodooh: { enabled: true }, ... } }`)
- **No global tenant selector**: Super_admin has no consistent way to set working tenant context across all resource forms

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Screens API (`screensApi.list/get/create/update`) continues to unwrap `{ data: ... }` envelope and transform `loop_config`/`sources_config`
- Playlists API (`playlistsApi.list/get/create/update`) continues to unwrap `{ data: ... }` envelope
- Content API (`contentApi.list/upload/delete`) continues to unwrap `{ data: ... }` envelope
- Auth flow returns `{ token, user }` and stores token in localStorage
- Player auth (`POST /api/device/auth`) returns `{ access_token, expires_in }` and player stores JWT
- Tenants list endpoint returns Laravel paginated response (already has `.data` property)
- `tenant_admin` users continue to use their implicit `tenant_id` — no global selector shown
- Loop config endpoint `PUT /admin/screens/{id}/loop` with `{ slots: [...] }` continues to work
- Screen creation for super_admin (which already has a per-form tenant selector) continues to work

**Scope:**
All inputs that do NOT match the bug conditions above should be completely unaffected by these fixes. The changes are limited to:
- Renaming a field in the rotate call
- Renaming query params in the analytics call
- Adapting types and UI for analytics response
- Adding heartbeat logic to the player HTML
- Removing false envelope expectation from groups/tenants frontend calls
- Adding `tenant_id` injection for super_admin create operations
- Reformatting source toggle payload
- Adding a global tenant selector component

## Hypothesized Root Cause

Based on code analysis, the root causes are confirmed:

1. **Content Rotate Field Mismatch**: `contentApi.rotate` sends `{ angle }` but `ContentController::rotate` validates `'rotation' => ['required', Rule::in([0, 90, 180, 270])]`. The frontend field name is simply wrong.

2. **Analytics Query Param Mismatch**: `analyticsApi.getPlayback` sends `start_date`/`end_date` but `PlaybackAnalyticsController::index` validates `date_from`/`date_to`. Frontend param names are wrong.

3. **Analytics Response Structure Mismatch**: Frontend defines `PlaybackAnalytics { data: AnalyticsEntry[] }` but backend `PlaybackAnalyticsService::query()` returns `{ total_spots, by_source, by_screen, by_content }`. The frontend types and UI were built against a spec that doesn't match the implementation.

4. **Missing Player Heartbeat**: The `player/dist/index.html` boot script calls `bootPlayer()` and renders content but never initiates a heartbeat interval. The `HeartbeatController` expects `{ venue_id, timestamp, storage, uptime_seconds, playlist_version }`.

5. **Groups API No Envelope**: `ScreenGroupController` returns raw models/collections (no `{ data: ... }` wrapper). The frontend already handles this correctly (`r.data`) but `tenantsApi.list` expects `r.data.data`. The decision is to keep backend as-is and ensure frontend matches.

6. **Tenants API Mixed Patterns**: `TenantController::index` returns Laravel paginator (which has a `data` array, `current_page`, etc.), while `show`/`store`/`update` return raw model. Frontend `tenantsApi.list` already unwraps `r.data.data` which matches paginator. But `get`/`create`/`update` expect raw model — this is already correct. The actual issue is that `tenantsApi.list` declares type `{ data: Tenant[] }` but the paginator has more fields.

7. **Missing tenant_id for Super_Admin Creates**: `PlaylistController::store` and `ScreenGroupController::store` both require `tenant_id` for super_admin, but the frontend schemas (`playlistSchema`, `groupSchema`) don't include it and no injection mechanism exists.

8. **Source Toggle Format**: `screensApi.updateSources` sends flat `SourcesConfig` (`{ prodooh: true, gam: false, ... }`) but `SourceToggleController::update` expects either `{ source, enabled }` (single) or `{ sources: { name: { enabled: bool } } }` (batch). The frontend needs to transform its `SourcesConfig` to the batch format.

9. **No Global Tenant Context**: There is no mechanism for super_admin to select a "working tenant" that persists across navigation. Each form would need its own selector, creating a fragmented UX.

## Correctness Properties

Property 1: Bug Condition — API Requests Match Backend Contract

_For any_ API request where the bug condition holds (field name mismatch, wrong query params, wrong payload format, or missing tenant_id for super_admin), the fixed frontend SHALL send the exact field names, query parameters, and payload structures that the backend controller validates, resulting in successful (2xx) responses instead of 422 errors.

**Validates: Requirements 2.1, 2.2, 2.4, 2.5, 2.6, 2.8, 2.9, 2.10**

Property 2: Bug Condition — Analytics Response Correctly Parsed

_For any_ analytics response from the backend containing `{ data: { total_spots, by_source, by_screen, by_content } }`, the fixed frontend SHALL correctly parse and display this structure in the UI, rendering meaningful data instead of an empty table.

**Validates: Requirements 2.3**

Property 3: Bug Condition — Player Heartbeat Active

_For any_ player instance that has successfully authenticated and received `heartbeat_interval_seconds`, the fixed player SHALL send `POST /api/device/heartbeat` with the required payload at the configured interval, keeping the screen status as "online".

**Validates: Requirements 2.4**

Property 4: Bug Condition — Global Tenant Context for Super_Admin

_For any_ super_admin user logged in, the fixed system SHALL display a global tenant selector in the header, and all tenant-scoped create operations (playlists, groups, content) SHALL automatically include the selected `tenant_id` without requiring per-form selectors.

**Validates: Requirements 2.7, 2.8, 2.9**

Property 5: Preservation — Existing API Contracts Unchanged

_For any_ API call that does NOT match the bug conditions (screens CRUD, playlists CRUD, content list/upload/delete, auth flow, loop config, tenant_admin operations), the fixed code SHALL produce exactly the same behavior as the original code, preserving all existing working integrations.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9**

## Fix Implementation

### Changes Required

**File**: `admin-frontend/src/features/content/api.ts`
**Function**: `contentApi.rotate`
**Change**: Rename `angle` to `rotation` in the request payload
```typescript
// Before
rotate: (id: string, angle: number) =>
  api.put<{ data: Content }>(`/admin/content/${id}/rotate`, { angle })

// After
rotate: (id: string, rotation: number) =>
  api.put<{ data: Content }>(`/admin/content/${id}/rotate`, { rotation })
```

---

**File**: `admin-frontend/src/features/analytics/api.ts`
**Function**: `analyticsApi.getPlayback`
**Change**: Rename query params from `start_date`/`end_date` to `date_from`/`date_to`
```typescript
// Before
params: { start_date: startDate, end_date: endDate }

// After
params: { date_from: startDate, date_to: endDate }
```

---

**File**: `admin-frontend/src/types/models.ts`
**Change**: Replace `PlaybackAnalytics` and `AnalyticsEntry` types with the actual backend response structure
```typescript
// New types
export interface PlaybackAnalytics {
  total_spots: number;
  by_source: Record<string, number>;
  by_screen: Array<{ screen_id: string; count: number }>;
  by_content: Array<{ content_id: string; count: number }>;
}
```

---

**File**: `admin-frontend/src/features/analytics/pages/AnalyticsPage.tsx`
**Change**: Rewrite the DataTable usage to render the new analytics structure (summary cards + breakdown tables for by_source, by_screen, by_content)

---

**File**: `player/dist/index.html`
**Change**: Add heartbeat interval after successful boot. After `bootPlayer()` resolves successfully, start a `setInterval` that sends `POST /api/device/heartbeat` with the required payload (`venue_id`, `timestamp`, `storage`, `uptime_seconds`, `playlist_version`).

---

**File**: `admin-frontend/src/features/groups/api.ts`
**Change**: No change needed — the frontend already correctly reads raw responses (`r.data`). The groups API is consistent with its backend (no envelope). Keep as-is.

---

**File**: `admin-frontend/src/features/tenants/api.ts`
**Change**: Remove the false `{ data: Tenant[] }` type annotation on `list()`. The backend returns a Laravel paginator which already has a `data` property (array of tenants), plus `current_page`, `last_page`, etc. The existing `r.data.data` access is correct but the type should reflect pagination metadata. The `get`/`create`/`update` already return raw models and are correct.

---

**File**: `admin-frontend/src/features/screens/api.ts`
**Function**: `screensApi.updateSources`
**Change**: Transform flat `SourcesConfig` to batch format before sending
```typescript
// Before
updateSources: (id: string, sources: SourcesConfig) =>
  api.put(`/admin/screens/${id}/sources`, sources)

// After
updateSources: (id: string, sources: SourcesConfig) => {
  const payload = {
    sources: Object.fromEntries(
      Object.entries(sources).map(([key, enabled]) => [key, { enabled }])
    ),
  };
  return api.put(`/admin/screens/${id}/sources`, payload);
}
```

---

**New File**: `admin-frontend/src/contexts/TenantContext.tsx`
**Change**: Create a React context that stores the super_admin's selected tenant_id, persisted in localStorage. Provides `selectedTenantId` and `setSelectedTenantId`. Only active for super_admin users.

---

**File**: `admin-frontend/src/components/layout/Header.tsx`
**Change**: Add a tenant selector dropdown (using the `Select` component) on the right side of the header, visible only when `user.role === 'super_admin'`. Reads/writes from `TenantContext`.

---

**File**: `admin-frontend/src/features/playlists/api.ts`
**Function**: `playlistsApi.create`
**Change**: Accept optional `tenant_id` in the create payload (or inject from context at the call site)

---

**File**: `admin-frontend/src/features/groups/api.ts`
**Function**: `groupsApi.create`
**Change**: Accept `tenant_id` in `CreateGroupInput` schema and pass it to the API call

---

**File**: `admin-frontend/src/schemas/playlist.schema.ts`
**Change**: Add optional `tenant_id` field to `playlistSchema`

---

**File**: `admin-frontend/src/schemas/group.schema.ts`
**Change**: Add optional `tenant_id` field to `groupSchema`

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bugs on unfixed code (verifying the bug condition triggers), then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fix. Confirm the root cause analysis by observing actual 422 errors and parse failures.

**Test Plan**: Write integration tests that simulate the frontend API calls as-is and observe the backend rejections. Run these on the UNFIXED code to confirm each mismatch.

**Test Cases**:
1. **Rotate Field Test**: Call `PUT /admin/content/{id}/rotate` with `{ angle: 90 }` → expect 422 (will fail on unfixed code)
2. **Analytics Params Test**: Call `GET /admin/analytics/playback?start_date=...&end_date=...` → expect date filters to be ignored (will fail on unfixed code)
3. **Analytics Parse Test**: Receive actual analytics response and attempt to access `data[0].screen_name` → expect undefined/error (will fail on unfixed code)
4. **Source Toggle Test**: Call `PUT /admin/screens/{id}/sources` with `{ prodooh: true }` → expect 422 (will fail on unfixed code)
5. **Playlist Create Super_Admin Test**: Call `POST /admin/playlists` without `tenant_id` as super_admin → expect 422 (will fail on unfixed code)
6. **Group Create Super_Admin Test**: Call `POST /admin/groups` without `tenant_id` as super_admin → expect 422 (will fail on unfixed code)

**Expected Counterexamples**:
- 422 validation errors with messages like "The rotation field is required", "The tenant_id field is required", "The sources field is required"
- Empty/undefined data when parsing analytics response with wrong type assumptions

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed functions produce the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedAPICall(input)
  ASSERT result.status IN [200, 201]
  ASSERT result.body MATCHES expectedSchema
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed code produces the same result as the original code.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalBehavior(input) == fixedBehavior(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many API call variations automatically
- It catches edge cases in response parsing that manual tests might miss
- It provides strong guarantees that the screens/playlists/content envelope unwrapping continues to work

**Test Plan**: Observe behavior on UNFIXED code for all non-affected endpoints (screens CRUD, playlists CRUD, content operations, auth), then write property-based tests ensuring those behaviors are unchanged after the fix.

**Test Cases**:
1. **Screens Envelope Preservation**: Verify `screensApi.list/get/create/update` continue to unwrap `{ data: ... }` and transform `loop_config`/`sources_config`
2. **Playlists Envelope Preservation**: Verify `playlistsApi.list/get/create/update` continue to unwrap `{ data: ... }`
3. **Content Envelope Preservation**: Verify `contentApi.list/upload` continue to unwrap `{ data: ... }`
4. **Auth Flow Preservation**: Verify login returns `{ token, user }` and token is stored correctly
5. **Tenant_Admin Implicit Scoping**: Verify tenant_admin creates resources without needing `tenant_id`
6. **Loop Config Preservation**: Verify `PUT /screens/{id}/loop` with `{ slots: [...] }` continues to work

### Unit Tests

- Test `contentApi.rotate` sends `{ rotation }` field name
- Test `analyticsApi.getPlayback` uses `date_from`/`date_to` query params
- Test analytics response parsing with the new type structure
- Test `screensApi.updateSources` transforms flat booleans to `{ sources: { name: { enabled } } }` format
- Test TenantContext stores and retrieves selected tenant_id
- Test that super_admin playlist/group creation includes tenant_id from context
- Test that tenant_admin operations don't include/require tenant_id

### Property-Based Tests

- Generate random rotation values (0, 90, 180, 270) and verify correct field name in request payload
- Generate random date ranges and verify correct query param names
- Generate random `SourcesConfig` combinations and verify transformed payload matches `{ sources: { [key]: { enabled: bool } } }` schema
- Generate random tenant selections and verify they persist across context reads
- Generate random API responses in the screens/playlists format and verify envelope unwrapping still works correctly

### Integration Tests

- Test full rotate flow: upload content → rotate → verify rotation stored
- Test full analytics flow: create playback logs → query with date range → verify response renders
- Test full super_admin create flow: select tenant → create playlist → verify tenant_id in request
- Test player heartbeat: boot player → verify heartbeat requests sent at interval
- Test source toggle: enable/disable sources → verify screen sources_config updated
- Test global tenant selector: login as super_admin → select tenant → create group → verify tenant_id attached
