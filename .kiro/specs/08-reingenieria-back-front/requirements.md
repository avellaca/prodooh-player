# Requirements Document

## Introduction

Este spec cierra todas las brechas pendientes de los specs 05 (fundación), 06 (motor) y 07 (estabilización). El alcance cubre:

1. **Backend — Endpoints CRUD de administración** para Pedidos, Líneas de pedido, Creativos y asignación de pantallas/grupos (OrderLineTargets). Los modelos y tablas ya existen; falta exponerlos al admin-frontend.
2. **Backend — Limpieza de código obsoleto** en `ScreenController` (validaciones de `loop_config`, `sources_config`, `duration_seconds` que ya no existen en la tabla `screens`).
3. **Admin Frontend — CRUD de Pedidos** (listado, creación, edición, eliminación, detalle con sus líneas).
4. **Admin Frontend — Gestión de Líneas de pedido** (CRUD dentro de un Pedido, gestión de creativos, asignación a pantallas/grupos).
5. **Admin Frontend — Renombrar "Tenants" → "Networks"** en la interfaz (solo labels UI, sin cambios de modelo/API).
6. **Admin Frontend — Eliminación de componentes obsoletos** (`LoopEditor`, `SourceToggles`, tipos y hooks asociados, property tests obsoletos).
7. **Backend — Disparar recálculo de manifiesto** al crear/actualizar/activar/pausar/finalizar Pedidos o Líneas de pedido desde el admin.

## Glossary

- **Sistema_Admin_Backend:** Conjunto de controladores y rutas del backend accesibles por `super_admin` y `tenant_admin` para gestionar Pedidos, Líneas de pedido, Creativos y asignaciones.
- **Admin_Frontend:** Aplicación React (admin-frontend) para la gestión administrativa del sistema.
- **Pedido:** Entidad `orders` — representa un pedido comercial con nombre, anunciante, fechas y estado.
- **Línea_de_Pedido:** Entidad `order_lines` — subdivisión de un Pedido con prioridad, fechas, meta de spots y pantallas objetivo.
- **Creativo:** Entidad `creatives` — contenido de la librería asignado a una Línea de pedido con peso y fechas activas.
- **OrderLineTarget:** Entidad `order_line_targets` — pivot que asigna una Línea de pedido a pantallas o grupos específicos.
- **Network:** Label de interfaz para "Tenant". Solo cambia la etiqueta visible; el modelo de datos (`tenants`) NO se renombra.
- **ManifestRecalculation:** Job existente que recalcula el manifiesto de una o más pantallas cuando ocurren cambios relevantes.
- **TenantScopeMiddleware:** Middleware existente que filtra recursos por `tenant_id` según el usuario autenticado.

## Requirements

### Requirement 1: CRUD de Pedidos — Backend

**User Story:** Como administrador (super_admin o tenant_admin), quiero gestionar Pedidos a través de la API, para crear, consultar, editar y eliminar pedidos comerciales desde el admin-frontend.

#### Acceptance Criteria

1. WHEN un administrador autenticado envía `GET /api/admin/orders`, THE Sistema_Admin_Backend SHALL retornar la lista de Pedidos filtrada por tenant según TenantScopeMiddleware.
2. WHEN un administrador envía `POST /api/admin/orders` con datos válidos (name, advertiser_name, starts_at, ends_at, status), THE Sistema_Admin_Backend SHALL crear el Pedido y retornar el recurso creado con código 201.
3. WHEN un administrador envía `GET /api/admin/orders/{id}`, THE Sistema_Admin_Backend SHALL retornar el Pedido con sus relaciones (order_lines con conteo, estado general).
4. WHEN un administrador envía `PUT /api/admin/orders/{id}` con datos válidos, THE Sistema_Admin_Backend SHALL actualizar el Pedido y retornar el recurso actualizado.
5. WHEN un administrador envía `DELETE /api/admin/orders/{id}`, THE Sistema_Admin_Backend SHALL eliminar el Pedido (cascade delete elimina líneas, creativos, targets e impresiones asociadas).
6. IF un administrador envía `POST /api/admin/orders` con `ends_at < starts_at`, THEN THE Sistema_Admin_Backend SHALL rechazar con error de validación 422 indicando que `ends_at` debe ser mayor o igual a `starts_at`.
7. WHEN un super_admin crea un Pedido, THE Sistema_Admin_Backend SHALL aceptar `tenant_id` en el payload (inyectado via interceptor de axios como query param).
8. WHEN un tenant_admin crea un Pedido, THE Sistema_Admin_Backend SHALL asignar implícitamente el `tenant_id` del usuario autenticado sin requerir el campo en el payload.

---

### Requirement 2: CRUD de Líneas de Pedido — Backend

**User Story:** Como administrador, quiero gestionar Líneas de pedido dentro de un Pedido, para configurar la prioridad, fechas, meta de spots y ritmo de entrega de cada línea.

#### Acceptance Criteria

1. WHEN un administrador envía `GET /api/admin/orders/{order_id}/order-lines`, THE Sistema_Admin_Backend SHALL retornar las Líneas de pedido del Pedido especificado con sus relaciones (creatives_count, targets).
2. WHEN un administrador envía `POST /api/admin/orders/{order_id}/order-lines` con datos válidos (name, priority_tier, starts_at, ends_at, target_spots, delivery_pace, share_weight, status), THE Sistema_Admin_Backend SHALL crear la Línea de pedido y retornar el recurso creado con código 201.
3. WHEN un administrador envía `GET /api/admin/order-lines/{id}`, THE Sistema_Admin_Backend SHALL retornar la Línea de pedido con sus creativos y targets.
4. WHEN un administrador envía `PUT /api/admin/order-lines/{id}` con datos válidos, THE Sistema_Admin_Backend SHALL actualizar la Línea de pedido y retornar el recurso actualizado.
5. WHEN un administrador envía `DELETE /api/admin/order-lines/{id}`, THE Sistema_Admin_Backend SHALL eliminar la Línea de pedido (cascade delete elimina creativos, targets e impresiones asociadas).
6. IF un administrador envía fechas de Línea de pedido fuera del rango del Pedido padre, THEN THE Sistema_Admin_Backend SHALL rechazar con error de validación 422 indicando que las fechas deben estar contenidas en el rango del Pedido.
7. THE Sistema_Admin_Backend SHALL validar que `priority_tier` sea uno de: `patrocinio`, `estandar`, `red_interna`.
8. THE Sistema_Admin_Backend SHALL validar que `delivery_pace` sea uno de: `asap`, `uniform`.

---

### Requirement 3: CRUD de Creativos — Backend

**User Story:** Como administrador, quiero gestionar Creativos dentro de una Línea de pedido, para asignar contenido de la librería existente con peso de rotación y fechas activas.

#### Acceptance Criteria

1. WHEN un administrador envía `GET /api/admin/order-lines/{order_line_id}/creatives`, THE Sistema_Admin_Backend SHALL retornar los Creativos de la Línea de pedido especificada con la relación `content` incluida.
2. WHEN un administrador envía `POST /api/admin/order-lines/{order_line_id}/creatives` con datos válidos (content_id, weight, active_dates), THE Sistema_Admin_Backend SHALL crear el Creativo y retornar el recurso creado con código 201.
3. WHEN un administrador envía `PUT /api/admin/creatives/{id}` con datos válidos, THE Sistema_Admin_Backend SHALL actualizar el Creativo y retornar el recurso actualizado.
4. WHEN un administrador envía `DELETE /api/admin/creatives/{id}`, THE Sistema_Admin_Backend SHALL eliminar el Creativo.
5. IF un administrador envía `active_dates` con fechas fuera del rango de la Línea de pedido padre, THEN THE Sistema_Admin_Backend SHALL rechazar con error de validación 422.
6. THE Sistema_Admin_Backend SHALL validar que `content_id` referencia un contenido existente en la tabla `content` que pertenece al mismo tenant.
7. THE Sistema_Admin_Backend SHALL validar que `weight` es un entero positivo.
8. THE Sistema_Admin_Backend SHALL validar que `active_dates` es un array de strings con formato ISO date (YYYY-MM-DD).

---

### Requirement 4: Gestión de Targets (asignación a pantallas/grupos) — Backend

**User Story:** Como administrador, quiero asignar y desasignar pantallas o grupos de pantallas a una Línea de pedido, para controlar en qué dispositivos se muestra cada línea.

#### Acceptance Criteria

1. WHEN un administrador envía `POST /api/admin/order-lines/{order_line_id}/targets` con `{ screen_id }` o `{ screen_group_id }`, THE Sistema_Admin_Backend SHALL crear el OrderLineTarget y retornar el recurso creado con código 201.
2. WHEN un administrador envía `DELETE /api/admin/order-line-targets/{id}`, THE Sistema_Admin_Backend SHALL eliminar el target (desasignar pantalla/grupo).
3. IF un administrador envía un target con ambos `screen_id` y `screen_group_id` presentes, THEN THE Sistema_Admin_Backend SHALL rechazar con error 422 indicando que solo uno de los dos es permitido.
4. IF un administrador envía un target sin `screen_id` ni `screen_group_id`, THEN THE Sistema_Admin_Backend SHALL rechazar con error 422 indicando que uno de los dos es requerido.
5. THE Sistema_Admin_Backend SHALL validar que `screen_id` (cuando presente) referencia una pantalla del mismo tenant.
6. THE Sistema_Admin_Backend SHALL validar que `screen_group_id` (cuando presente) referencia un grupo del mismo tenant.

---

### Requirement 5: Disparar recálculo de manifiesto en cambios administrativos

**User Story:** Como sistema, quiero que los cambios administrativos a Pedidos y Líneas de pedido disparen automáticamente el recálculo de manifiestos afectados, para que las pantallas reflejen los cambios sin intervención manual.

#### Acceptance Criteria

1. WHEN un Pedido cambia su `status` (a `active`, `paused` o `finished`) via el endpoint admin, THE Sistema_Admin_Backend SHALL despachar el job ManifestRecalculation para todas las pantallas afectadas por ese Pedido.
2. WHEN una Línea de pedido se crea, actualiza su `status`, o se elimina via el endpoint admin, THE Sistema_Admin_Backend SHALL despachar el job ManifestRecalculation para las pantallas asignadas a esa línea (via targets directos y via grupos).
3. WHEN se crea o elimina un OrderLineTarget, THE Sistema_Admin_Backend SHALL despachar el job ManifestRecalculation para la pantalla o pantallas del grupo afectado.
4. WHEN se crea, actualiza o elimina un Creativo, THE Sistema_Admin_Backend SHALL despachar el job ManifestRecalculation para las pantallas afectadas por la Línea de pedido padre del creativo.
5. THE Sistema_Admin_Backend SHALL despachar el job de forma asíncrona (queued) para no bloquear la respuesta HTTP del endpoint admin.

---

### Requirement 6: Limpieza de validaciones obsoletas en ScreenController

**User Story:** Como desarrollador, quiero eliminar las validaciones de `loop_config`, `sources_config` y `duration_seconds` del método `update` de ScreenController, para que el código refleje que esas columnas ya no existen en la tabla `screens`.

#### Acceptance Criteria

1. WHEN un administrador envía `PUT /api/admin/screens/{id}`, THE Sistema_Admin_Backend SHALL aceptar solo campos válidos vigentes: `name`, `orientation`, `resolution_width`, `resolution_height`, `group_id`, `schedule`, `transition_type`, `transition_duration_ms`.
2. THE Sistema_Admin_Backend SHALL rechazar (ignorar silenciosamente o retornar error) los campos `loop_config`, `sources_config` y `duration_seconds` si se envían en el payload de actualización de pantalla.
3. WHEN se intenta crear una pantalla via `POST /api/admin/screens`, THE Sistema_Admin_Backend SHALL omitir la asignación de defaults para `loop_config` y `sources_config` en DeviceService (esos campos ya no existen en la tabla).

---

### Requirement 7: Página de Pedidos — Admin Frontend

**User Story:** Como administrador, quiero una página de listado de Pedidos en el admin-frontend, para ver, crear, editar y eliminar pedidos del tenant seleccionado.

#### Acceptance Criteria

1. WHEN el administrador navega a la ruta `/orders`, THE Admin_Frontend SHALL mostrar una tabla con los Pedidos del tenant activo (nombre, anunciante, fechas, estado).
2. WHEN el administrador hace clic en "Crear pedido", THE Admin_Frontend SHALL mostrar un formulario con campos: nombre, anunciante (opcional), fecha inicio, fecha fin, estado (draft por defecto).
3. WHEN el administrador envía el formulario de creación con datos válidos, THE Admin_Frontend SHALL enviar `POST /api/admin/orders` y actualizar la lista automáticamente al recibir respuesta exitosa.
4. WHEN el administrador hace clic en un Pedido de la lista, THE Admin_Frontend SHALL navegar a la página de detalle del Pedido (`/orders/:id`).
5. WHEN el administrador hace clic en "Eliminar" un Pedido, THE Admin_Frontend SHALL mostrar un diálogo de confirmación y enviar `DELETE /api/admin/orders/{id}` al confirmar.
6. THE Admin_Frontend SHALL validar en el cliente que `ends_at >= starts_at` antes de enviar el formulario usando Zod schema y React Hook Form.
7. THE Admin_Frontend SHALL seguir la estructura de carpetas existente: `features/orders/pages/`, `features/orders/api.ts`, `features/orders/hooks.ts`.

---

### Requirement 8: Página de Detalle de Pedido — Admin Frontend

**User Story:** Como administrador, quiero ver el detalle de un Pedido con sus Líneas de pedido, para gestionar las líneas dentro del contexto del Pedido padre.

#### Acceptance Criteria

1. WHEN el administrador navega a `/orders/:id`, THE Admin_Frontend SHALL mostrar la información del Pedido (nombre, anunciante, fechas, estado) y la lista de Líneas de pedido asociadas.
2. WHEN el administrador hace clic en "Editar pedido", THE Admin_Frontend SHALL mostrar un diálogo de edición con los campos del Pedido pre-poblados.
3. WHEN el administrador hace clic en "Crear línea de pedido", THE Admin_Frontend SHALL mostrar un formulario con campos: nombre, nivel de prioridad (selector: patrocinio/estándar/red_interna), fecha inicio, fecha fin, target_spots (opcional), delivery_pace (selector: uniform/asap), share_weight, estado.
4. WHEN el administrador envía el formulario de creación de línea con datos válidos, THE Admin_Frontend SHALL enviar `POST /api/admin/orders/{order_id}/order-lines` y actualizar la lista de líneas.
5. WHEN el administrador hace clic en una Línea de pedido, THE Admin_Frontend SHALL expandir o navegar a una vista de detalle donde se gestionan creativos y targets.
6. THE Admin_Frontend SHALL validar en el cliente que las fechas de la Línea de pedido estén dentro del rango del Pedido padre.
7. THE Admin_Frontend SHALL usar TanStack Query (useQuery/useMutation) para todas las operaciones de datos, sin useEffect para data fetching.

---

### Requirement 9: Gestión de Creativos — Admin Frontend

**User Story:** Como administrador, quiero agregar, editar y eliminar Creativos dentro de una Línea de pedido, para asignar contenido de la librería con peso de rotación y calendario de fechas activas.

#### Acceptance Criteria

1. WHEN el administrador está en el detalle de una Línea de pedido, THE Admin_Frontend SHALL mostrar la lista de Creativos asignados con thumbnail del contenido, peso y fechas activas.
2. WHEN el administrador hace clic en "Agregar creativo", THE Admin_Frontend SHALL mostrar un selector de contenido de la librería existente (filtrado por tenant), un campo de peso numérico, y un selector de calendario para fechas activas.
3. WHEN el administrador selecciona fechas activas, THE Admin_Frontend SHALL permitir selección libre de días individuales, rangos y multi-rangos dentro de un componente tipo calendario.
4. WHEN el administrador envía el formulario con datos válidos, THE Admin_Frontend SHALL enviar `POST /api/admin/order-lines/{id}/creatives` y actualizar la lista de creativos.
5. WHEN el administrador elimina un Creativo, THE Admin_Frontend SHALL mostrar diálogo de confirmación y enviar `DELETE /api/admin/creatives/{id}`.
6. THE Admin_Frontend SHALL validar que las fechas activas seleccionadas estén dentro del rango de la Línea de pedido padre.
7. THE Admin_Frontend SHALL validar que el peso es un entero positivo mayor a cero.

---

### Requirement 10: Asignación de Targets (pantallas/grupos) — Admin Frontend

**User Story:** Como administrador, quiero asignar y desasignar pantallas o grupos de pantallas a una Línea de pedido, para controlar el alcance geográfico/físico de cada línea.

#### Acceptance Criteria

1. WHEN el administrador está en el detalle de una Línea de pedido, THE Admin_Frontend SHALL mostrar la lista de pantallas y grupos actualmente asignados.
2. WHEN el administrador hace clic en "Asignar pantalla", THE Admin_Frontend SHALL mostrar un selector con las pantallas disponibles del tenant (excluyendo las ya asignadas).
3. WHEN el administrador hace clic en "Asignar grupo", THE Admin_Frontend SHALL mostrar un selector con los grupos disponibles del tenant (excluyendo los ya asignados).
4. WHEN el administrador selecciona una pantalla o grupo, THE Admin_Frontend SHALL enviar `POST /api/admin/order-lines/{id}/targets` con el campo correspondiente.
5. WHEN el administrador hace clic en "Desasignar" un target, THE Admin_Frontend SHALL enviar `DELETE /api/admin/order-line-targets/{id}` y actualizar la lista.
6. THE Admin_Frontend SHALL usar TanStack Query para invalidar y refrescar la lista de targets después de cada operación.

---

### Requirement 11: Renombrar "Tenants" a "Networks" en la interfaz

**User Story:** Como usuario del admin-frontend, quiero ver el término "Networks" en lugar de "Tenants" en la interfaz, para alinear la terminología visible con el lenguaje de negocio de Prodooh.

#### Acceptance Criteria

1. WHEN el admin-frontend renderiza el menú de navegación, THE Admin_Frontend SHALL mostrar "Networks" en lugar de "Tenants" como label del enlace.
2. WHEN el admin-frontend renderiza el selector de tenant para super_admin, THE Admin_Frontend SHALL mostrar "Seleccionar network" como placeholder en lugar de "Seleccionar tenant".
3. WHEN el administrador navega a la página de gestión de tenants, THE Admin_Frontend SHALL mostrar el título "Networks" y la ruta SHALL cambiar de `/tenants` a `/networks`.
4. THE Admin_Frontend SHALL renombrar el componente `TenantsPage` a `NetworksPage` (archivo y export).
5. THE Admin_Frontend SHALL mantener internamente los nombres de variables, contexto (`TenantContext`, `useTenantContext`, `selectedTenantId`) y endpoints API (`/admin/tenants`) sin cambios — solo cambia lo visible en la interfaz.

---

### Requirement 12: Eliminación de componentes obsoletos del admin-frontend

**User Story:** Como desarrollador, quiero eliminar los componentes y tipos obsoletos del sistema de Loop/Sources, para que el código refleje que ese modelo ya no existe.

#### Acceptance Criteria

1. WHEN se completa la limpieza, THE Admin_Frontend SHALL haber eliminado el componente `LoopEditor` del directorio `features/screens/components/`.
2. WHEN se completa la limpieza, THE Admin_Frontend SHALL haber eliminado el componente `SourceToggles` del directorio `features/screens/components/`.
3. WHEN se completa la limpieza, THE Admin_Frontend SHALL haber eliminado las interfaces `LoopSlot` y `SourcesConfig` del archivo `types/models.ts`.
4. WHEN se completa la limpieza, THE Admin_Frontend SHALL haber eliminado los hooks `useUpdateLoop` y `useUpdateSources` del archivo `features/screens/hooks.ts`.
5. WHEN se completa la limpieza, THE Admin_Frontend SHALL haber eliminado los métodos `updateLoop` y `updateSources` del archivo `features/screens/api.ts` junto con la función `transformScreen` (que transforma `loop_config`/`sources_config`).
6. WHEN se completa la limpieza, THE Admin_Frontend SHALL haber actualizado `ScreenDetailPage` para eliminar las secciones de "Configuración de Loop" y "Fuentes activas" y sus imports.
7. WHEN se completa la limpieza, THE Admin_Frontend SHALL haber eliminado `loop_config`, `sources_config` y `duration_seconds` de la interfaz `Screen` en `types/models.ts`.
8. WHEN se completa la limpieza, THE Admin_Frontend SHALL haber eliminado o actualizado los property tests que validan transformaciones de `loop_config`/`sources_config` (en `features/__tests__/preservation-api-contracts.property.test.ts` y `api-contract-mismatches.property.test.ts`).

---

### Requirement 13: Manejo amigable de error FK al eliminar contenido referenciado por creativos

**User Story:** Como administrador, quiero recibir un mensaje de error comprensible cuando intento eliminar contenido que está siendo usado por un creativo, para entender por qué no puedo eliminarlo y qué acción tomar.

#### Acceptance Criteria

1. WHEN un administrador envía `DELETE /api/admin/content/{id}` y el contenido está referenciado por al menos un Creativo (FK RESTRICT en tabla `creatives`), THE Sistema_Admin_Backend SHALL capturar la excepción de constraint violation y retornar un error HTTP 409 con un mensaje legible: "No se puede eliminar este contenido porque está siendo utilizado por uno o más creativos activos. Elimine primero los creativos que lo referencian."
2. WHEN el Admin_Frontend recibe un error 409 al intentar eliminar contenido, THE Admin_Frontend SHALL mostrar el mensaje de error del servidor en una notificación toast visible para el usuario (no un error técnico SQL).
3. THE Sistema_Admin_Backend SHALL verificar la referencia ANTES de intentar el DELETE cuando sea posible (consulta previa a `creatives` donde `content_id = id`), para evitar depender de la excepción de BD como flujo normal.
4. WHEN el contenido NO está referenciado por ningún creativo, THE Sistema_Admin_Backend SHALL proceder con la eliminación normalmente y retornar 200.

---

### Requirement 14: Navegación de Pedidos integrada al menú principal

**User Story:** Como administrador, quiero acceder a la sección de Pedidos desde el menú principal de navegación, para gestionar pedidos sin tener que recordar la URL.

#### Acceptance Criteria

1. WHEN el admin-frontend renderiza el menú de navegación para super_admin, THE Admin_Frontend SHALL incluir un enlace "Pedidos" que navega a `/orders`, posicionado entre "Networks" y "Pantallas".
2. WHEN el admin-frontend renderiza el menú de navegación para tenant_admin, THE Admin_Frontend SHALL incluir un enlace "Pedidos" que navega a `/orders`, posicionado como primer elemento.
3. WHEN el administrador navega a `/orders`, THE Admin_Frontend SHALL renderizar la ruta dentro del layout protegido accesible por ambos roles (super_admin y tenant_admin).
4. WHEN el administrador navega a `/orders/:id`, THE Admin_Frontend SHALL renderizar la página de detalle del Pedido dentro del mismo layout protegido.

---

### Requirement 15: Vista de Líneas de pedido activas en detalle de pantalla

**User Story:** Como administrador, quiero ver qué Líneas de pedido tienen una pantalla como target al consultar su detalle, para entender qué contenido comercial está programado para ese dispositivo.

#### Acceptance Criteria

1. WHEN el administrador navega a `/screens/:id`, THE Admin_Frontend SHALL mostrar una sección "Líneas de pedido activas" con la lista de OrderLines que tienen esta pantalla asignada (directamente via `screen_id` o indirectamente via `screen_group_id` del grupo al que pertenece la pantalla).
2. WHEN existen Líneas de pedido asignadas, THE Admin_Frontend SHALL mostrar para cada una: nombre de la línea, nombre del Pedido padre, nivel de prioridad (badge con color: patrocinio=dorado, estándar=azul, red_interna=gris), fechas, y estado.
3. WHEN no existen Líneas de pedido asignadas a la pantalla, THE Admin_Frontend SHALL mostrar un mensaje indicando "No hay líneas de pedido activas para esta pantalla".
4. WHEN el administrador hace clic en una Línea de pedido de la lista, THE Admin_Frontend SHALL navegar a la página de detalle del Pedido correspondiente (`/orders/:order_id`).
5. THE Admin_Frontend SHALL obtener esta información del endpoint `GET /api/admin/screens/{id}` con las relaciones necesarias incluidas, o de un endpoint dedicado que retorne las OrderLines activas para una pantalla.

---

### Requirement 16: Vista de manifiesto actual en detalle de pantalla

**User Story:** Como administrador, quiero ver un resumen del manifiesto vigente de una pantalla, para entender qué secuencia de contenido está reproduciendo actualmente el dispositivo.

#### Acceptance Criteria

1. WHEN el administrador navega a `/screens/:id` y la pantalla tiene un manifiesto generado, THE Admin_Frontend SHALL mostrar una sección "Manifiesto actual" con: versión, fecha de generación, total de spots, y un resumen de composición (cuántos spots de pedidos, cuántos de SSP, cuántos de playlist).
2. WHEN la pantalla NO tiene un manifiesto generado (campo `manifest_version` vacío o null), THE Admin_Frontend SHALL mostrar un mensaje indicando "Sin manifiesto generado — el motor de prioridad aún no ha procesado esta pantalla".
3. WHEN el administrador hace clic en "Ver detalle del manifiesto", THE Admin_Frontend SHALL mostrar un diálogo o sección expandida con la lista de ítems del manifiesto en orden: posición, tipo (badge: pedido/SSP/playlist), duración, y nombre del contenido o línea asociada.
4. THE Admin_Frontend SHALL obtener la información del manifiesto desde el endpoint existente o desde una relación incluida en `GET /api/admin/screens/{id}` que retorne los datos de `screen_manifests`.

---

### Requirement 17: Configuración de horario operativo en detalle de pantalla

**User Story:** Como administrador, quiero configurar el horario operativo (schedule) de una pantalla individual desde su página de detalle, para definir en qué franjas horarias y días de la semana debe estar activa.

#### Acceptance Criteria

1. WHEN el administrador navega a `/screens/:id`, THE Admin_Frontend SHALL mostrar una sección "Horario operativo" con el schedule actual de la pantalla (o indicar "Hereda del grupo" si es null).
2. WHEN el administrador hace clic en "Editar horario", THE Admin_Frontend SHALL mostrar un editor de schedule que permita configurar franjas horarias por día de la semana: selección de días (lun-dom), hora de inicio y hora de fin para cada franja.
3. WHEN el administrador guarda el schedule, THE Admin_Frontend SHALL enviar `PUT /api/admin/screens/{id}` con el campo `schedule` como array de objetos `{ days: number[], start: string, end: string }` y actualizar la vista al recibir respuesta exitosa.
4. WHEN el administrador quiere que la pantalla herede el schedule del grupo, THE Admin_Frontend SHALL permitir "Restablecer a herencia del grupo" enviando `schedule: null` en el PUT.
5. THE Admin_Frontend SHALL mostrar visualmente de dónde proviene el horario activo: "Configurado en esta pantalla", "Heredado del grupo: {nombre}", o "Heredado del tenant (24/7 por defecto)".

---

### Requirement 18: Configuración de horario operativo en bulk desde grupos

**User Story:** Como administrador, quiero configurar el horario operativo a nivel de grupo de pantallas, para que todas las pantallas del grupo hereden el mismo schedule sin tener que editarlas una por una.

#### Acceptance Criteria

1. WHEN el administrador navega a `/groups/:id`, THE Admin_Frontend SHALL mostrar una sección "Horario operativo del grupo" con el schedule actual del grupo.
2. WHEN el administrador edita el schedule del grupo y lo guarda, THE Admin_Frontend SHALL enviar `PUT /api/admin/groups/{id}` con el campo `schedule` actualizado.
3. WHEN se actualiza el schedule del grupo, THE Sistema_Admin_Backend SHALL despachar el job ManifestRecalculation para TODAS las pantallas del grupo (ya que el cambio de ventana operativa afecta la capacidad diaria de cada una).
4. WHEN una pantalla del grupo tiene su propio schedule configurado (no null), THE Admin_Frontend SHALL indicar en la vista de grupo cuáles pantallas usan el schedule del grupo y cuáles tienen override propio.
5. WHEN el administrador quiere forzar el schedule del grupo en todas las pantallas (ignorando overrides individuales), THE Admin_Frontend SHALL ofrecer una acción "Aplicar a todas" que envíe `PUT /api/admin/groups/{id}/apply-schedule` para resetear el `schedule` de todas las pantallas del grupo a null (herencia).


---

### Requirement 19: Acción rápida de Pausar/Activar Pedidos y Líneas de pedido

**User Story:** Como administrador, quiero pausar o activar un Pedido o Línea de pedido con un solo clic desde la lista, para cambiar su estado rápidamente sin abrir el formulario de edición.

#### Acceptance Criteria

1. WHEN el administrador está en la lista de Pedidos (`/orders`), THE Admin_Frontend SHALL mostrar un botón de acción rápida (toggle o botón con ícono) en cada fila para cambiar el estado entre `active` y `paused`.
2. WHEN el administrador hace clic en el botón de pausa de un Pedido activo, THE Admin_Frontend SHALL enviar `PUT /api/admin/orders/{id}` con `{ status: 'paused' }` y actualizar la fila inmediatamente al recibir respuesta exitosa.
3. WHEN el administrador hace clic en el botón de activar de un Pedido pausado, THE Admin_Frontend SHALL enviar `PUT /api/admin/orders/{id}` con `{ status: 'active' }` y actualizar la fila inmediatamente.
4. WHEN el administrador está en el detalle de un Pedido (`/orders/:id`) viendo la lista de Líneas de pedido, THE Admin_Frontend SHALL mostrar el mismo botón de acción rápida en cada Línea de pedido para cambiar entre `active` y `paused`.
5. WHEN se cambia el estado via acción rápida, THE Sistema_Admin_Backend SHALL disparar el recálculo de manifiesto para las pantallas afectadas (según Requirement 5).
6. THE Admin_Frontend SHALL mostrar un indicador visual de carga (spinner o disabled state) durante la mutación y un toast de confirmación al completarse.

---

### Requirement 20: Modo Testigo — Aceleración temporal de reproducción

**User Story:** Como administrador, quiero acelerar temporalmente la velocidad de reproducción de una pantalla desde el admin-frontend, para que el personal de campo pueda fotografiar rápidamente los anuncios sin esperar el ciclo completo.

#### Acceptance Criteria

1. WHEN el administrador navega a `/screens/:id`, THE Admin_Frontend SHALL mostrar un botón "Modo Testigo" en la sección de controles de la pantalla.
2. WHEN el administrador activa el Modo Testigo, THE Admin_Frontend SHALL mostrar un selector de velocidad (x2, x4) y enviar `POST /api/admin/screens/{id}/commands` con `{ type: 'speed_override', factor: 2|4, expires_at: ISO_timestamp }` donde `expires_at` es 10 minutos desde el momento de activación.
3. WHEN el backend recibe el comando de speed_override, THE Sistema_Admin_Backend SHALL insertar un registro en la tabla `device_commands` con status `pending` y los datos del comando.
4. WHEN el player obtiene el comando via heartbeat (polling cada 30s), THE player SHALL reducir temporalmente la duración de cada spot dividiéndola por el factor indicado (ej. 10s ÷ 2 = 5s) sin modificar el manifiesto.
5. WHEN el timestamp `expires_at` se alcanza, THE player SHALL restaurar automáticamente las duraciones originales de los spots sin requerir intervención del admin.
6. WHEN el administrador hace clic en "Desactivar Modo Testigo", THE Admin_Frontend SHALL enviar `POST /api/admin/screens/{id}/commands` con `{ type: 'speed_override', factor: 1 }` para cancelar el override inmediatamente.
7. THE Admin_Frontend SHALL mostrar un indicador visual cuando el Modo Testigo está activo en una pantalla (badge "Testigo x2" o similar).
8. THE player SHALL no contar las reproducciones aceleradas como impresiones normales — las impresiones durante Modo Testigo se registran con un flag `mode: 'witness'` o se excluyen del conteo de `target_spots`.

---

### Requirement 21: Modo Testigo — Previsualización directa de contenido

**User Story:** Como administrador, quiero enviar un contenido específico a una pantalla para que se reproduzca inmediatamente una vez, para sacar el testigo fotográfico de ese creativo sin esperar a que salga en el ciclo normal.

#### Acceptance Criteria

1. WHEN el administrador está en `/screens/:id`, THE Admin_Frontend SHALL mostrar un botón "Previsualizar contenido" en la sección de controles.
2. WHEN el administrador hace clic en "Previsualizar contenido", THE Admin_Frontend SHALL mostrar un selector de contenido de la librería del tenant (con thumbnails) y un campo de duración opcional (default: duración del spot configurada).
3. WHEN el administrador selecciona un contenido y confirma, THE Admin_Frontend SHALL enviar `POST /api/admin/screens/{id}/commands` con `{ type: 'preview_content', content_id: '...', asset_url: '...', duration_seconds: N }`.
4. WHEN el player obtiene el comando de preview_content via heartbeat, THE player SHALL interrumpir el ciclo normal al finalizar el ítem actual, reproducir el contenido indicado UNA vez por la duración especificada, y luego reanudar el manifiesto normal desde donde quedó.
5. THE player SHALL no registrar la reproducción del preview como impresión (no cuenta contra target_spots ni aparece en reportes de entrega).
6. THE Admin_Frontend SHALL mostrar un toast de confirmación "Contenido enviado a la pantalla — aparecerá en los próximos 30 segundos" (latencia máxima del polling de heartbeat).
7. WHEN el player no puede descargar el contenido del preview (URL inválida, red caída), THE player SHALL ignorar el comando silenciosamente y continuar con el manifiesto normal.


---

### Requirement 22: Previews visuales de contenido con lightbox y carrusel

**User Story:** Como administrador, quiero ver previews grandes y navegables del contenido visual (imágenes y videos), para reconocer rápidamente los creativos al asignarlos y revisar la galería de contenido.

#### Acceptance Criteria

1. WHEN el administrador está en la página de Contenido (`/content`), THE Admin_Frontend SHALL mostrar los archivos como tarjetas con miniaturas (thumbnails) de tamaño visible (mínimo 120×120px) mostrando la imagen o un frame del video.
2. WHEN el administrador hace clic en una miniatura en la galería de contenido, THE Admin_Frontend SHALL abrir un lightbox modal que muestra la imagen a tamaño completo (o el video con controles de reproducción) centrado sobre un fondo oscuro semitransparente.
3. WHEN el lightbox está abierto en la galería de contenido, THE Admin_Frontend SHALL mostrar botones de navegación (flechas izquierda/derecha) para avanzar y retroceder entre los contenidos de la galería sin cerrar el lightbox (comportamiento tipo carrusel).
4. WHEN el lightbox está abierto, THE Admin_Frontend SHALL permitir cerrarlo haciendo clic fuera del contenido, presionando Escape, o haciendo clic en un botón de cierre (X).
5. WHEN el administrador navega con el carrusel, THE Admin_Frontend SHALL permitir también navegación con las teclas de flecha del teclado (← →).
6. WHEN el administrador está seleccionando contenido para un Creativo (Req 9), THE Admin_Frontend SHALL mostrar las opciones de contenido como tarjetas con miniaturas visuales (no solo nombre de archivo), siguiendo el patrón de Google Ad Manager donde los creativos son fácilmente reconocibles por su thumbnail.
7. WHEN el administrador está viendo la lista de Creativos asignados a una Línea de pedido, THE Admin_Frontend SHALL mostrar la miniatura del contenido asociado a cada creativo (thumbnail visible inline en la lista).
8. WHEN el administrador hace clic en la miniatura de un creativo en la lista de una Línea de pedido, THE Admin_Frontend SHALL abrir el lightbox de preview con la imagen/video a tamaño completo.
9. WHEN el contenido es un video, THE Admin_Frontend SHALL mostrar en el lightbox un reproductor con controles de play/pause, barra de progreso, y volumen.
10. THE Admin_Frontend SHALL usar lazy loading para las miniaturas (cargar solo las visibles en viewport) para mantener buen rendimiento con galerías grandes.