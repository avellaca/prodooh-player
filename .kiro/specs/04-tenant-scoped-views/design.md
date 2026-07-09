# Design Document: Tenant-Scoped Views

## Overview

This feature centralizes tenant scoping for super_admin users by introducing an Axios request interceptor that injects `tenant_id` into all API requests, invalidating the TanStack Query cache on tenant change, gating data views behind tenant selection, and removing the per-form tenant selector from the upload flow.

The architecture relies on three coordinated mechanisms:
1. A **request interceptor** that reads `selectedTenantId` from localStorage at request time
2. A **TenantContext enhancement** that invalidates the query cache when the tenant changes
3. An **AppLayout gate** that shows an empty state when no tenant is selected

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ App                                                     │
│  ┌─────────────────────────────────────────────────┐    │
│  │ QueryClientProvider                             │    │
│  │  ┌──────────────────────────────────────────┐   │    │
│  │  │ TenantProvider                           │   │    │
│  │  │  ┌───────────────────────────────────┐   │   │    │
│  │  │  │ BrowserRouter                     │   │   │    │
│  │  │  │  ┌────────────────────────────┐   │   │   │    │
│  │  │  │  │ AppLayout                  │   │   │   │    │
│  │  │  │  │  ┌─────────────────────┐   │   │   │   │    │
│  │  │  │  │  │ Header              │   │   │   │   │    │
│  │  │  │  │  │ (Tenant Selector)   │   │   │   │   │    │
│  │  │  │  │  └─────────────────────┘   │   │   │   │    │
│  │  │  │  │  ┌─────────────────────┐   │   │   │   │    │
│  │  │  │  │  │ TenantGate          │   │   │   │   │    │
│  │  │  │  │  │  (empty state OR    │   │   │   │   │    │
│  │  │  │  │  │   <Outlet />)       │   │   │   │   │    │
│  │  │  │  │  └─────────────────────┘   │   │   │   │    │
│  │  │  │  └────────────────────────┘   │   │   │   │    │
│  │  │  └───────────────────────────────┘   │   │    │
│  │  └──────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘

Request Flow:
  Component → api.get('/admin/screens') → Axios Interceptor
    → reads localStorage('selected_tenant_id')
    → appends ?tenant_id=xxx to URL
    → sends request to backend
```

## Components and Interfaces

### 1. Axios Request Interceptor (`src/lib/axios.ts`)

A new request interceptor added to the shared `api` instance. It reads `selected_tenant_id` from localStorage at request time (not from a closure) to guarantee the latest value.

```typescript
const TENANT_STORAGE_KEY = 'selected_tenant_id';

api.interceptors.request.use((config) => {
  const tenantId = localStorage.getItem(TENANT_STORAGE_KEY);
  if (tenantId) {
    // Don't overwrite if tenant_id already present in params
    const params = new URLSearchParams(config.params);
    if (!params.has('tenant_id')) {
      config.params = { ...config.params, tenant_id: tenantId };
    }
  }
  return config;
});
```

**Key decisions:**
- Reads from localStorage (not React state) so it works outside the React tree and always has the latest value at request time.
- Preserves existing `tenant_id` params to allow explicit overrides.
- Placed after the auth interceptor so both token and tenant_id are injected.

### 2. TenantContext Enhancement (`src/contexts/TenantContext.tsx`)

The `setSelectedTenantId` callback is enhanced to invalidate the entire query cache when the tenant changes.

```typescript
const setSelectedTenantId = useCallback(
  (tenantId: string | null) => {
    if (!isSuperAdmin) return;
    setSelectedTenantIdState(tenantId);
    // Invalidate all queries so views refetch with new tenant scope
    queryClient.invalidateQueries();
  },
  [isSuperAdmin, queryClient],
);
```

**Key decisions:**
- Invalidates ALL queries (not selective) because every data view depends on tenant scope.
- No `useEffect` — the invalidation is triggered directly in the event handler (per React best practices).
- The existing `useEffect` for localStorage sync remains as it's a legitimate external system sync.

### 3. AppLayout Tenant Gate (`src/components/layout/AppLayout.tsx`)

AppLayout conditionally renders an empty state overlay when a super_admin has no tenant selected.

```typescript
export default function AppLayout() {
  const { user } = useAuth();
  const { selectedTenantId } = useTenantContext();

  const isSuperAdmin = user?.role === 'super_admin';
  const needsTenantSelection = isSuperAdmin && !selectedTenantId;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 p-6">
        {needsTenantSelection ? <TenantSelectionPrompt /> : <Outlet />}
      </main>
    </div>
  );
}
```

**Key decisions:**
- The Header (with tenant selector) remains visible so the user can select a tenant.
- `<Outlet />` is replaced with the prompt — no route navigation occurs for data views.
- Non-super_admin users are unaffected (they always see `<Outlet />`).

### 4. TenantSelectionPrompt Component

A simple inline component within AppLayout (or extracted to a shared component) that prompts tenant selection.

```typescript
function TenantSelectionPrompt() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
      <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
      <h2 className="text-lg font-semibold mb-2">Selecciona un tenant</h2>
      <p className="text-sm text-muted-foreground max-w-md">
        Selecciona un tenant en el selector del encabezado para ver sus datos.
      </p>
    </div>
  );
}
```

### 5. UploadDropzone Simplification (`src/features/content/components/UploadDropzone.tsx`)

Remove the per-form tenant selector and the `tenantId` option from the upload call. The Axios interceptor handles tenant scoping automatically.

```typescript
export function UploadDropzone({ onUploadSuccess }: UploadDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const uploadContent = useUploadContent();

  function handleFile(file: File) {
    setUploadProgress(0);
    uploadContent.mutate(
      { file, options: { onUploadProgress: (percent) => setUploadProgress(percent) } },
      {
        onSuccess: () => { setUploadProgress(null); onUploadSuccess(); },
        onError: () => { setUploadProgress(null); },
      },
    );
  }
  // ... drag/drop handlers unchanged
}
```

### 6. Content API Simplification (`src/features/content/api.ts`)

Remove `tenantId` from `UploadOptions` and the `tenant_id` form field from the upload function.

```typescript
export interface UploadOptions {
  onUploadProgress?: (progress: number) => void;
}

export const contentApi = {
  upload: (file: File, options?: UploadOptions) => {
    const formData = new FormData();
    formData.append('file', file);
    // No tenant_id in FormData — interceptor handles it via query param

    return api
      .post<{ data: Content }>('/admin/content', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (event) => {
          if (options?.onUploadProgress && event.total) {
            const percent = Math.round((event.loaded * 100) / event.total);
            options.onUploadProgress(percent);
          }
        },
      })
      .then((r) => r.data.data);
  },
  // ... other methods unchanged
};
```

### Interfaces

#### TenantContext Interface (unchanged shape, enhanced behavior)

```typescript
interface TenantContextValue {
  selectedTenantId: string | null;
  setSelectedTenantId: (tenantId: string | null) => void;
}
```

### UploadOptions Interface (simplified)

```typescript
export interface UploadOptions {
  onUploadProgress?: (progress: number) => void;
}
```

### Axios Interceptor Contract

The interceptor operates as a pure function on `AxiosRequestConfig`:

```typescript
type InterceptorBehavior = (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig;
// Invariant: if localStorage has 'selected_tenant_id' AND config.params doesn't have 'tenant_id',
//   then returned config.params includes { tenant_id: <stored value> }
// Invariant: if localStorage has no 'selected_tenant_id',
//   then config.params is unchanged
// Invariant: if config.params already has 'tenant_id',
//   then config.params is unchanged
```

## Data Models

No new data models are introduced. The feature operates on existing models (`Screen`, `Playlist`, `Content`, `ScreenGroup`, analytics data) — it only changes how they are filtered at the API layer.

### localStorage Schema

| Key | Type | Description |
|-----|------|-------------|
| `selected_tenant_id` | `string \| null` | The UUID of the currently selected tenant for super_admin users |

## Error Handling

| Scenario | Behavior |
|----------|----------|
| localStorage `selected_tenant_id` references a deleted tenant | Backend returns empty results; user selects a different tenant |
| Interceptor encounters malformed params | Interceptor uses object spread (`{ ...config.params }`) which handles undefined gracefully |
| Query invalidation fails | TanStack Query handles retry internally; views show stale data with refetch indicators |
| super_admin has no tenants available | Tenant selector shows empty list; empty state persists |

## Testing Strategy

### Unit Tests (Example-based)

- **Req 1.1/1.4**: Render AppLayout with super_admin and no `selectedTenantId` → verify empty state prompt is displayed
- **Req 1.2**: Verify `<Outlet />` is not rendered when no tenant is selected
- **Req 1.3**: Set localStorage with tenant ID, render TenantProvider → verify state is restored
- **Req 3.1**: Call `setSelectedTenantId` with new value → verify `queryClient.invalidateQueries()` is called
- **Req 3.3**: Change tenant → verify no `window.location.reload` occurs
- **Req 4.1–4.5**: Integration tests verifying each view sends requests with correct `tenant_id` param
- **Req 5.1**: Render UploadDropzone → verify no tenant `<Select>` is rendered
- **Req 6.1/6.2**: Render Header with super_admin vs tenant_admin → verify selector visibility

### Property Tests (fast-check, 100+ iterations)

- **Property 1**: Generate random tenant IDs and request configs → verify interceptor appends `tenant_id`
- **Property 2**: Generate random request configs with no localStorage → verify no `tenant_id` added
- **Property 3**: Generate configs with pre-existing `tenant_id` → verify value preserved
- **Property 4**: Generate random files → verify FormData never contains `tenant_id`
- **Property 5**: Generate random tenant ID strings → verify localStorage persistence

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Interceptor injects tenant_id when tenant is selected

*For any* valid tenant ID stored in localStorage under `selected_tenant_id`, and *for any* Axios request config without an existing `tenant_id` param, the interceptor SHALL produce a config whose params include `tenant_id` equal to the stored value.

**Validates: Requirements 2.1**

### Property 2: Interceptor does not inject tenant_id when no tenant is selected

*For any* Axios request config, when localStorage does not contain `selected_tenant_id`, the interceptor SHALL return a config with params unchanged (no `tenant_id` added).

**Validates: Requirements 2.2**

### Property 3: Interceptor preserves existing tenant_id parameter

*For any* Axios request config that already contains a `tenant_id` in its params, and *for any* value stored in localStorage, the interceptor SHALL preserve the original `tenant_id` value without overwriting it.

**Validates: Requirements 2.4**

### Property 4: Upload FormData never contains tenant_id

*For any* file upload via `contentApi.upload`, the FormData payload SHALL NOT contain a `tenant_id` field. Tenant scoping is handled exclusively by the Axios interceptor.

**Validates: Requirements 5.3**

### Property 5: Tenant selection persists to localStorage

*For any* valid tenant ID string, when `setSelectedTenantId` is called with that value by a super_admin user, localStorage SHALL contain that exact value under the `selected_tenant_id` key.

**Validates: Requirements 6.3**
