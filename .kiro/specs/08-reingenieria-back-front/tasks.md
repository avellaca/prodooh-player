# Implementation Plan: Reingeniería Back/Front

## Overview

Implementación completa del flujo de pedidos comerciales (Orders), limpieza de código obsoleto, Modo Testigo, previews con lightbox, y renombramientos de interfaz. El backend se implementa primero (controladores, rutas, limpieza) ya que el frontend depende de los endpoints API. Las tareas del frontend se agrupan por feature. Los cambios en el Player se hacen al final pues dependen de los endpoints de comandos.

## Tasks

- [x] 1. Backend — Controladores CRUD y rutas de administración
  - [x] 1.1 Crear OrderController con métodos index, store, show, update, destroy
    - Implementar validaciones: name (required, max:255), advertiser_name (nullable), starts_at/ends_at (date, ends_at after_or_equal starts_at), status (enum)
    - Aplicar TenantScopeMiddleware para filtrado por tenant
    - Manejar tenant_id implícito para tenant_admin y explícito para super_admin
    - Incluir relaciones order_lines_count en show
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [x] 1.2 Crear OrderLineController con métodos index, store, show, update, destroy
    - Implementar validaciones: name, priority_tier (enum), starts_at/ends_at (contenidas en rango del Order padre via DateContainmentValidator), target_spots, delivery_pace (enum), share_weight, status
    - Incluir relaciones creatives_count, targets en show
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 1.3 Crear CreativeController con métodos index, store, update, destroy
    - Implementar validaciones: content_id (exists, mismo tenant), weight (entero ≥ 1), active_dates (array ISO dates, contenidas en rango de OrderLine padre)
    - Incluir relación content en index
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 1.4 Crear OrderLineTargetController con métodos store y destroy
    - Implementar validación XOR: exactamente uno de screen_id o screen_group_id
    - Validar que screen_id/screen_group_id pertenezca al mismo tenant
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 1.5 Crear ScreenCommandController con método store para Modo Testigo
    - Validar type (enum: speed_override, preview_content)
    - Para speed_override: validar factor (1,2,4), expires_at (default 10min)
    - Para preview_content: validar content_id, asset_url, duration_seconds
    - Insertar en tabla device_commands con status pending
    - _Requirements: 20.2, 20.3, 20.6, 21.3_

  - [x] 1.6 Registrar rutas nuevas en routes/api.php dentro del grupo admin autenticado
    - Rutas CRUD para orders, order-lines (nested), creatives (nested), targets (nested)
    - Ruta POST screens/{id}/commands
    - Aplicar middleware role:super_admin,tenant_admin
    - _Requirements: 1.1–1.8, 2.1–2.8, 3.1–3.8, 4.1–4.6, 20.3_

  - [x] 1.7 Implementar dispatch de ManifestRecalculation en los controladores
    - Despachar job al cambiar status de Order (active/paused/finished)
    - Despachar job al crear/actualizar/eliminar OrderLine
    - Despachar job al crear/eliminar OrderLineTarget
    - Despachar job al crear/actualizar/eliminar Creative
    - Dispatch asíncrono (queued) para no bloquear respuesta HTTP
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 2. Backend — Limpieza y protección FK
  - [x] 2.1 Limpiar ScreenController: eliminar validaciones obsoletas de loop_config, sources_config, duration_seconds
    - Actualizar método update para aceptar solo campos vigentes: name, orientation, resolution_width, resolution_height, group_id, schedule, transition_type, transition_duration_ms
    - Eliminar asignación de defaults para loop_config/sources_config en DeviceService al crear pantalla
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 2.2 Implementar error 409 en ContentController al eliminar contenido referenciado
    - Verificar existencia de creativos con content_id antes de intentar DELETE
    - Retornar 409 con mensaje legible en español si hay referencias
    - Proceder con eliminación normal si no hay referencias
    - _Requirements: 13.1, 13.3, 13.4_

- [x] 3. Checkpoint — Validar backend
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Frontend — Feature de Orders (tipos, API, hooks, schemas)
  - [x] 4.1 Crear estructura de carpetas y tipos para features/orders/
    - Crear types.ts con interfaces Order, OrderLine, Creative, OrderLineTarget
    - Crear schemas.ts con Zod schemas: orderSchema, orderLineSchema, creativeSchema
    - Incluir validación refine para ends_at >= starts_at y date containment
    - _Requirements: 7.6, 8.6, 9.6, 9.7_

  - [x] 4.2 Crear capa API en features/orders/api.ts
    - Implementar ordersApi (list, get, create, update, delete)
    - Implementar orderLinesApi (list, get, create, update, delete)
    - Implementar creativesApi (list, create, update, delete)
    - Implementar targetsApi (create, delete)
    - Implementar screenCommandsApi (send)
    - _Requirements: 7.3, 7.5, 8.4, 9.4, 9.5, 10.4, 10.5_

  - [x] 4.3 Crear hooks TanStack Query en features/orders/hooks.ts
    - Implementar useOrders, useOrder, useCreateOrder, useUpdateOrder, useDeleteOrder
    - Implementar useOrderLines, useCreateOrderLine, useUpdateOrderLine, useDeleteOrderLine
    - Implementar useCreatives, useCreateCreative, useUpdateCreative, useDeleteCreative
    - Implementar useTargets, useCreateTarget, useDeleteTarget
    - Invalidar queries apropiadamente en onSuccess de cada mutación
    - Mostrar toast de éxito/error con sonner
    - _Requirements: 7.3, 8.4, 8.7, 9.4, 10.6_

- [x] 5. Frontend — Páginas de Pedidos
  - [x] 5.1 Crear OrdersPage con tabla de pedidos y acciones
    - Tabla con columnas: nombre, anunciante, fechas, estado (badge)
    - Botón "Crear pedido" que abre diálogo con formulario
    - Botón acción rápida pausar/activar por fila (toggle)
    - Navegación a detalle al hacer clic en un pedido
    - Indicador de carga durante mutaciones y toast de confirmación
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 19.1, 19.2, 19.3, 19.6_

  - [x] 5.2 Crear OrderDetailPage con detalle del pedido y lista de líneas
    - Mostrar info del pedido: nombre, anunciante, fechas, estado
    - Botón "Editar pedido" que abre diálogo de edición pre-poblado
    - Lista de Líneas de pedido con acción rápida pausar/activar
    - Botón "Crear línea de pedido" que abre formulario con todos los campos
    - Expandir/navegar a detalle de línea para gestionar creativos y targets
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 19.4, 19.5_

  - [x] 5.3 Crear componentes de formulario: OrderForm, OrderLineForm
    - OrderForm: campos nombre, anunciante, fecha inicio, fecha fin, estado (draft default)
    - OrderLineForm: campos nombre, priority_tier (selector), fechas, target_spots, delivery_pace, share_weight, estado
    - Integrar React Hook Form + Zod para validación inline
    - _Requirements: 7.2, 7.6, 8.3, 8.6_

  - [x] 5.4 Crear componentes de gestión de creativos: CreativeForm, ActiveDatesPicker
    - CreativeForm: selector de contenido (con thumbnails), campo peso, calendario fechas activas
    - ActiveDatesPicker: componente calendario multi-fecha con selección de días individuales y rangos
    - Lista de creativos con thumbnail, peso y fechas
    - Diálogo confirmación para eliminar creativo
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [x] 5.5 Crear componente TargetSelector para asignación de pantallas/grupos
    - Lista de targets asignados (pantallas y grupos)
    - Selector de pantallas disponibles (excluyendo ya asignadas)
    - Selector de grupos disponibles (excluyendo ya asignados)
    - Botón desasignar por target
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 5.6 Crear componente StatusToggle para acción rápida pausar/activar
    - Toggle entre active y paused con un clic
    - Indicador visual de carga (spinner/disabled) durante mutación
    - Toast de confirmación al completar
    - Reutilizable para Orders y OrderLines
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6_

- [x] 6. Frontend — Feature de Screens (nuevas secciones)
  - [x] 6.1 Crear componente ActiveOrderLines para detalle de pantalla
    - Sección "Líneas de pedido activas" con lista de OrderLines asignadas (directa e indirectamente via grupo)
    - Mostrar: nombre línea, nombre pedido padre, badge prioridad (dorado/azul/gris), fechas, estado
    - Mensaje vacío cuando no hay líneas asignadas
    - Link a detalle del pedido al hacer clic
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

  - [x] 6.2 Crear componente ManifestSummary para detalle de pantalla
    - Sección "Manifiesto actual" con: versión, fecha generación, total spots, composición
    - Mensaje indicativo cuando no existe manifiesto generado
    - Diálogo/sección expandida con lista de ítems del manifiesto (posición, tipo badge, duración, nombre)
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

  - [x] 6.3 Crear componente ScheduleEditor para horario operativo de pantalla
    - Sección "Horario operativo" con schedule actual o indicador "Hereda del grupo"
    - Editor con franjas horarias por día de semana (días lun-dom, hora inicio, hora fin)
    - Opción "Restablecer a herencia del grupo" (envía schedule: null)
    - Indicador visual del origen del horario activo
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [x] 6.4 Crear componente ScheduleEditor para grupos con acción "Aplicar a todas"
    - Sección "Horario operativo del grupo" en página de grupo
    - Indicar cuáles pantallas usan schedule del grupo y cuáles tienen override
    - Acción "Aplicar a todas" que envía POST /groups/{id}/apply-schedule
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5_

- [x] 7. Frontend — Modo Testigo
  - [x] 7.1 Crear componente WitnessMode para controles de Modo Testigo en detalle de pantalla
    - Botón "Modo Testigo" en sección de controles
    - Selector de velocidad (x2, x4) al activar
    - Envío POST /screens/{id}/commands con speed_override y expires_at (10 min)
    - Botón "Desactivar" que envía factor: 1
    - Badge visual "Testigo x2/x4" cuando está activo
    - _Requirements: 20.1, 20.2, 20.6, 20.7_

  - [x] 7.2 Crear componente PreviewContent para previsualización directa
    - Botón "Previsualizar contenido" en sección de controles
    - Selector de contenido de la librería con thumbnails
    - Campo duración opcional (default: duración del spot)
    - Envío POST /screens/{id}/commands con preview_content
    - Toast confirmación "Contenido enviado — aparecerá en los próximos 30 segundos"
    - _Requirements: 21.1, 21.2, 21.3, 21.6_

- [x] 8. Frontend — Lightbox y previews visuales
  - [x] 8.1 Crear componente ContentLightbox con carrusel
    - Lightbox modal sobre fondo oscuro semitransparente
    - Botones navegación (flechas izquierda/derecha) para carrusel
    - Cierre con Escape, clic fuera, o botón X
    - Navegación con teclas de flecha del teclado
    - Renderizado condicional: img para imágenes, video con controles para videos
    - _Requirements: 22.2, 22.3, 22.4, 22.5, 22.9_

  - [x] 8.2 Crear componente ContentThumbnail con lazy loading
    - Tarjetas con miniaturas mínimo 120×120px
    - Lazy loading con loading="lazy" + Intersection Observer
    - Clic en miniatura abre lightbox
    - Uso en galería de contenido, selector de creativos, y lista de creativos inline
    - _Requirements: 22.1, 22.6, 22.7, 22.8, 22.10_

- [x] 9. Frontend — Navegación, renombramientos y limpieza
  - [x] 9.1 Renombrar "Tenants" → "Networks" en interfaz y actualizar navegación
    - Cambiar label "Tenants" a "Networks" en menú de navegación
    - Cambiar placeholder selector a "Seleccionar network"
    - Cambiar ruta de /tenants a /networks
    - Renombrar componente TenantsPage a NetworksPage (archivo y export)
    - Mantener variables internas, TenantContext y endpoints API sin cambios
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [x] 9.2 Agregar enlace "Pedidos" al menú principal de navegación
    - Para super_admin: posicionar entre "Networks" y "Pantallas"
    - Para tenant_admin: posicionar como primer elemento
    - Registrar rutas /orders y /orders/:id en el router dentro del layout protegido
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [x] 9.3 Eliminar componentes obsoletos del sistema Loop/Sources
    - Eliminar LoopEditor de features/screens/components/
    - Eliminar SourceToggles de features/screens/components/
    - Eliminar interfaces LoopSlot y SourcesConfig de types/models.ts
    - Eliminar hooks useUpdateLoop y useUpdateSources de features/screens/hooks.ts
    - Eliminar métodos updateLoop, updateSources y transformScreen de features/screens/api.ts
    - Actualizar ScreenDetailPage: eliminar secciones "Configuración de Loop" y "Fuentes activas"
    - Eliminar loop_config, sources_config y duration_seconds de interfaz Screen
    - Eliminar/actualizar property tests obsoletos (preservation-api-contracts, api-contract-mismatches)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

- [x] 10. Frontend — Manejo error 409 en eliminación de contenido
  - [x] 10.1 Actualizar hook de eliminación de contenido para manejar error 409
    - Detectar respuesta 409 en el handler de error de la mutación delete
    - Mostrar mensaje del servidor en toast (no error técnico SQL)
    - Mantener comportamiento normal para otras eliminaciones exitosas
    - _Requirements: 13.2_

- [x] 11. Checkpoint — Validar frontend compila y funciona
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Player — Modo Testigo (speed_override y preview_content)
  - [x] 12.1 Implementar handler de comando speed_override en el Player
    - Al recibir comando via heartbeat: reducir duración de spots dividiéndola por factor
    - Cálculo: Math.ceil(duration_seconds / factor)
    - Restaurar duraciones originales al alcanzar expires_at
    - Ignorar comando si expires_at ya pasó
    - Si factor inválido: usar factor 1 (sin efecto)
    - Registrar impresiones con flag mode: 'witness' (no contar contra target_spots)
    - _Requirements: 20.4, 20.5, 20.8_

  - [x] 12.2 Implementar handler de comando preview_content en el Player
    - Al recibir comando via heartbeat: interrumpir ciclo al finalizar ítem actual
    - Reproducir contenido indicado UNA vez por duración especificada
    - Reanudar manifiesto normal desde donde quedó
    - No registrar la reproducción como impresión
    - Si no puede descargar contenido: ignorar silenciosamente y continuar
    - _Requirements: 21.4, 21.5, 21.7_

- [x] 13. Checkpoint final — Validar integración completa
  - Ensure all tests pass, ask the user if questions arise.

- [x]* 14. Property Tests — Validaciones y lógica de negocio
  - [x]* 14.1 Property test: Tenant Scope Filtering
    - **Property 1: Tenant Scope Filtering**
    - Generar conjuntos de Orders con tenant_ids aleatorios; verificar que el filtrado por tenant retorna solo los del tenant correcto
    - **Validates: Requirements 1.1, 2.1**

  - [x]* 14.2 Property test: Date Ordering Validation
    - **Property 2: Date Ordering Validation**
    - Generar pares de fechas arbitrarios; verificar que Zod schema rechaza ends_at < starts_at y acepta ends_at >= starts_at
    - **Validates: Requirements 1.6, 7.6**

  - [x]* 14.3 Property test: Date Containment (jerarquía padre-hijo)
    - **Property 3: Date Containment**
    - Generar rangos padre/hijo aleatorios; verificar que fechas hijas fuera del rango padre son rechazadas (422)
    - **Validates: Requirements 2.6, 3.5, 8.6, 9.6**

  - [x]* 14.4 Property test: Enum Validation Strictness
    - **Property 4: Enum Validation Strictness**
    - Generar strings arbitrarios; verificar que solo los valores del enum son aceptados para priority_tier y delivery_pace
    - **Validates: Requirements 2.7, 2.8**

  - [x]* 14.5 Property test: Positive Integer Validation (Weight)
    - **Property 5: Positive Integer Validation**
    - Generar números arbitrarios (enteros, decimales, negativos, cero); verificar que solo enteros ≥ 1 son aceptados como weight
    - **Validates: Requirements 3.7, 9.7**

  - [x]* 14.6 Property test: Target XOR Constraint
    - **Property 6: Target XOR Constraint**
    - Generar combinaciones aleatorias de screen_id/screen_group_id (ambos, ninguno, uno solo); verificar que solo exactamente uno es aceptado
    - **Validates: Requirements 4.3, 4.4**

  - [x]* 14.7 Property test: Cross-Tenant Reference Rejection
    - **Property 7: Cross-Tenant Reference Rejection**
    - Generar resource IDs con combinaciones de tenants; verificar que referencias cross-tenant son rechazadas
    - **Validates: Requirements 3.6, 4.5, 4.6**

  - [x]* 14.8 Property test: Content Deletion FK Protection
    - **Property 8: Content FK Protection**
    - Generar contenido con y sin creative refs; verificar que DELETE 200 solo ocurre sin referencias y 409 con referencias
    - **Validates: Requirements 13.1, 13.4**

  - [x]* 14.9 Property test: Player Speed Override Calculation
    - **Property 9: Speed Override Calculation**
    - Generar duraciones arbitrarias (>0) × factores válidos (1,2,4); verificar Math.ceil(duration/factor) y restauración
    - **Validates: Requirements 20.4, 20.5**

  - [x]* 14.10 Property test: Witness Mode Impression Exclusion
    - **Property 10: Impression Exclusion**
    - Generar eventos de playback con y sin witness mode; verificar que witness no cuenta contra target_spots
    - **Validates: Requirements 20.8, 21.5**

  - [x]* 14.11 Property test: Lightbox Carousel Navigation Consistency
    - **Property 11: Lightbox Navigation**
    - Generar galerías de tamaño N y posiciones arbitrarias; verificar (i+1)%N para siguiente y (i-1+N)%N para anterior
    - **Validates: Requirements 22.3, 22.5**

## Notes

- Las tareas marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido
- Cada tarea referencia los requirements específicos para trazabilidad
- Los checkpoints aseguran validación incremental
- Property tests validan propiedades universales de correctitud definidas en el diseño
- El backend se implementa primero porque el frontend depende de los endpoints API
- Las tareas de limpieza (9.3) pueden ejecutarse en paralelo con las de creación (4.x, 5.x) ya que son independientes
- Los cambios del Player (12.x) dependen del endpoint de comandos (1.5) ya implementado

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5"] },
    { "id": 1, "tasks": ["1.6", "1.7", "2.1", "2.2"] },
    { "id": 2, "tasks": ["4.1", "4.2", "9.3"] },
    { "id": 3, "tasks": ["4.3", "9.1", "9.2"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3", "5.6", "10.1"] },
    { "id": 5, "tasks": ["5.4", "5.5", "6.1", "6.2"] },
    { "id": 6, "tasks": ["6.3", "6.4", "7.1", "7.2"] },
    { "id": 7, "tasks": ["8.1", "8.2"] },
    { "id": 8, "tasks": ["12.1", "12.2"] },
    { "id": 9, "tasks": ["14.1", "14.2", "14.3", "14.4", "14.5", "14.6"] },
    { "id": 10, "tasks": ["14.7", "14.8", "14.9", "14.10", "14.11"] }
  ]
}
```
