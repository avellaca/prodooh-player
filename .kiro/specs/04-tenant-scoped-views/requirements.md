# Requirements Document

## Introduction

This feature transforms the super_admin experience into a tenant-scoped impersonation mode. When a super_admin selects a tenant from the global header selector, the entire web application filters all data views (screens, playlists, content, groups, analytics) by that tenant. A centralized Axios interceptor injects `tenant_id` into all API calls, TanStack Query caches invalidate on tenant change, and the per-form tenant selector in the content upload flow is removed since the global selector replaces it.

## Glossary

- **Admin_App**: The Prodooh admin-frontend single-page application built with React, TanStack Query, and Axios
- **Global_Tenant_Selector**: The `<Select>` component in the application header that allows a super_admin to choose a tenant context
- **TenantContext**: The React context (`TenantContext.tsx`) that stores and exposes `selectedTenantId` via the `useTenantContext()` hook
- **Axios_Interceptor**: A centralized request interceptor on the shared Axios instance (`api`) that modifies outgoing HTTP requests
- **Query_Cache**: The TanStack Query client cache that stores server state for all feature queries
- **super_admin**: A user with role `super_admin` who can manage multiple tenants
- **UploadDropzone**: The content upload component (`UploadDropzone.tsx`) that currently contains a per-form tenant selector

## Requirements

### Requirement 1: Mandatory Tenant Selection

**User Story:** As a super_admin, I want the app to require me to select a tenant before showing any data, so that I always operate within a clear tenant scope and avoid accidentally viewing cross-tenant data.

#### Acceptance Criteria

1. WHILE no tenant is selected in the Global_Tenant_Selector, THE Admin_App SHALL display an empty state prompting the super_admin to select a tenant.
2. WHILE no tenant is selected in the Global_Tenant_Selector, THE Admin_App SHALL prevent navigation to data views (screens, playlists, content, groups, analytics).
3. WHEN a super_admin logs in with a previously persisted `selectedTenantId` in localStorage, THE Admin_App SHALL restore that tenant selection and display data for the persisted tenant.
4. WHEN a super_admin logs in without a previously persisted `selectedTenantId`, THE Admin_App SHALL display the empty state prompting tenant selection.

### Requirement 2: Centralized Tenant ID Injection via Axios Interceptor

**User Story:** As a super_admin, I want all API requests to automatically include the selected tenant filter, so that I see only that tenant's data without manual intervention on each view.

#### Acceptance Criteria

1. WHILE a tenant is selected in the TenantContext, THE Axios_Interceptor SHALL append a `tenant_id` query parameter with the selected tenant ID to all outgoing API requests.
2. WHILE no tenant is selected in the TenantContext, THE Axios_Interceptor SHALL send API requests without a `tenant_id` query parameter.
3. THE Axios_Interceptor SHALL read the `selectedTenantId` value from the TenantContext storage (localStorage) at request time to ensure the latest selection is used.
4. WHEN the API request already contains a `tenant_id` parameter, THE Axios_Interceptor SHALL preserve the existing value without overwriting.

### Requirement 3: Automatic Query Cache Invalidation on Tenant Change

**User Story:** As a super_admin, I want all views to refresh seamlessly when I switch tenants in the global selector, so that I immediately see the new tenant's data without a full page reload.

#### Acceptance Criteria

1. WHEN the super_admin selects a different tenant in the Global_Tenant_Selector, THE Admin_App SHALL invalidate all queries in the Query_Cache.
2. WHEN the Query_Cache is invalidated due to a tenant change, THE Admin_App SHALL trigger a refetch of all active queries to display the newly selected tenant's data.
3. WHEN the super_admin changes the selected tenant, THE Admin_App SHALL NOT perform a full page reload.
4. WHILE queries are refetching after a tenant change, THE Admin_App SHALL display loading indicators on affected views.

### Requirement 4: Tenant-Scoped Data Filtering Across All Views

**User Story:** As a super_admin, I want all data views to show only the selected tenant's data, so that the experience is equivalent to impersonating that tenant.

#### Acceptance Criteria

1. WHILE a tenant is selected, THE Admin_App SHALL display only screens belonging to the selected tenant on the Screens view.
2. WHILE a tenant is selected, THE Admin_App SHALL display only playlists belonging to the selected tenant on the Playlists view.
3. WHILE a tenant is selected, THE Admin_App SHALL display only content belonging to the selected tenant on the Content view.
4. WHILE a tenant is selected, THE Admin_App SHALL display only groups belonging to the selected tenant on the Groups view.
5. WHILE a tenant is selected, THE Admin_App SHALL display only analytics data belonging to the selected tenant on the Analytics view.

### Requirement 5: Removal of Per-Form Tenant Selector in Content Upload

**User Story:** As a super_admin, I want the content upload flow to use the globally selected tenant instead of a separate per-form selector, so that the tenant context is consistent across the entire application.

#### Acceptance Criteria

1. THE UploadDropzone SHALL NOT render a per-form tenant selector for super_admin users.
2. WHEN a super_admin uploads content, THE Admin_App SHALL associate the uploaded content with the tenant selected in the Global_Tenant_Selector.
3. WHEN a super_admin uploads content, THE UploadDropzone SHALL NOT include an explicit `tenant_id` field in the upload form data (the Axios_Interceptor handles tenant scoping).

### Requirement 6: Tenant Selector Visibility and Persistence

**User Story:** As a super_admin, I want the global tenant selector to be always visible in the header and persist my selection across sessions, so that I can switch contexts quickly and resume where I left off.

#### Acceptance Criteria

1. WHILE the user role is super_admin, THE Global_Tenant_Selector SHALL be visible in the application header.
2. WHILE the user role is not super_admin, THE Global_Tenant_Selector SHALL NOT be visible in the application header.
3. WHEN a super_admin selects a tenant, THE TenantContext SHALL persist the selection to localStorage.
4. WHEN a super_admin clears the browser session and returns, THE Admin_App SHALL restore the tenant selection from localStorage if the value is still valid.
