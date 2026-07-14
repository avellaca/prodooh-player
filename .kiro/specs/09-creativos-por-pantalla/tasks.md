# Implementation Plan: Creativos por Pantalla

## Overview

Reingeniería completa del modelo de asignación de creativos: de `order_line_id` a `order_line_target_id`. El plan sigue un orden estricto de dependencias: migraciones de base de datos → controladores backend → servicios → rutas → frontend (tipos, API, hooks, componentes) → navegación → player → property tests.

## Tasks

- [x] 1. Migraciones de base de datos
  - [x] 1.1 Crear migración de schema: agregar `order_line_target_id` a tabla `creatives`
    - Agregar columna `order_line_target_id` (uuid, nullable) con foreign key a `order_line_targets.id` con `onDelete('cascade')`
    - Hacer `order_line_id` nullable (era NOT NULL)
    - Crear índice `idx_creatives_target_id` en `order_line_target_id`
    - _Requirements: 1.1, 1.4, 11.1_

  - [x] 1.2 Crear migración de datos: distribuir creativos existentes a targets
    - Para cada creativo con `order_line_id` sin `order_line_target_id`, asignar el original al primer target y duplicar para los demás targets de esa línea
    - Si la línea no tiene targets, mantener el creativo sin modificar
    - La migración debe ser idempotente (no duplicar creativos ya migrados)
    - Registrar log con: creativos procesados, duplicados creados, errores
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.6_

  - [x] 1.3 Crear migración de índices para tabla `content`
    - Agregar columnas `width` (int, nullable) y `height` (int, nullable) a tabla `content` si no existen
    - Crear índice compuesto `idx_content_resolution` en `(width, height)`
    - _Requirements: 12.3, 15.1_

- [x] 2. Backend — Controladores y servicios core
  - [x] 2.1 Implementar `ResolutionController` con endpoint `GET /order-lines/{orderLineId}/resolutions`
    - Cargar todos los targets de la OrderLine con sus pantallas (directas y via grupo)
    - Agrupar por `(resolution_width, resolution_height)`
    - Calcular `has_creative` y `coverage` (with_creative / total) por grupo
    - Ordenar por `screen_count` descendente
    - Retornar formato: `{ data: [{ resolution_width, resolution_height, screen_count, screens: [{id, name, target_id}], has_creative, coverage }] }`
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 2.2 Implementar `BulkCreativeController` con endpoint `POST /order-lines/{orderLineId}/creatives/bulk-by-resolution`
    - Validar: content_id (exists, mismo tenant), resolution_width, resolution_height, weight (int ≥ 1), active_dates (array dentro del rango de la OrderLine)
    - Validar resolución exacta: Content.width === resolution_width AND Content.height === resolution_height
    - Buscar targets cuya pantalla tenga la resolución solicitada
    - Rechazar con 422 si no hay targets coincidentes
    - Crear creativos en transacción (atomicidad: si uno falla, ninguno se crea)
    - Despachar ManifestRecalculation para cada pantalla afectada
    - Retornar 201 con `{ data: { creatives_created, affected_screens } }`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 2.3 Refactorizar `CreativeController` para operar por target
    - `GET /order-line-targets/{targetId}/creatives`: listar creativos del target con relación `content`
    - `POST /order-line-targets/{targetId}/creatives`: crear creativo validando resolución exacta (content vs screen del target), tenant ownership, weight ≥ 1, active_dates en rango
    - `PUT /creatives/{id}`: actualizar weight, active_dates, content_id con mismas validaciones
    - `DELETE /creatives/{id}`: eliminar creativo
    - Despachar ManifestRecalculation en create/update/delete
    - _Requirements: 1.2, 2.1, 2.2, 2.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [x] 2.4 Modificar `ContentController` para aceptar filtro de resolución
    - En método `index()`, detectar query params `width` y `height`
    - Si ambos presentes, filtrar `Content::where('width', $width)->where('height', $height)`
    - Excluir contenido con dimensiones NULL de resultados filtrados
    - Sin filtros, retornar todo (comportamiento actual)
    - _Requirements: 12.1, 12.2, 12.4_

  - [x] 2.5 Write property tests for ResolutionController (Properties 9, 11)
    - **Property 9: Correctitud de agrupación por resolución**
    - Generar targets con pantallas de resoluciones variadas
    - Verificar: suma de screen_count === total pantallas, cada pantalla en exactamente un grupo, pantallas del mismo grupo tienen misma resolución, orden descendente por screen_count
    - **Property 11: Filtrado de contenido por resolución**
    - Generar registros de contenido con dimensiones variadas y un filtro (W, H)
    - Verificar: solo registros con width===W AND height===H aparecen, contenido con NULL excluido
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 12.1, 12.4**

- [x] 3. Backend — Servicios refactorizados
  - [x] 3.1 Refactorizar `ManifestGenerator` para resolver creativos por pantalla
    - Implementar `resolveTargetIdsForScreen(Screen $screen): array` que busca targets por screen_id directo o via screen_group_id
    - En `buildOrderLineItems()`, cargar creativos filtrados por `order_line_target_id IN $screenTargetIds` y `active_dates` contiene fecha de hoy
    - Agrupar creativos por order_line_id (derivado del target)
    - Si una línea no tiene creativos para esta pantalla → omitir (no asignar spots vacíos)
    - Incluir campo `target_id` en cada item del manifiesto
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 14.1, 14.4_

  - [x] 3.2 Refactorizar `CreativeSelector` para operar sobre pool de Collection
    - Cambiar interfaz: `select(Collection $pool, array $recentHistory): Creative`
    - Implementar selección por peso con anti-repetición dentro del pool dado
    - _Requirements: 10.2_

  - [x] 3.3 Implementar comando artisan `content:extract-dimensions`
    - Buscar registros con `width IS NULL`
    - Para imágenes (JPEG, PNG, WebP): extraer dimensiones con GD/Intervention Image
    - Para videos (MP4, WebM): extraer dimensiones con FFProbe
    - Si falla la extracción: registrar warning, no bloquear
    - Reportar progreso: procesados/fallidos/total
    - _Requirements: 15.2, 15.3, 15.4, 15.5, 15.6_

  - [x] 3.4 Modificar upload de contenido para extraer dimensiones automáticamente
    - En `POST /api/admin/content`, tras almacenar el archivo, extraer width/height
    - Almacenar en campos `width` y `height` de la tabla `content`
    - Si la extracción falla, guardar null y registrar warning (no bloquear upload)
    - _Requirements: 15.1, 15.4_

  - [x] 3.5 Write property tests for ManifestGenerator y CreativeSelector (Properties 10, 3)
    - **Property 10: Aislamiento de creativos en manifiesto por pantalla**
    - Generar pantallas con targets y creativos asignados a distintos targets
    - Verificar: el manifiesto solo contiene creativos cuyos target_id pertenecen a la pantalla
    - **Property 3: Aislamiento de creativos por target**
    - Generar creativos distribuidos entre targets, consultar por target_id
    - Verificar: respuesta contiene exactamente los creativos del target consultado
    - **Validates: Requirements 10.1, 10.5, 14.1, 4.1, 1.6**

- [x] 4. Backend — Registro de rutas
  - [x] 4.1 Registrar nuevas rutas en `routes/api.php`
    - `GET /admin/order-line-targets/{targetId}/creatives` → CreativeController@index
    - `POST /admin/order-line-targets/{targetId}/creatives` → CreativeController@store
    - `PUT /admin/creatives/{id}` → CreativeController@update
    - `DELETE /admin/creatives/{id}` → CreativeController@destroy
    - `GET /admin/order-lines/{orderLineId}/resolutions` → ResolutionController@index
    - `POST /admin/order-lines/{orderLineId}/creatives/bulk-by-resolution` → BulkCreativeController@bulkByResolution
    - Todas dentro del middleware `role:super_admin,tenant_admin`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 6.1_

  - [x] 4.2 Actualizar modelo `Creative` con relaciones y fillable actualizados
    - Agregar `order_line_target_id` a `$fillable`
    - Agregar relación `orderLineTarget()` → belongsTo(OrderLineTarget)
    - Agregar relación derivada `orderLine()` via hasOneThrough
    - Mantener cast `active_dates` → array
    - _Requirements: 1.1, 1.3_

  - [x] 4.3 Actualizar modelo `OrderLineTarget` con relación `creatives()`
    - Agregar `hasMany(Creative::class)` al modelo OrderLineTarget
    - _Requirements: 1.4_

- [x] 5. Checkpoint — Validación Backend
  - Ensure all tests pass, ask the user if questions arise.
  - Verificar: migraciones ejecutan sin error, endpoints responden correctamente, ManifestGenerator genera manifiesto aislado por pantalla.

- [x] 6. Frontend — Tipos, API y hooks
  - [x] 6.1 Agregar interfaces TypeScript nuevas en `features/orders/types.ts`
    - `ResolutionGroup`: resolution_width, resolution_height, screen_count, screens, has_creative, coverage
    - `ResolutionScreen`: id, name, target_id
    - `BulkCreativeInput`: content_id, resolution_width, resolution_height, weight, active_dates
    - `BulkCreativeResponse`: creatives_created, affected_screens
    - Actualizar interfaz `Creative`: agregar `order_line_target_id`, deprecar `order_line_id` (opcional)
    - _Requirements: 7.7, 5.2_

  - [x] 6.2 Implementar API layer refactorizado en `features/orders/api.ts`
    - `creativesApi.listByTarget(targetId)`: GET /admin/order-line-targets/{targetId}/creatives
    - `creativesApi.createForTarget(targetId, data)`: POST /admin/order-line-targets/{targetId}/creatives
    - `creativesApi.update(id, data)`: PUT /admin/creatives/{id}
    - `creativesApi.delete(id)`: DELETE /admin/creatives/{id}
    - `resolutionsApi.list(orderLineId)`: GET /admin/order-lines/{orderLineId}/resolutions
    - `bulkCreativesApi.createByResolution(orderLineId, data)`: POST bulk-by-resolution
    - `contentApi.list(filters?: { width, height })`: GET /admin/content con query params opcionales
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 6.1, 8.5, 12.1_

  - [x] 6.3 Implementar hooks TanStack Query en `features/orders/hooks.ts`
    - `useResolutions(orderLineId)`: query con key ['order-lines', id, 'resolutions']
    - `useTargetCreatives(targetId)`: query con key ['targets', targetId, 'creatives']
    - `useBulkCreateByResolution(orderLineId)`: mutation con invalidation de resolutions
    - `useCreateCreativeForTarget(targetId)`: mutation con invalidation de target creatives
    - `useContentByResolution(width, height)`: query con key ['content', {width, height}]
    - _Requirements: 7.7, 8.1, 8.2_

  - [x] 6.4 Implementar schemas de validación Zod
    - `creativeForTargetSchema`: content_id required, weight int ≥ 1, active_dates array min 1
    - `bulkByResolutionSchema`: content_id, resolution_width, resolution_height, weight ≥ 1, active_dates array min 1
    - _Requirements: 4.6, 4.7, 5.4_

  - [x] 6.5 Write property tests for frontend validation schemas (Properties 5, 6)
    - **Property 5: Validación de weight como entero positivo**
    - Generar valores numéricos arbitrarios (int, float, neg, zero, string)
    - Verificar: solo enteros ≥ 1 pasan validación
    - **Property 6: Contención de active_dates en rango de OrderLine**
    - Generar conjuntos de fechas arbitrarios y rangos de OrderLine
    - Verificar: solo conjuntos donde TODAS las fechas caen dentro del rango son aceptados
    - **Validates: Requirements 4.6, 4.7, 13.5**

- [x] 7. Frontend — Página OrderLineDetailPage rediseñada
  - [x] 7.1 Crear componente `ResolutionDashboard`
    - Barra de progreso global: "Cobertura total: X/Y pantallas con creativo (Z%)"
    - Gráfico de distribución (barras horizontales o donut) por resolución con colores diferenciados
    - Click en segmento/tarjeta → scroll suave a la sección de esa resolución
    - Calcular porcentaje: (pantallas de resolución / total pantallas) × 100, redondeado a 1 decimal
    - _Requirements: 16.1, 16.2, 16.5, 16.6, 16.7_

  - [x] 7.2 Crear componente `CoverageIndicator`
    - Si todas las pantallas del grupo tienen creativo → ícono check verde "Completo"
    - Si alguna pantalla no tiene creativo → ícono warning amarillo "N de M pantallas con creativo"
    - _Requirements: 16.3, 16.4_

  - [x] 7.3 Crear componente `ResolutionGroupCard`
    - Header: "{W}×{H} — {N} pantallas" con CoverageIndicator
    - Thumbnails de creativos existentes (max 4, "+N más" si hay más)
    - Botón "Agregar creativo" que abre diálogo con tabs: Biblioteca / Subir nuevo
    - Botón "Ver pantallas" que expande sección ScreenCreativeList
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 7.4 Crear componente `LibrarySelector` con filtrado por resolución
    - Llama a `useContentByResolution(width, height)`
    - Grid de thumbnails filtrados con selección
    - Badge visible mostrando filtro activo: "Filtro: {W}×{H}"
    - Estado vacío: "No hay archivos con resolución {W}×{H}" con acciones "Subir nuevo" e "Ir a Biblioteca"
    - Al seleccionar, emitir content_id al componente padre
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 7.5 Crear componente `DirectUploadDialog`
    - Aceptar archivos: JPEG, PNG, WebP, MP4, WebM
    - Flujo de 2 fases con indicadores: "Subiendo archivo..." → "Asignando a N pantallas..."
    - Si targetId (individual): POST content → POST creative individual
    - Si sin targetId (bulk): POST content → POST bulk-by-resolution
    - Si resolución no coincide tras upload: mostrar error, archivo queda en Biblioteca
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_

  - [x] 7.6 Crear componente `ScreenCreativeList`
    - Lista expandible de pantallas individuales dentro de un grupo de resolución
    - Cada fila: nombre pantalla, creativos asignados (thumbnails), botón "Agregar a esta pantalla"
    - Diferenciar visualmente creativos asignados por resolución vs individualmente
    - Permitir eliminar creativo individual (con confirmación)
    - Permitir editar weight y active_dates de creativo individual sin afectar otros
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 7.7 Crear componente `ActiveDatesPicker` (calendario) si no existe
    - Calendario con selección de rangos, multi-rangos y días individuales
    - Deshabilitar fechas fuera del rango de la Línea de pedido
    - Mostrar visualmente los límites del rango permitido
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 7.8 Rediseñar `OrderLineDetailPage` integrando todos los componentes
    - Header con info de la línea (nombre, fechas, status)
    - ResolutionDashboard en la parte superior
    - Lista de ResolutionGroupCards debajo, una por cada grupo de resolución
    - Flujo visual izquierda-a-derecha: pantallas → creativos → acciones
    - Integrar hooks: useResolutions, useTargetCreatives, useBulkCreateByResolution
    - _Requirements: 7.1, 7.6, 7.7, 16.1_

- [x] 8. Checkpoint — Compilación Frontend
  - Ensure all tests pass, ask the user if questions arise.
  - Verificar: TypeScript compila sin errores, componentes renderizan con datos mock, hooks conectan correctamente con API.

- [x] 9. Frontend — Navegación y renaming
  - [x] 9.1 Renombrar "Contenido" a "Biblioteca" en la interfaz
    - Cambiar label en menú de navegación: "Contenido" → "Biblioteca"
    - Cambiar ruta: `/content` → `/biblioteca`
    - Cambiar título de la sección de archivos multimedia
    - En selector de contenido (desde creativos): título "Seleccionar de Biblioteca"
    - Mantener endpoints API, hooks y variables internas sin cambios (solo UI visible)
    - _Requirements: 18.1, 18.2, 18.3, 18.4_

- [x] 10. Player — Cambios en consumo de manifiesto
  - [x] 10.1 Verificar compatibilidad del Player con nuevo formato de manifiesto
    - El Player recibe items con campo adicional `target_id` — verificar que no rompe parsing
    - El Player no necesita validación de resolución local (ocurre en backend)
    - Si no hay items `order_line_creative`, reproducir `playlist_item` y `prodooh_ssp_call`
    - Verificar que el Player maneja gracefully la ausencia de `order_line_creative` items
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

- [x] 11. Checkpoint — Integración completa
  - Ensure all tests pass, ask the user if questions arise.
  - Verificar: flujo end-to-end (crear target → asignar creativo → generar manifiesto → player consume), migración de datos correcta, UI funcional.

- [x] 12. Property-Based Tests — Correctness Properties
  - [x] 12.1 Write property test: Resolución exacta (Property 1)
    - **Property 1: Validación de resolución exacta (Content vs Screen)**
    - Generar dimensiones arbitrarias para contenido y pantalla
    - Verificar: asignación aceptada sii w1===w2 AND h1===h2, rechazada con 422 si no coinciden
    - **Validates: Requirements 2.1, 2.2, 2.3, 3.4, 5.4**

  - [x] 12.2 Write property test: Bulk count correctness (Property 2)
    - **Property 2: Bulk por resolución crea creativos solo para targets coincidentes**
    - Generar línea con N targets de resoluciones mixtas, solicitar bulk con resolución (W, H)
    - Verificar: creatives_created === K (targets con esa resolución), affected_screens contiene exactamente K screen IDs
    - **Validates: Requirements 3.1, 3.2, 5.1**

  - [x] 12.3 Write property test: Cross-tenant rejection (Property 4)
    - **Property 4: Rechazo de referencias cross-tenant**
    - Generar contenido de tenant A e intentar asignar en contexto de tenant B
    - Verificar: rechazado con error de validación cuando A ≠ B
    - **Validates: Requirements 4.5**

  - [x] 12.4 Write property test: Weight validation (Property 5)
    - **Property 5: Validación de weight como entero positivo**
    - Generar valores arbitrarios: 0, negativos, decimales, strings, enteros ≥ 1
    - Verificar: solo enteros ≥ 1 aceptados, resto rechazado con 422
    - **Validates: Requirements 4.6**

  - [x] 12.5 Write property test: Date containment (Property 6)
    - **Property 6: Contención de active_dates en rango de OrderLine**
    - Generar conjuntos de fechas y rangos [starts_at, ends_at]
    - Verificar: aceptado sii TODAS las fechas caen dentro del rango
    - **Validates: Requirements 4.7, 13.5**

  - [x] 12.6 Write property test: Cascade delete (Property 7)
    - **Property 7: Eliminación en cascada — Target → Creativos**
    - Generar targets con N creativos, eliminar target
    - Verificar: creativos disminuyen en exactamente N, ningún creativo con ese target_id existe
    - **Validates: Requirements 1.4**

  - [x] 12.7 Write property test: Atomicidad transaccional (Property 8)
    - **Property 8: Atomicidad transaccional del bulk**
    - Generar operación bulk donde al menos una validación falla
    - Verificar: total creativos creados === 0, ningún registro parcial persiste
    - **Validates: Requirements 5.6**

  - [x] 12.8 Write property test: Correctitud de agrupación (Property 9)
    - **Property 9: Correctitud de agrupación por resolución**
    - Generar targets con pantallas de resoluciones variadas
    - Verificar: suma screen_count === total, cada pantalla en exactamente un grupo, mismo grupo misma resolución, orden descendente
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

  - [x] 12.9 Write property test: Manifest isolation (Property 10)
    - **Property 10: Aislamiento de creativos en manifiesto por pantalla**
    - Generar pantallas con targets y creativos distribuidos
    - Verificar: manifiesto contiene solo creativos de targets de esa pantalla
    - **Validates: Requirements 10.1, 10.5, 14.1**

  - [x] 12.10 Write property test: Content filter (Property 11)
    - **Property 11: Filtrado de contenido por resolución**
    - Generar registros de contenido con dimensiones variadas, aplicar filtro (W, H)
    - Verificar: solo registros con width===W AND height===H retornados, NULL excluidos
    - **Validates: Requirements 12.1, 12.4**

  - [x] 12.11 Write property test: Target isolation (Property 3)
    - **Property 3: Aislamiento de creativos por target**
    - Generar creativos distribuidos entre múltiples targets
    - Verificar: consulta por target_id retorna exactamente sus creativos, ninguno de otros
    - **Validates: Requirements 4.1, 1.6**

- [x] 13. Checkpoint final — Todos los tests pasan
  - Ensure all tests pass, ask the user if questions arise.
  - Verificar: property tests (11 propiedades), unit tests backend, unit tests frontend, integración completa.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- El backend usa PHP/Laravel 11, el frontend usa TypeScript/React 19 con TanStack Query
- La librería de PBT es `fast-check` v4.8.0 con Vitest
- El orden de dependencias es estricto: migraciones → controladores → servicios → rutas → frontend → player

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3"] },
    { "id": 1, "tasks": ["1.2", "4.2", "4.3"] },
    { "id": 2, "tasks": ["2.1", "2.3", "2.4", "3.3", "3.4"] },
    { "id": 3, "tasks": ["2.2", "3.1", "3.2", "4.1"] },
    { "id": 4, "tasks": ["2.5", "3.5"] },
    { "id": 5, "tasks": ["6.1"] },
    { "id": 6, "tasks": ["6.2", "6.4"] },
    { "id": 7, "tasks": ["6.3", "6.5"] },
    { "id": 8, "tasks": ["7.1", "7.2", "7.4", "7.5", "7.7"] },
    { "id": 9, "tasks": ["7.3", "7.6"] },
    { "id": 10, "tasks": ["7.8"] },
    { "id": 11, "tasks": ["9.1", "10.1"] },
    { "id": 12, "tasks": ["12.1", "12.2", "12.3", "12.4", "12.5", "12.6", "12.7", "12.8", "12.9", "12.10", "12.11"] }
  ]
}
```
