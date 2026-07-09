# Bugfix Requirements Document

## Introduction

Multiple integration mismatches exist between the admin-frontend SPA, the Laravel backend API, and the browser-simulated player. These cause runtime errors, silent data loss, and incorrect UI state. The issues fall into several categories: response envelope mismatches, field name mismatches, query parameter name mismatches, response structure mismatches, missing tenant_id handling for super_admin operations, and missing player functionality (heartbeat).

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the frontend calls `PUT /admin/content/{id}/rotate` with `{ angle: 90 }` THEN the backend returns a 422 validation error because it expects the field `rotation` instead of `angle`

1.2 WHEN the frontend calls `GET /admin/analytics/playback` with query params `start_date` and `end_date` THEN the backend ignores the date filters because it validates params named `date_from` and `date_to`

1.3 WHEN the frontend receives the analytics response and accesses `data.data` (expecting an `AnalyticsEntry[]` array with `screen_id`, `screen_name`, `source`, `total_plays`, `total_duration_seconds`) THEN it gets an object with `total_spots`, `by_source`, `by_screen`, `by_content` — a completely different structure that causes the DataTable to render empty

1.4 WHEN the player authenticates successfully and receives `heartbeat_interval_seconds` in its config THEN it never sends periodic `POST /api/device/heartbeat` requests, so the screen `last_heartbeat` is never updated and the admin UI always shows the screen as "Offline"

1.5 WHEN the frontend `groupsApi.list()` calls `GET /admin/groups` expecting a raw array at `r.data` THEN it works, but `groupsApi.get(id)` also expects a raw model at `r.data` while other endpoints (screens, playlists, content) consistently use `{ data: ... }` wrapper — this inconsistency means any future refactoring to standardize on `{ data: ... }` will break groups

1.6 WHEN the frontend `tenantsApi.get(id)` calls `GET /admin/tenants/{id}` expecting a raw Tenant object at `r.data` THEN it works, but show/create/update return raw models while index returns a paginated envelope — this inconsistency with the rest of the API (screens, playlists, content all use `{ data: ... }`) creates confusion and fragility

1.7 WHEN a super_admin user creates a playlist THEN the backend returns a 422 validation error because `tenant_id` is required for super_admin but the frontend playlist creation form and schema do not include a `tenant_id` field

1.8 WHEN a super_admin user creates a screen group THEN the backend returns a 422 validation error because `tenant_id` is required but the frontend group creation form and schema do not include a `tenant_id` field

1.9 WHEN a super_admin user needs to operate on tenant-scoped resources (screens, groups, playlists, content) THEN there is no global tenant context — the user must manually select a tenant in each individual form that happens to have the selector, creating a fragmented and error-prone UX

1.10 WHEN the frontend calls `PUT /admin/screens/{id}/sources` with a flat `SourcesConfig` object `{ prodooh: true, gam: false, url: true, playlist: true }` THEN the backend's `SourceToggleController` validation fails because it expects either `{ source: "gam", enabled: false }` (single toggle) or `{ sources: { gam: { enabled: false }, prodooh: { enabled: true } } }` (batch toggle format)

### Expected Behavior (Correct)

2.1 WHEN the frontend calls `PUT /admin/content/{id}/rotate` THEN the system SHALL send `{ rotation: 90 }` matching the backend's expected field name, and receive a successful response with the updated content

2.2 WHEN the frontend calls `GET /admin/analytics/playback` THEN the system SHALL send query params `date_from` and `date_to` matching the backend's validated parameter names, so date filtering works correctly

2.3 WHEN the frontend receives the analytics response THEN the system SHALL correctly parse the `{ data: { total_spots, by_source, by_screen, by_content } }` structure returned by the backend and display it in the UI (adapting the frontend types and UI to match the actual backend response)

2.4 WHEN the player authenticates and receives `heartbeat_interval_seconds` from the config endpoint THEN the system SHALL start a periodic timer that sends `POST /api/device/heartbeat` with the required payload (`venue_id`, `timestamp`, `storage`, `uptime_seconds`, `playlist_version`) at the configured interval

2.5 WHEN the backend groups endpoints return responses THEN the system SHALL wrap responses in `{ data: ... }` envelope consistent with all other admin API endpoints (screens, playlists, content), and the frontend SHALL unwrap `r.data.data`

2.6 WHEN the backend tenant individual endpoints (show, create, update) return responses THEN the system SHALL wrap responses in `{ data: ... }` envelope consistent with all other admin API endpoints, and the frontend SHALL unwrap `r.data.data`

2.7 WHEN a super_admin user is logged in THEN the system SHALL display a global tenant selector in the header (right side) that allows them to choose which tenant they are operating as, and this selected tenant SHALL be used automatically for all tenant-scoped operations (creating screens, groups, playlists, uploading content)

2.8 WHEN a super_admin user creates a playlist THEN the system SHALL automatically include the globally-selected `tenant_id` in the API request without requiring a per-form tenant selector

2.9 WHEN a super_admin user creates a screen group THEN the system SHALL automatically include the globally-selected `tenant_id` in the API request without requiring a per-form tenant selector

2.10 WHEN the frontend calls `PUT /admin/screens/{id}/sources` with source toggle data THEN the system SHALL send the request in the batch format `{ sources: { prodooh: { enabled: true }, gam: { enabled: false }, ... } }` that the backend's `SourceToggleController` expects

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the screens API endpoints are called THEN the system SHALL CONTINUE TO return responses wrapped in `{ data: ... }` envelope and the frontend SHALL CONTINUE TO correctly transform `loop_config` and `sources_config` fields

3.2 WHEN the playlists API endpoints are called THEN the system SHALL CONTINUE TO return responses wrapped in `{ data: ... }` envelope and the frontend SHALL CONTINUE TO correctly unwrap `r.data.data`

3.3 WHEN the content API endpoints (list, upload, delete) are called THEN the system SHALL CONTINUE TO return responses wrapped in `{ data: ... }` envelope and the frontend SHALL CONTINUE TO correctly unwrap them

3.4 WHEN the admin login endpoint is called THEN the system SHALL CONTINUE TO return `{ token, user }` and the frontend SHALL CONTINUE TO store the token from `data.token` in localStorage

3.5 WHEN the player authenticates with `POST /api/device/auth` THEN the system SHALL CONTINUE TO return `{ access_token, expires_in }` and the player SHALL CONTINUE TO store and use the JWT for subsequent API calls

3.6 WHEN the tenants list endpoint is called THEN the system SHALL CONTINUE TO return paginated data and the frontend SHALL CONTINUE TO extract the items array correctly

3.7 WHEN a tenant_admin user operates on resources THEN the system SHALL CONTINUE TO use their implicit `tenant_id` from their user record — the global tenant selector SHALL NOT appear for tenant_admin users

3.8 WHEN a super_admin creates a screen (which already has a per-form tenant selector) THEN the system SHALL CONTINUE TO work, migrating to use the global tenant context instead of the per-form selector

3.9 WHEN the loop config endpoint `PUT /admin/screens/{id}/loop` is called with `{ slots: [...] }` THEN the system SHALL CONTINUE TO accept and process the request correctly since this format already matches between frontend and backend
