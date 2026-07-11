# Implementation Plan: Motor de Prioridad y Manifiesto

## Overview

Reingeniería completa del motor de reproducción: reemplazar el sistema de Loop de slots fijos por un motor de prioridad centralizado en el backend (waterfall + Bresenham) que genera un manifiesto pre-resuelto, y adaptar el player para consumir esa secuencia concreta. Incluye nuevos endpoints de dispositivo, reporte de impresiones, y eliminación del código obsoleto.

## Tasks

- [x] 1. Migraciones de base de datos
  - [x] 1.1 Crear migración para tabla `screen_manifests`
    - Crear tabla con columnas: `id` (UUID PK), `screen_id` (FK → screens, unique), `version` (VARCHAR 64), `generated_at` (TIMESTAMP), `items` (JSONB), `total_spots` (INT), `remaining_spots` (INT), `created_at` (TIMESTAMP)
    - Crear índices: `idx_screen_manifests_screen_id`, `idx_screen_manifests_version`
    - _Requirements: 6.5, 7.1_

  - [x] 1.2 Crear migración para simplificar enum `source` en `impressions`
    - Cambiar columna `source` a VARCHAR(20) con CHECK constraint limitado a `'order_line'`
    - Eliminar constraint enum antigua si existe
    - _Requirements: 14.1_

  - [x] 1.3 Crear migración para renombrar `playlist_version` → `manifest_version` en `screens`
    - `ALTER TABLE screens RENAME COLUMN playlist_version TO manifest_version`
    - _Requirements: 8.2_

- [x] 2. Modelo Eloquent `ScreenManifest`
  - [x] 2.1 Crear modelo `backend/app/Models/ScreenManifest.php`
    - Usar trait `HasUuids`
    - Definir `$fillable`: screen_id, version, generated_at, items, total_spots, remaining_spots
    - Definir casts: items → array, generated_at → datetime
    - Definir relación `belongsTo(Screen::class)`
    - Actualizar modelo `Screen` para agregar relación `hasOne(ScreenManifest::class)` y renombrar referencia de `playlist_version` a `manifest_version`
    - _Requirements: 6.5, 7.1_

- [x] 3. Servicios del motor de prioridad (Backend)
  - [x] 3.1 Implementar `PriorityEngine` — cálculo de capacidad y presupuesto diario
    - Crear `backend/app/Services/PriorityEngine.php` con interfaz `PriorityEngineInterface`
    - Implementar `calculateTotalDailySpots(Screen)`: jerarquía duración (group > tenant > 10s default), jerarquía schedule (screen > group > tenant > 24/7), fórmula `floor(window_seconds / duration_seconds)`
    - Implementar `calculateDailyBudget(OrderLine)`: uniform → `ceil((target - delivered) / remaining_days)`, asap → `target - delivered`, null target → null
    - Implementar `filterActiveLines(Screen)`: filtro por status, fechas, target no agotado, creativos activos hoy, targeting directo o por grupo
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 3.4, 3.5_

  - [x] 3.2 Property tests para PriorityEngine — capacidad y presupuesto
    - **Property 1: Capacity calculation** — Para cualquier ventana operativa y duración efectiva, `total_daily_spots = floor(window / duration)`
    - **Property 2: Duration and schedule hierarchy resolution** — Primer no-null en jerarquía
    - **Property 3: Schedule day-of-week calculation** — Suma de rangos activos del día
    - **Property 4: Daily budget formula** — uniform: ceil, asap: todo el remanente
    - **Property 5: Target exhaustion exclusion** — delivered >= target → excluida
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.4**

  - [x] 3.3 Implementar `PriorityEngine` — waterfall de asignación
    - Implementar `runWaterfall(lines, capacity)`: procesar patrocinio → estándar → red_interna en orden estricto
    - Implementar `allocateLevel(lines, remainingCapacity)`: si demanda ≤ capacidad → exact budget; si demanda > capacidad → proporcional por `share_weight`
    - Implementar `allocateRemainder(remainingAfterRedInterna)`: 50/50 entre SSP y playlist (floor/ceil para impares)
    - Caso sin líneas activas → 100% playlist
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 3.7_

  - [x] 3.4 Property tests para PriorityEngine — waterfall
    - **Property 6: Waterfall priority guarantee** — patrocinio se sirve antes que estándar, estándar antes que red_interna
    - **Property 7: Under-capacity exact allocation** — cada línea recibe su daily_budget exacto
    - **Property 8: Over-capacity proportional allocation** — reparto por share_weight
    - **Property 9: Active line filter correctness** — criterios de inclusión/exclusión
    - **Property 10: Red interna remainder 50/50 split** — SSP y playlist a partes iguales
    - **Property 14: Intra-day recalculation uses remaining capacity** — usa total - entregadas_hoy
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 6.2, 6.3**

  - [x] 3.5 Implementar `BresenhamInterleaver`
    - Crear `backend/app/Services/BresenhamInterleaver.php` con interfaz `BresenhamInterleaverInterface`
    - Implementar `interleave(entries, totalSlots)`: para cada línea i, calcular `paso_i = T / count_i`, posicionar turnos en `round(k × paso_i)`, resolver colisiones con siguiente posición libre
    - Retornar array de `{position, order_line_id}` cubriendo exactamente T posiciones
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 3.6 Property tests para BresenhamInterleaver
    - **Property 11: Bresenham even distribution** — gap máximo entre apariciones de línea i ≤ `ceil(T / count_i) + 1`
    - **Property 12: Interleaver output completeness** — salida tiene exactamente T items, posiciones 0..T-1, count_i apariciones por línea
    - **Validates: Requirements 4.1, 4.2, 4.3**

  - [x] 3.7 Implementar `CreativeSelector`
    - Crear `backend/app/Services/CreativeSelector.php` con interfaz `CreativeSelectorInterface`
    - Implementar `select(OrderLine, recentHistory)`: selección aleatoria ponderada por `weight`
    - Implementar regla anti-repetición: no repetir consecutivamente; si pool > 5, ventana de `min(pool_size - 1, 5)` turnos
    - Caso pool de 1 creativo: sin restricción anti-repetición
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 3.8 Property tests para CreativeSelector
    - **Property 13: Creative selection anti-repetition** — nunca mismo creativo consecutivo; ventana de `min(N-1, 5)` cuando N > 5
    - **Validates: Requirements 5.2, 5.3**

  - [x] 3.9 Implementar `ManifestGenerator`
    - Crear `backend/app/Services/ManifestGenerator.php` con interfaz `ManifestGeneratorInterface`
    - Implementar `generate(Screen, sequence, sspSlots, playlistSlots)`: resolver creativos usando CreativeSelector, insertar slots SSP y playlist en posiciones asignadas
    - Implementar `computeVersion(items)`: SHA-256 hash del contenido serializado
    - Construir ítems con campos correctos según tipo (order_line_creative, prodooh_ssp_call, playlist_item)
    - Persistir en `screen_manifests` (upsert por screen_id)
    - _Requirements: 6.5, 7.3, 7.4, 7.5, 7.6_

  - [x] 3.10 Property tests para ManifestGenerator
    - **Property 15: Manifest version determinism** — misma secuencia → mismo hash; distinta → distinto hash
    - **Property 16: Manifest item type field validation** — campos correctos según tipo
    - **Validates: Requirements 6.5, 7.3, 7.4, 7.5, 7.6**

- [x] 4. Checkpoint — Verificar servicios del motor
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Job y Command de recálculo (Backend)
  - [x] 5.1 Implementar `RecalculateManifestJob`
    - Crear `backend/app/Jobs/RecalculateManifestJob.php`
    - Recibir `screen_id` y `isIntraDay` como parámetros
    - Invocar `PriorityEngine::recalculate(screenId, isIntraDay)`
    - Configurar deduplicación por `screen_id` (evitar jobs concurrentes para misma pantalla)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 5.2 Implementar `MidnightRolloverCommand`
    - Crear `backend/app/Console/Commands/MidnightRolloverCommand.php`
    - Registrar en el Kernel schedule para ejecutar diariamente a medianoche
    - Despachar `RecalculateManifestJob` para cada pantalla activa con `isIntraDay = false`
    - _Requirements: 6.1_

  - [x] 5.3 Implementar event listeners para recálculo intra-día
    - Crear observers o listeners en model events de `OrderLine` y `Order` (created, updated, deleted)
    - Detectar cambios relevantes: status, fechas, target_spots, screen targeting
    - Despachar `RecalculateManifestJob` con `isIntraDay = true` para pantallas afectadas
    - _Requirements: 6.2, 6.4_

- [x] 6. Controllers y rutas del dispositivo (Backend)
  - [x] 6.1 Implementar `ManifestController`
    - Crear `backend/app/Http/Controllers/Device/ManifestController.php`
    - `show()`: servir manifiesto desde `screen_manifests`, soportar ETag con `If-None-Match` → 304, responder 200 con JSON completo si versión distinta
    - `confirm()`: recibir `{ "version": "..." }`, actualizar `screens.manifest_version`
    - _Requirements: 7.1, 7.2, 7.3, 8.1, 8.2_

  - [x] 6.2 Implementar `ImpressionsController`
    - Crear `backend/app/Http/Controllers/Device/ImpressionsController.php`
    - `store()`: recibir batch de impresiones, validar campos (order_line_id existe, etc.), persistir con `source = 'order_line'`, vincular `screen_id` del dispositivo autenticado
    - Responder 201 Created o 422 si datos inválidos
    - Aceptar impresiones con cualquier antigüedad (no rechazar por timestamp viejo)
    - _Requirements: 9.1, 9.2, 9.4, 9.5_

  - [x] 6.3 Registrar rutas nuevas y stubs 410 Gone
    - Registrar en rutas de dispositivo: `GET /api/device/manifest`, `POST /api/device/manifest/confirm`, `POST /api/device/impressions`
    - Crear rutas stub que retornan 410 Gone: `GET /api/device/playlist`, `POST /api/device/playlist/confirm`, `GET /api/device/config`, `PUT /screens/{id}/loop`, `PUT /screens/{id}/sources`
    - _Requirements: 7.7, 13.1, 13.3_

  - [x] 6.4 Tests de feature para endpoints del dispositivo
    - Test GET /manifest: responde 200 con estructura válida, responde 304 con ETag coincidente
    - Test POST /manifest/confirm: actualiza manifest_version en screen
    - Test POST /impressions: persiste impresiones con source='order_line', rechaza 422 con datos inválidos
    - Test endpoints obsoletos: retornan 410 Gone
    - _Requirements: 7.1, 7.2, 8.1, 8.2, 9.1, 9.2, 13.1, 13.3_

- [x] 7. Checkpoint — Verificar backend completo
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Player — `JwtRenewer` (interceptor de autenticación)
  - [x] 8.1 Implementar `JwtRenewer`
    - Crear `player/src/api/JwtRenewer.ts`
    - Implementar `withAutoRenewal<T>(request)`: detectar 401, ejecutar `POST /api/device/auth`, reintentar request original con token nuevo
    - Implementar backoff exponencial si la renovación falla
    - No detener reproducción durante intentos de renovación
    - _Requirements: 12.1, 12.2, 12.3_

  - [x] 8.2 Unit tests para JwtRenewer
    - Test: detecta 401 y renueva automáticamente
    - Test: reintenta request original con token nuevo
    - Test: backoff exponencial en fallo de renovación
    - _Requirements: 12.1, 12.2, 12.3_

- [x] 9. Player — `ImpressionReporter` (cola + flush)
  - [x] 9.1 Implementar `ImpressionReporter`
    - Crear `player/src/sync/ImpressionReporter.ts`
    - Implementar `enqueue(impression)`: almacenar en SQLite local
    - Implementar `flush()`: enviar batch a `POST /api/device/impressions`, usar `JwtRenewer` para auth
    - Implementar `startPeriodicFlush(intervalMs)` / `stopPeriodicFlush()`
    - Backoff exponencial en caso de fallo de red
    - Solo encolar impresiones de tipo `order_line_creative` (no playlist ni SSP)
    - _Requirements: 9.1, 9.3, 9.6_

  - [x] 9.2 Unit tests para ImpressionReporter
    - Test: encola impresiones offline y las envía al recuperar conexión
    - Test: solo reporta order_line_creative, ignora playlist y SSP
    - Test: backoff exponencial en fallos
    - _Requirements: 9.3, 9.6_

- [x] 10. Player — `ManifestSyncManager` (reemplazo de PlaylistSyncManager)
  - [x] 10.1 Implementar `ManifestSyncManager`
    - Crear `player/src/sync/ManifestSyncManager.ts`
    - Implementar `sync()`: GET /api/device/manifest con header `If-None-Match`, manejar 304 (sin cambios) y 200 (nuevo manifiesto)
    - Implementar descarga de assets nuevos, validación de checksums SHA-256
    - Implementar confirmación: POST /api/device/manifest/confirm (sin rollback en fallo de confirm)
    - Implementar polling periódico con `startPeriodicSync(intervalMs)` / `stopPeriodicSync()`
    - Usar `JwtRenewer` para auto-renovación de token
    - _Requirements: 7.1, 7.2, 8.1, 8.3, 10.6_

  - [x] 10.2 Unit tests para ManifestSyncManager
    - Test: 304 no dispara descarga
    - Test: 200 dispara descarga + validación checksums + confirm
    - Test: mantiene manifiesto nuevo si confirm falla
    - _Requirements: 7.2, 8.1, 8.3_

- [x] 11. Player — `SspPrefetcher` (prefetch con margen extendido)
  - [x] 11.1 Implementar `SspPrefetcher`
    - Crear `player/src/engine/SspPrefetcher.ts`
    - Implementar `prefetch(durationSeconds)`: llamada al SSP (`POST /public/v1/ad`) al entrar al ítem anterior
    - Implementar `expire(printId)`: llamar expiration si manifiesto cambia antes de reproducir
    - Implementar `cleanup()`: borrar archivo local inmediatamente post-reproducción/expiración (no participa de LRU)
    - Implementar `isReady()` / `getContent()`: verificar si el contenido SSP está disponible
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 11.2 Unit tests para SspPrefetcher
    - Test: dispara prefetch al entrar ítem anterior al SSP
    - Test: expira print_id si manifiesto cambia
    - Test: cleanup borra archivo local
    - Test: isReady retorna false si no hay contenido listo
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [x] 12. Player — `ManifestEngine` (reemplazo del LoopEngine)
  - [x] 12.1 Implementar `ManifestEngine`
    - Crear `player/src/engine/ManifestEngine.ts`
    - Implementar `run()`: loop continuo position 0..N-1, wrap a 0 al terminar
    - Para `order_line_creative`: reproducir asset por duration_seconds, emitir evento de impresión al completar
    - Para `playlist_item`: reproducir asset por duration_seconds, sin emitir impresión
    - Para `prodooh_ssp_call`: usar SspPrefetcher, si no listo → fallback a playlist item disponible
    - Implementar `updateManifest(newManifest)`: swap atómico de secuencia activa
    - Implementar prefetch del siguiente ítem durante reproducción del actual
    - Seguir reproduciendo último manifiesto válido si pierde conectividad
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [x] 12.2 Property test para ManifestEngine (fast-check)
    - **Property 17: Sequential loop playback** — Para cualquier manifiesto de N ítems, reproduce en orden estricto 0..N-1 y wraps a 0
    - **Validates: Requirements 10.1**

  - [x] 12.3 Unit tests para ManifestEngine
    - Test: order_line_creative emite impresión al completar
    - Test: playlist_item no emite impresión
    - Test: prodooh_ssp_call con fallback a playlist si SSP no está listo
    - Test: prefetch del siguiente ítem
    - Test: swap atómico al recibir manifiesto nuevo
    - Test: reproduce indefinidamente offline
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

- [x] 13. Checkpoint — Verificar player completo
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Integración y wiring
  - [x] 14.1 Integrar ManifestEngine en boot/main del player
    - Modificar `player/src/boot.ts` y `player/src/main.ts`
    - Instanciar ManifestSyncManager, ImpressionReporter, SspPrefetcher, JwtRenewer, ManifestEngine
    - Conectar eventos: ManifestEngine.onItemComplete → ImpressionReporter.enqueue
    - Conectar ManifestSyncManager → ManifestEngine.updateManifest
    - Iniciar polling periódico y flush periódico
    - _Requirements: 10.1, 10.2, 9.3_

  - [x] 14.2 Registrar ServiceProvider para servicios backend
    - Crear o actualizar ServiceProvider para binding de interfaces: PriorityEngineInterface, BresenhamInterleaverInterface, ManifestGeneratorInterface, CreativeSelectorInterface
    - _Requirements: 3.1, 4.1, 5.1_

  - [x] 14.3 Tests de integración end-to-end
    - Test: crear orders/lines/creatives → ejecutar PriorityEngine → verificar manifiesto generado correcto
    - Test: simular polling del player → descarga manifiesto → confirm → verificar version en DB
    - Test: reportar impresiones → backend persiste → afecta daily_budget del siguiente recálculo
    - Test: midnight rollover → recálculo usa total_daily_spots completo
    - _Requirements: 3.1, 6.1, 7.1, 8.2, 9.5_

- [x] 15. Eliminación de código obsoleto
  - [x] 15.1 Eliminar controllers y services obsoletos del backend
    - Eliminar `backend/app/Http/Controllers/Device/ConfigSyncController.php`
    - Eliminar `backend/app/Services/SourceToggleService.php`
    - Eliminar `backend/app/Services/LoopConfigService.php`
    - Eliminar referencias a `loop_config` / `sources_config` en el código
    - Eliminar controller `SourceToggleController` si existe (puede estar en Admin)
    - Eliminar controller `LoopConfigController` si existe (puede estar en Admin)
    - Limpiar rutas asociadas a endpoints eliminados
    - _Requirements: 13.2_

  - [x] 15.2 Eliminar LoopEngine y código de sync antiguo del player
    - Eliminar `player/src/engine/LoopEngine.ts`
    - Eliminar `player/src/sync/PlaylistSyncManager.ts`
    - Eliminar `player/src/engine/SlotConfigManager.ts`
    - Actualizar imports en `player/src/sync/index.ts` y otros archivos que referencien los módulos eliminados
    - Verificar que no queden imports rotos
    - _Requirements: 13.4_

  - [x] 15.3 Smoke tests de eliminación
    - Verificar que migración de `source` enum ejecuta sin errores
    - Verificar que endpoints obsoletos retornan 410 Gone
    - Verificar que `LoopEngine` ya no existe en imports del player
    - Verificar que `ConfigSyncController` y `SourceToggleService` están eliminados
    - _Requirements: 13.1, 13.2, 13.4_

- [x] 16. Checkpoint final — Verificar sistema completo
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (Properties 1-17 from design)
- Backend uses PHP (Laravel/Pest), Player uses TypeScript (Vitest + fast-check)
- The waterfall algorithm guarantees priority through allocation counts, not playback order — Bresenham distributes all lines evenly across the day
- `time_window` is explicitly out of scope (stub, not implemented)
- No retroactive impression reconciliation in this phase

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "8.1"] },
    { "id": 2, "tasks": ["3.1", "3.5", "3.7", "8.2", "9.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.6", "3.8", "3.9", "9.2", "10.1", "11.1"] },
    { "id": 4, "tasks": ["3.4", "3.10", "5.1", "5.2", "5.3", "10.2", "11.2"] },
    { "id": 5, "tasks": ["6.1", "6.2", "6.3", "12.1"] },
    { "id": 6, "tasks": ["6.4", "12.2", "12.3", "14.1", "14.2"] },
    { "id": 7, "tasks": ["14.3"] },
    { "id": 8, "tasks": ["15.1", "15.2"] },
    { "id": 9, "tasks": ["15.3"] }
  ]
}
```
