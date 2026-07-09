# Implementation Plan: Admin Frontend

## Overview

Implementación incremental del Admin Frontend como una SPA con React 18 + Vite + TypeScript. Se construye desde la base (scaffolding y configuración) hacia las features individuales, asegurando que cada paso se integre con los anteriores. Todo el data fetching usa TanStack Query, los formularios usan React Hook Form + Zod, y la UI se basa en Shadcn/ui + Tailwind CSS.

## Tasks

- [x] 1. Scaffolding del proyecto y configuración base
  - [x] 1.1 Crear proyecto Vite con template React + TypeScript en `admin-frontend/`
    - Ejecutar `npm create vite@latest admin-frontend -- --template react-ts`
    - Configurar `vite.config.ts` con alias `@/` apuntando a `src/`
    - Crear `tsconfig.json` con paths alias `@/*` → `src/*`
    - Crear `.env.example` con `VITE_API_BASE_URL=http://localhost:8000/api`
    - _Requirements: 15.1_

  - [x] 1.2 Instalar y configurar Tailwind CSS con colores de marca
    - Instalar `tailwindcss`, `postcss`, `autoprefixer`
    - Crear `tailwind.config.ts` con colores personalizados: navy (#0f1623), primary (#e8403a), gray-dark (#374151)
    - Crear `src/styles/globals.css` con directivas de Tailwind y CSS variables
    - Crear `postcss.config.js`
    - _Requirements: 14.1, 14.4_

  - [x] 1.3 Instalar dependencias principales del proyecto
    - Instalar: `react-router-dom`, `axios`, `@tanstack/react-query`, `@tanstack/react-table`, `react-hook-form`, `@hookform/resolvers`, `zod`, `sonner`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `date-fns`
    - Instalar devDependencies: `vitest`, `@testing-library/react`, `msw`, `jsdom`
    - _Requirements: 14.2, 14.5, 15.5_

  - [x] 1.4 Configurar Shadcn/ui e inicializar componentes base
    - Ejecutar `npx shadcn@latest init` con estilo default y Tailwind
    - Agregar componentes: Button, Input, Dialog, Table, Switch, Select, Label, Card, DropdownMenu, Separator, Skeleton, Tabs
    - Crear `src/lib/utils.ts` con la función `cn()` (clsx + tailwind-merge)
    - _Requirements: 14.2_

- [x] 2. Infraestructura core: HTTP, Query Client, Auth y Routing
  - [x] 2.1 Crear instancia de Axios con interceptors
    - Crear `src/lib/axios.ts` con instancia configurada con `baseURL` desde `import.meta.env.VITE_API_BASE_URL`
    - Implementar request interceptor que agrega `Authorization: Bearer {token}` desde localStorage
    - Implementar response interceptor que detecta 401, elimina token y redirige a `/login`
    - Configurar headers por defecto: `Accept: application/json`, `Content-Type: application/json`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 1.2, 1.3_

  - [x] 2.2 Configurar TanStack Query client
    - Crear `src/lib/query-client.ts` con configuración: `staleTime: 30_000`, `retry: 1` para queries, `retry: 0` para mutations, `refetchOnWindowFocus: false`
    - _Requirements: 13.5, 15.5_

  - [x] 2.3 Implementar hook de autenticación y API de auth
    - Crear `src/types/auth.ts` con interfaces: `AuthUser`, `LoginCredentials`, `LoginResponse`
    - Crear `src/features/auth/api.ts` con funciones: `loginRequest`, `logoutRequest`, `getCurrentUser`
    - Crear `src/hooks/use-auth.ts` con hook `useAuth` que expone: `user`, `isLoading`, `login`, `logout`
    - Crear `src/features/auth/hooks.ts` con `useLogin` (useMutation) y `useLogout` (useMutation)
    - _Requirements: 1.1, 1.4, 1.7_

  - [x] 2.4 Configurar React Router v6 con guards de protección
    - Crear `src/components/layout/ProtectedRoute.tsx` que verifica token y valida sesión con `useCurrentUser()`
    - Crear `src/components/layout/RoleGuard.tsx` que valida rol del usuario y redirige con toast si no tiene acceso
    - Crear `src/routes.tsx` con la definición completa de rutas (públicas, protegidas, por rol)
    - _Requirements: 1.6, 2.1, 2.2, 2.3, 2.4_

  - [x] 2.5 Crear entry point y App con providers
    - Crear `src/App.tsx` con `QueryClientProvider`, `BrowserRouter`, `Toaster` (Sonner) y rutas
    - Crear `src/main.tsx` con `ReactDOM.createRoot` y render de `<App />`
    - _Requirements: 14.5, 15.5_

- [x] 3. Layout principal y componentes compartidos
  - [x] 3.1 Implementar layout principal (AppLayout + Header)
    - Crear `src/components/layout/AppLayout.tsx` con estructura: Header + contenido principal con `<Outlet />`
    - Crear `src/components/layout/Header.tsx` con fondo navy, nombre de la app, navegación condicional por rol y botón de cerrar sesión
    - _Requirements: 2.1, 2.2, 2.5_

  - [x] 3.2 Implementar componentes compartidos reutilizables
    - Crear `src/components/shared/DataTable.tsx` como wrapper genérico de TanStack Table con sorting por columnas
    - Crear `src/components/shared/ConfirmDialog.tsx` para diálogos de confirmación de acciones destructivas
    - Crear `src/components/shared/LoadingState.tsx` con skeleton loader
    - Crear `src/components/shared/ErrorState.tsx` con mensaje de error y botón "Reintentar"
    - Crear `src/components/shared/TokenRevealDialog.tsx` para mostrar tokens una sola vez con botón copiar
    - _Requirements: 13.1, 13.2, 14.3_

  - [x] 3.3 Implementar componente FormField wrapper
    - Crear `src/components/forms/FormField.tsx` que integra label, input y mensajes de error de React Hook Form
    - _Requirements: 13.4_

- [x] 4. Checkpoint - Verificar infraestructura base
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Módulo de autenticación (Login)
  - [x] 5.1 Implementar página de login
    - Crear `src/features/auth/pages/LoginPage.tsx` con formulario de email + contraseña usando React Hook Form + Zod
    - Integrar `useLogin` mutation que almacena token en localStorage y redirige a `/screens` al éxito
    - Mostrar error genérico sin revelar si el email existe en caso de credenciales inválidas
    - _Requirements: 1.1, 1.5_

  - [ ]* 5.2 Escribir tests de integración para flujo de auth
    - Test login exitoso: envío de credenciales, almacenamiento de token, redirección
    - Test login fallido: muestra mensaje de error, no almacena token
    - Test 401 redirect: interceptor detecta 401, elimina token, redirige a login
    - Test logout: elimina token, redirige a login
    - _Requirements: 1.1, 1.3, 1.4, 1.5_

- [x] 6. Módulo de tenants (solo super_admin)
  - [x] 6.1 Implementar API y hooks de tenants
    - Crear `src/types/models.ts` con interface `Tenant` y tipos de input
    - Crear `src/schemas/tenant.schema.ts` con esquema Zod de validación
    - Crear `src/features/tenants/api.ts` con funciones: `list`, `get`, `create`, `update`, `delete`
    - Crear `src/features/tenants/hooks.ts` con hooks: `useTenants`, `useTenant`, `useCreateTenant`, `useUpdateTenant`, `useDeleteTenant`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 6.2 Implementar página y formulario de tenants
    - Crear `src/features/tenants/pages/TenantsPage.tsx` con DataTable de tenants (nombre, pantallas, fecha)
    - Crear `src/features/tenants/components/TenantForm.tsx` con campo nombre obligatorio
    - Implementar creación, edición y eliminación con invalidación de cache y toasts
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 6.3 Escribir tests unitarios para módulo de tenants
    - Test renderizado de tabla con datos y vacía
    - Test validación de formulario con Zod
    - Test diálogo de confirmación de eliminación
    - _Requirements: 3.1, 3.2, 3.4_

- [x] 7. Módulo de pantallas (listado y creación)
  - [x] 7.1 Implementar tipos, schemas, API y hooks de pantallas
    - Agregar interfaces `Screen`, `LoopSlot`, `SourcesConfig`, `Screenshot` a `src/types/models.ts`
    - Crear `src/schemas/screen.schema.ts` con esquemas Zod para crear/editar pantalla
    - Crear `src/features/screens/api.ts` con funciones: `list`, `get`, `create`, `update`, `regenerateToken`, `updateLoop`, `updateSources`, `getScreenshots`
    - Crear `src/features/screens/hooks.ts` con hooks correspondientes
    - _Requirements: 4.1, 4.4, 4.6, 4.7, 5.6, 5.7, 6.3, 7.2_

  - [x] 7.2 Implementar página de listado de pantallas
    - Crear `src/features/screens/pages/ScreensPage.tsx` con DataTable mostrando: nombre, tenant (solo super_admin), grupo, estado online/offline con indicador visual (punto verde/rojo), orientación, resolución, última actividad
    - Calcular estado online/offline comparando `last_heartbeat` contra umbral de 2 minutos en render (sin useEffect)
    - Implementar navegación al detalle al hacer clic en una fila
    - _Requirements: 4.1, 4.2, 4.3, 4.6_

  - [x] 7.3 Implementar formulario de creación de pantalla
    - Crear `src/features/screens/components/ScreenForm.tsx` con campos: nombre, tenant_id (solo super_admin), venue_id, orientación, resolución
    - Integrar `useCreateScreen` mutation con invalidación de cache
    - Al éxito, mostrar `TokenRevealDialog` con el `device_token` retornado
    - _Requirements: 4.4, 4.5_

- [x] 8. Vista de detalle de pantalla
  - [x] 8.1 Implementar página de detalle de pantalla
    - Crear `src/features/screens/pages/ScreenDetailPage.tsx` mostrando: datos básicos, estado online/offline con timestamp, loop config, fuentes activas, screenshots y playlists asignadas
    - Implementar botón "Regenerar token" con diálogo de confirmación y `TokenRevealDialog`
    - Implementar edición de datos básicos con formulario y mutation
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 4.7_

  - [x] 8.2 Implementar componente LoopEditor
    - Crear `src/features/screens/components/LoopEditor.tsx` con lista visual de slots
    - Cada slot: selector de fuente (prodooh, gam, url, playlist) + input numérico de duración
    - Botón "Agregar slot", botón "Eliminar" por slot (mínimo 1), botón "Guardar loop"
    - Validar que cada slot tenga fuente y duración > 0 antes de enviar
    - Enviar PUT a `/api/admin/screens/{id}/loop` con mutation e invalidar cache al éxito
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 8.3 Implementar componente SourceToggles con optimistic update
    - Crear `src/features/screens/components/SourceToggles.tsx` con switches para cada fuente
    - Implementar mutación optimista: actualizar cache inmediatamente, revertir en caso de error
    - Mostrar toast de éxito o error según resultado
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 8.4 Implementar galería de screenshots
    - Crear `src/features/screens/components/ScreenshotGallery.tsx` con miniaturas ordenadas por fecha
    - Mostrar fecha/hora bajo cada miniatura
    - Implementar lightbox/modal al hacer clic en una miniatura
    - _Requirements: 12.1, 12.2, 12.3_

  - [ ]* 8.5 Escribir tests para LoopEditor y SourceToggles
    - Test LoopEditor: agregar slot, eliminar slot, validación mínimo 1 slot, validación de campos
    - Test SourceToggles: optimistic update, revert en error
    - _Requirements: 6.1, 6.2, 6.5, 7.1, 7.4_

- [x] 9. Checkpoint - Verificar módulos de pantallas
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Módulo de grupos de pantallas
  - [x] 10.1 Implementar API, hooks y schemas de grupos
    - Agregar interface `ScreenGroup` a `src/types/models.ts` (si no existe)
    - Crear `src/schemas/group.schema.ts` con esquema Zod
    - Crear `src/features/groups/api.ts` con funciones: `list`, `get`, `create`, `update`, `delete`, `assignScreens`
    - Crear `src/features/groups/hooks.ts` con hooks correspondientes
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 10.2 Implementar páginas y componentes de grupos
    - Crear `src/features/groups/pages/GroupsPage.tsx` con DataTable (nombre, pantallas, orientación, resolución)
    - Crear `src/features/groups/pages/GroupDetailPage.tsx` con datos del grupo y lista de pantallas asignadas
    - Crear `src/features/groups/components/GroupForm.tsx` con campos: nombre, duración, orientación, resolución
    - Crear `src/features/groups/components/AssignScreensDialog.tsx` con selector múltiple de pantallas
    - Implementar CRUD completo con invalidación de cache y toasts
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [x] 11. Módulo de playlists
  - [x] 11.1 Implementar API, hooks y schemas de playlists
    - Agregar interfaces `Playlist`, `PlaylistItem` a `src/types/models.ts` (si no existen)
    - Crear `src/schemas/playlist.schema.ts` con esquema Zod para playlist e ítems (tipo, content/url, duración > 0)
    - Crear `src/features/playlists/api.ts` con funciones: `list`, `get`, `create`, `update`, `delete`, `assign`
    - Crear `src/features/playlists/hooks.ts` con hooks correspondientes
    - _Requirements: 9.1, 9.2, 9.4, 9.5, 9.6, 9.7_

  - [x] 11.2 Implementar páginas y componentes de playlists
    - Crear `src/features/playlists/pages/PlaylistsPage.tsx` con DataTable (nombre, ítems, fecha)
    - Crear `src/features/playlists/components/PlaylistForm.tsx` con campo nombre y PlaylistItemEditor
    - Crear `src/features/playlists/components/PlaylistItemEditor.tsx` con lista ordenable: tipo, contenido/URL, duración, botones reordenar
    - Crear `src/features/playlists/components/AssignScreensDialog.tsx` para asignar playlist a pantallas
    - Implementar CRUD completo con invalidación de cache y toasts
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [ ]* 11.3 Escribir tests para PlaylistItemEditor
    - Test reordenamiento de ítems
    - Test validación: tipo requerido, duración > 0
    - Test agregar/eliminar ítems
    - _Requirements: 9.3, 9.7_

- [x] 12. Módulo de contenido (biblioteca multimedia)
  - [x] 12.1 Implementar API, hooks y schemas de contenido
    - Agregar interface `Content` a `src/types/models.ts` (si no existe)
    - Crear `src/schemas/content.schema.ts` con esquema Zod si aplica
    - Crear `src/features/content/api.ts` con funciones: `list`, `upload`, `delete`, `rotate`, `getPreviewUrl`
    - Crear `src/features/content/hooks.ts` con hooks correspondientes
    - _Requirements: 10.1, 10.2, 10.4, 10.5, 10.6_

  - [x] 12.2 Implementar página y componentes de contenido
    - Crear `src/features/content/pages/ContentPage.tsx` con grilla/tabla de contenidos
    - Crear `src/features/content/components/UploadDropzone.tsx` con drag-and-drop, multipart/form-data y barra de progreso usando `onUploadProgress` de Axios
    - Crear `src/features/content/components/ContentPreview.tsx` para previsualización en modal
    - Crear `src/features/content/components/RotateMenu.tsx` con opciones de rotación (90°, 180°, 270°)
    - Implementar eliminación con diálogo de confirmación
    - Mostrar toast de error específico si la subida falla por validación del backend
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

- [x] 13. Módulo de analytics
  - [x] 13.1 Implementar API, hooks y página de analytics
    - Crear `src/features/analytics/api.ts` con función de consulta con rango de fechas
    - Crear `src/features/analytics/hooks.ts` con `useAnalytics` hook
    - Crear `src/features/analytics/pages/AnalyticsPage.tsx` con selector de rango de fechas (default últimos 7 días), botón "Consultar" y tabla/resumen de resultados
    - Mostrar LoadingState mientras la consulta está en progreso
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [x] 14. Checkpoint - Verificar todos los módulos de features
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Configuración de testing y tests finales
  - [x] 15.1 Configurar entorno de testing con Vitest + MSW
    - Crear `vitest.config.ts` con environment jsdom y setup files
    - Crear `src/test/setup.ts` con configuración de Testing Library y MSW handlers base
    - Crear `src/test/mocks/handlers.ts` con handlers mock para endpoints principales del backend
    - Crear `src/test/mocks/server.ts` con setup de MSW server
    - _Requirements: 13.1, 13.2, 13.5_

  - [ ]* 15.2 Escribir tests de integración para flujos principales
    - Test navegación protegida: ProtectedRoute redirige sin token, permite con token
    - Test RoleGuard: super_admin ve tenants, tenant_admin es redirigido
    - Test CRUD completo de una entidad (verificar invalidación de cache)
    - Test manejo de errores: ErrorState con botón reintentar, toast en mutation error
    - _Requirements: 1.6, 2.1, 2.2, 2.3, 13.1, 13.2, 13.4_

- [x] 16. Checkpoint final - Verificar build y tests completos
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Las tareas marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido
- Cada tarea referencia los requisitos específicos para trazabilidad
- Los checkpoints permiten validación incremental
- No se incluyen property-based tests porque el diseño no define Correctness Properties (es una SPA CRUD sin lógica de dominio compleja)
- Todo el data fetching usa exclusivamente TanStack Query (nunca useEffect)
- Los formularios usan React Hook Form + Zod para validación declarativa

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4"] },
    { "id": 3, "tasks": ["2.1", "2.2"] },
    { "id": 4, "tasks": ["2.3", "2.4"] },
    { "id": 5, "tasks": ["2.5"] },
    { "id": 6, "tasks": ["3.1", "3.2", "3.3"] },
    { "id": 7, "tasks": ["5.1"] },
    { "id": 8, "tasks": ["5.2", "6.1", "7.1"] },
    { "id": 9, "tasks": ["6.2", "7.2", "7.3"] },
    { "id": 10, "tasks": ["6.3", "8.1"] },
    { "id": 11, "tasks": ["8.2", "8.3", "8.4"] },
    { "id": 12, "tasks": ["8.5", "10.1", "11.1", "12.1"] },
    { "id": 13, "tasks": ["10.2", "11.2", "12.2", "13.1"] },
    { "id": 14, "tasks": ["11.3", "15.1"] },
    { "id": 15, "tasks": ["15.2"] }
  ]
}
```
