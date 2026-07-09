# Implementation Plan: Tenant-Scoped Views

## Overview

Centralize tenant scoping for super_admin users via an Axios request interceptor, TanStack Query cache invalidation on tenant change, an AppLayout gate for mandatory tenant selection, and removal of the per-form tenant selector from UploadDropzone.

## Tasks

- [x] 1. Add tenant_id request interceptor to Axios
  - [x] 1.1 Add tenant_id injection interceptor to `src/lib/axios.ts`
    - Define `TENANT_STORAGE_KEY = 'selected_tenant_id'` constant
    - Add a new `api.interceptors.request.use()` AFTER the existing auth interceptor
    - Read `localStorage.getItem(TENANT_STORAGE_KEY)` at request time
    - If value exists AND `config.params` does not already contain `tenant_id`, spread existing params and add `tenant_id`
    - If value is null or `config.params` already has `tenant_id`, return config unchanged
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 2. Enhance TenantContext with query cache invalidation
  - [x] 2.1 Add `queryClient.invalidateQueries()` call inside `setSelectedTenantId` callback in `src/contexts/TenantContext.tsx`
    - Import `queryClient` from `@/lib/query-client` (already available via `useQueryClient`)
    - Inside the `setSelectedTenantId` callback, after `setSelectedTenantIdState(tenantId)`, call `queryClient.invalidateQueries()`
    - Do NOT use useEffect for this — the invalidation is a direct response to the user action
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 3. Add TenantGate to AppLayout
  - [x] 3.1 Implement TenantGate logic in `src/components/layout/AppLayout.tsx`
    - Import `useAuth` from `@/hooks/use-auth` and `useTenantContext` from `@/contexts/TenantContext`
    - Import `useLocation` from `react-router-dom`
    - Determine `isSuperAdmin` from `user?.role === 'super_admin'`
    - Determine `needsTenantSelection = isSuperAdmin && !selectedTenantId`
    - Define a list of exempt paths: `['/tenants']` (Tenants page should NOT be gated)
    - Check current path with `useLocation()` — if path starts with an exempt prefix, skip the gate
    - Render `<TenantSelectionPrompt />` when `needsTenantSelection` is true and path is not exempt, otherwise render `<Outlet />`
    - _Requirements: 1.1, 1.2, 1.4_

  - [x] 3.2 Create `TenantSelectionPrompt` component inline in AppLayout
    - Import `Building2` icon from `lucide-react`
    - Render a centered flex container with min-h-[400px]
    - Display Building2 icon (h-12 w-12, text-muted-foreground)
    - Heading: "Selecciona un tenant"
    - Description: "Selecciona un tenant en el selector del encabezado para ver sus datos."
    - _Requirements: 1.1, 1.4_

- [x] 4. Remove per-form tenant selector from upload flow
  - [x] 4.1 Remove `tenantId` from `UploadOptions` interface and upload function in `src/features/content/api.ts`
    - Remove `tenantId?: string` from the `UploadOptions` interface
    - Remove the `if (options?.tenantId) { formData.append('tenant_id', options.tenantId); }` block from `contentApi.upload`
    - The interceptor now handles tenant scoping via query param automatically
    - _Requirements: 5.2, 5.3_

  - [x] 4.2 Simplify `src/features/content/components/UploadDropzone.tsx`
    - Remove imports: `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue`, `useAuth`, `useTenants`
    - Remove state: `selectedTenantId`, `effectiveTenantId`
    - Remove the entire `{isSuperAdmin && (...)}` tenant selector JSX block
    - Simplify `handleFile`: remove the `tenantId` logic, just pass `{ onUploadProgress }` as options
    - Remove the `isSuperAdmin && !effectiveTenantId` disabled condition from the button (the gate already prevents reaching this without a tenant)
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 5. Checkpoint - Verify build and manual integration
  - Ensure all tests pass, ask the user if questions arise.

- [ ]* 6. Property-based tests for correctness properties
  - [ ]* 6.1 Write property test: Interceptor injects tenant_id when tenant is selected
    - **Property 1: Interceptor injects tenant_id when tenant is selected**
    - **Validates: Requirements 2.1**
    - Use fast-check to generate arbitrary tenant ID strings and Axios config objects
    - Set localStorage with generated tenant ID, run interceptor logic, assert `config.params.tenant_id` equals stored value

  - [ ]* 6.2 Write property test: Interceptor does not inject tenant_id when no tenant selected
    - **Property 2: Interceptor does not inject tenant_id when no tenant is selected**
    - **Validates: Requirements 2.2**
    - Use fast-check to generate arbitrary Axios config objects with no localStorage value
    - Assert returned config.params does not contain `tenant_id`

  - [ ]* 6.3 Write property test: Interceptor preserves existing tenant_id parameter
    - **Property 3: Interceptor preserves existing tenant_id parameter**
    - **Validates: Requirements 2.4**
    - Use fast-check to generate configs with a pre-existing `tenant_id` param and a different localStorage value
    - Assert the original `tenant_id` is preserved, not overwritten

  - [ ]* 6.4 Write property test: Upload FormData never contains tenant_id
    - **Property 4: Upload FormData never contains tenant_id**
    - **Validates: Requirements 5.3**
    - Use fast-check to generate random File-like objects
    - Call `contentApi.upload` logic, assert FormData does not have a `tenant_id` entry

  - [ ]* 6.5 Write property test: Tenant selection persists to localStorage
    - **Property 5: Tenant selection persists to localStorage**
    - **Validates: Requirements 6.3**
    - Use fast-check to generate random UUID-like strings
    - Call `setSelectedTenantId` with generated value, assert localStorage contains exact value

- [x] 7. Final checkpoint - Full build and test verification
  - Run `npm run build` and `npm run test:run` to ensure no regressions
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The Tenants page (`/tenants`) is explicitly exempt from the tenant gate — super_admin needs unrestricted access to manage all tenants
- NO useEffect for event handling — cache invalidation happens directly in the `setSelectedTenantId` handler
- UI text in Spanish, code in English per project conventions

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["3.1", "3.2", "4.1", "4.2"] },
    { "id": 3, "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5"] },
    { "id": 4, "tasks": [] }
  ]
}
```
