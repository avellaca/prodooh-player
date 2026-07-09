# Requirements — Player Reingeniería: Fundación (Modelo de Datos)

## Introduction

Este spec cubre la capa de datos fundacional para la reingeniería del sistema de distribución de contenido del player. Reemplaza el modelo de Loop de slots fijos por la estructura de Pedido → Línea de pedido → Creativo, establece la tabla `impressions` como reemplazo de `playback_logs`, y retira campos obsoletos de `screens`.

El alcance es exclusivamente: migraciones de BD, modelos Eloquent, relaciones, y validaciones a nivel modelo. No incluye endpoints de API, lógica de motor de prioridad, ni interfaz de administración — esos se resuelven en specs posteriores.

## Glossary

- **Pedido (Order):** Entidad comercial de nivel superior con fechas de vigencia, representando una compra de inventario DOOH por un anunciante.
- **Línea de pedido (Order Line):** Subdivisión de un Pedido con prioridad, pantallas objetivo, y meta de spots.
- **Creativo (Creative):** Pieza de contenido específica dentro de una Línea de pedido, con fechas activas y peso de rotación.
- **Impresión (Impression):** Registro de una reproducción de contenido en una pantalla.
- **Network/Tenant:** Organización propietaria de pantallas y pedidos (tabla `tenants` existente, sin renombrar).
- **Motor de prioridad:** Algoritmo que resuelve qué contenido mostrar en cada instante (spec 06, fuera de alcance aquí).

## Requirements

### Requirement 1: Migración — Crear tabla `orders`

**User Story:** Como desarrollador, quiero que exista la tabla `orders` en la base de datos, para que el sistema pueda almacenar pedidos comerciales con fechas de vigencia y estado.

#### Acceptance Criteria

1. WHEN se ejecuta la migración, THEN se crea la tabla `orders` con los campos: `id` (uuid PK), `tenant_id` (uuid FK cascade delete a `tenants`), `name` (string not null), `advertiser_name` (string nullable), `starts_at` (date not null), `ends_at` (date not null), `status` (enum: draft/active/paused/finished, default draft), `created_at` (timestamp), `updated_at` (timestamp).
2. WHEN se crea un registro, THEN la constraint de BD impone que `ends_at >= starts_at`.
3. WHEN se elimina un tenant, THEN todos sus pedidos se eliminan en cascada.
4. WHEN se ejecuta rollback, THEN la tabla `orders` se elimina completamente.

---

### Requirement 2: Migración — Crear tabla `order_lines`

**User Story:** Como desarrollador, quiero que exista la tabla `order_lines` en la base de datos, para que el sistema pueda almacenar líneas de pedido con prioridad, metas de entrega y ritmo.

#### Acceptance Criteria

1. WHEN se ejecuta la migración, THEN se crea la tabla `order_lines` con los campos: `id` (uuid PK), `order_id` (uuid FK cascade delete a `orders`), `name` (string not null), `priority_tier` (enum: patrocinio/estandar/red_interna), `starts_at` (date not null), `ends_at` (date not null), `target_spots` (integer nullable), `delivery_pace` (enum: asap/uniform, default uniform), `share_weight` (integer default 100), `time_window` (jsonb nullable), `status` (enum: draft/active/paused/finished, default draft), `created_at` (timestamp), `updated_at` (timestamp).
2. WHEN se crea un registro, THEN la constraint de BD impone que `ends_at >= starts_at`.
3. WHEN se elimina un pedido, THEN todas sus líneas de pedido se eliminan en cascada.
4. WHEN se ejecuta rollback, THEN la tabla `order_lines` se elimina completamente.

---

### Requirement 3: Migración — Crear tabla `order_line_targets`

**User Story:** Como desarrollador, quiero que exista la tabla pivot `order_line_targets`, para que el sistema pueda asignar líneas de pedido a pantallas específicas o grupos de pantallas.

#### Acceptance Criteria

1. WHEN se ejecuta la migración, THEN se crea la tabla `order_line_targets` con los campos: `id` (uuid PK), `order_line_id` (uuid FK cascade delete a `order_lines`), `screen_id` (uuid FK nullable cascade delete a `screens`), `screen_group_id` (uuid FK nullable cascade delete a `screen_groups`), `created_at` (timestamp).
2. WHEN se inserta un registro, THEN la constraint CHECK de BD impone que exactamente uno de `screen_id` / `screen_group_id` sea NOT NULL (XOR).
3. WHEN se elimina una línea de pedido, THEN todos sus targets se eliminan en cascada.
4. WHEN se elimina una pantalla o grupo referenciado, THEN el target correspondiente se elimina en cascada.
5. WHEN se ejecuta rollback, THEN la tabla `order_line_targets` se elimina completamente.

---

### Requirement 4: Migración — Crear tabla `creatives`

**User Story:** Como desarrollador, quiero que exista la tabla `creatives` en la base de datos, para que el sistema pueda almacenar creativos con peso de rotación y fechas activas explícitas.

#### Acceptance Criteria

1. WHEN se ejecuta la migración, THEN se crea la tabla `creatives` con los campos: `id` (uuid PK), `order_line_id` (uuid FK cascade delete a `order_lines`), `content_id` (uuid FK a `content`, restrict on delete — no permite borrar contenido referenciado por un creativo activo), `weight` (integer default 100), `active_dates` (jsonb not null), `created_at` (timestamp), `updated_at` (timestamp).
2. WHEN se elimina una línea de pedido, THEN todos sus creativos se eliminan en cascada.
3. WHEN se intenta eliminar un registro de `content` referenciado por un creativo, THEN la operación falla con constraint violation (RESTRICT).
4. WHEN se ejecuta rollback, THEN la tabla `creatives` se elimina completamente.

---

### Requirement 5: Migración — Crear tabla `impressions`

**User Story:** Como desarrollador, quiero que exista la tabla `impressions` como reemplazo de `playback_logs`, para que el sistema registre reproducciones vinculadas directamente al modelo de Pedidos/Creativos.

#### Acceptance Criteria

1. WHEN se ejecuta la migración, THEN se elimina la tabla `playback_logs` y se crea la tabla `impressions` con los campos: `id` (uuid PK), `screen_id` (uuid FK cascade delete a `screens`), `creative_id` (uuid FK nullable, set null on delete a `creatives`), `order_line_id` (uuid FK nullable, set null on delete a `order_lines`), `source` (enum: order_line/playlist/prodooh_ssp), `started_at` (timestamp not null), `ended_at` (timestamp nullable), `duration_seconds` (decimal 10,2 nullable), `result` (enum: success/failed), `failure_reason` (string nullable), `synced_at` (timestamp nullable), `created_at` (timestamp).
2. WHEN se elimina una pantalla, THEN todas sus impresiones se eliminan en cascada.
3. WHEN se elimina un creativo o línea de pedido referenciados, THEN los campos `creative_id` / `order_line_id` en impresiones existentes se ponen NULL (preservando el registro histórico).
4. WHEN se ejecuta rollback, THEN la tabla `impressions` se elimina y la tabla `playback_logs` se recrea con su estructura original.

---

### Requirement 6: Migración — Retirar campos obsoletos de `screens`

**User Story:** Como desarrollador, quiero que los campos `loop_config`, `sources_config` y `duration_seconds` se eliminen de la tabla `screens`, para que no exista ambigüedad entre el modelo antiguo de slots y el nuevo modelo de prioridad.

#### Acceptance Criteria

1. WHEN se ejecuta la migración, THEN se eliminan las columnas `loop_config`, `sources_config` y `duration_seconds` de la tabla `screens`.
2. WHEN se ejecuta rollback, THEN las tres columnas se recrean con sus tipos originales: `loop_config` (jsonb), `sources_config` (jsonb), `duration_seconds` (integer nullable).

---

### Requirement 7: Modelo Eloquent — Order

**User Story:** Como desarrollador, quiero un modelo Eloquent `Order` con sus relaciones y configuración, para operar con pedidos de forma idiomática en Laravel.

#### Acceptance Criteria

1. WHEN se instancia el modelo, THEN usa UUID como primary key (trait `HasUuids`), mass-assignment protegido con `$fillable`, y casts apropiados (`starts_at` → date, `ends_at` → date, `status` → enum o string).
2. WHEN se accede a `$order->tenant`, THEN retorna la relación `belongsTo(Tenant)`.
3. WHEN se accede a `$order->orderLines`, THEN retorna la relación `hasMany(OrderLine)`.
4. WHEN se accede a `$order->impressions`, THEN retorna la relación `hasManyThrough(Impression, OrderLine)` (a través de líneas de pedido y creativos, para reportes).
5. WHEN el modelo usa el trait `BelongsToTenant`, THEN el global scope de tenant se aplica automáticamente para aislamiento multi-tenant.

---

### Requirement 8: Modelo Eloquent — OrderLine

**User Story:** Como desarrollador, quiero un modelo Eloquent `OrderLine` con sus relaciones y validaciones, para operar con líneas de pedido de forma idiomática en Laravel.

#### Acceptance Criteria

1. WHEN se instancia el modelo, THEN usa UUID como primary key, mass-assignment protegido con `$fillable`, y casts apropiados (`starts_at` → date, `ends_at` → date, `priority_tier` → enum o string, `delivery_pace` → enum o string, `time_window` → json/array).
2. WHEN se accede a `$orderLine->order`, THEN retorna la relación `belongsTo(Order)`.
3. WHEN se accede a `$orderLine->creatives`, THEN retorna la relación `hasMany(Creative)`.
4. WHEN se accede a `$orderLine->targets`, THEN retorna la relación `hasMany(OrderLineTarget)`.
5. WHEN se accede a `$orderLine->screens`, THEN retorna las pantallas objetivo resueltas (directas + las del grupo) mediante relación o método accessor.
6. WHEN se accede a `$orderLine->impressions`, THEN retorna la relación `hasMany(Impression)`.

---

### Requirement 9: Modelo Eloquent — OrderLineTarget

**User Story:** Como desarrollador, quiero un modelo Eloquent `OrderLineTarget` con sus relaciones, para representar la asignación de líneas de pedido a pantallas o grupos.

#### Acceptance Criteria

1. WHEN se instancia el modelo, THEN usa UUID como primary key y mass-assignment protegido con `$fillable`.
2. WHEN se accede a `$target->orderLine`, THEN retorna la relación `belongsTo(OrderLine)`.
3. WHEN se accede a `$target->screen`, THEN retorna la relación `belongsTo(Screen)` (nullable).
4. WHEN se accede a `$target->screenGroup`, THEN retorna la relación `belongsTo(ScreenGroup)` (nullable).

---

### Requirement 10: Modelo Eloquent — Creative

**User Story:** Como desarrollador, quiero un modelo Eloquent `Creative` con sus relaciones y casts, para operar con creativos de forma idiomática en Laravel.

#### Acceptance Criteria

1. WHEN se instancia el modelo, THEN usa UUID como primary key, mass-assignment protegido con `$fillable`, y casts apropiados (`active_dates` → array/json, `weight` → integer).
2. WHEN se accede a `$creative->orderLine`, THEN retorna la relación `belongsTo(OrderLine)`.
3. WHEN se accede a `$creative->content`, THEN retorna la relación `belongsTo(Content)`.
4. WHEN se accede a `$creative->impressions`, THEN retorna la relación `hasMany(Impression)`.

---

### Requirement 11: Modelo Eloquent — Impression

**User Story:** Como desarrollador, quiero un modelo Eloquent `Impression` con sus relaciones, para registrar y consultar reproducciones vinculadas al modelo comercial.

#### Acceptance Criteria

1. WHEN se instancia el modelo, THEN usa UUID como primary key, mass-assignment protegido con `$fillable`, y casts apropiados (`started_at` → datetime, `ended_at` → datetime, `synced_at` → datetime, `duration_seconds` → decimal/float).
2. WHEN se accede a `$impression->screen`, THEN retorna la relación `belongsTo(Screen)`.
3. WHEN se accede a `$impression->creative`, THEN retorna la relación `belongsTo(Creative)` (nullable).
4. WHEN se accede a `$impression->orderLine`, THEN retorna la relación `belongsTo(OrderLine)` (nullable).

---

### Requirement 12: Validaciones a nivel modelo — Containment de fechas

**User Story:** Como desarrollador, quiero que el sistema valide automáticamente que las fechas de cada nivel estén contenidas dentro del rango del nivel superior, para prevenir inconsistencias de datos.

#### Acceptance Criteria

1. WHEN se crea o actualiza una OrderLine, IF `starts_at` < `order.starts_at` OR `ends_at` > `order.ends_at`, THEN la operación falla con un ValidationException indicando que las fechas deben estar contenidas en el rango del pedido padre.
2. WHEN se crea o actualiza un Creative, IF alguna fecha en `active_dates` está fuera del rango `[order_line.starts_at, order_line.ends_at]`, THEN la operación falla con un ValidationException indicando que las fechas activas deben estar contenidas en el rango de la línea de pedido padre.
3. WHEN se actualiza un Order reduciendo su rango de fechas, IF alguna OrderLine hija tiene fechas fuera del nuevo rango, THEN la operación falla con un ValidationException indicando que hay líneas de pedido con fechas fuera del nuevo rango.

---

### Requirement 13: Relaciones inversas y extensiones a modelos existentes

**User Story:** Como desarrollador, quiero que los modelos existentes (`Screen`, `ScreenGroup`, `Tenant`, `Content`) tengan las relaciones inversas hacia el nuevo modelo, para poder navegar bidireccionalmente.

#### Acceptance Criteria

1. WHEN se accede a `$screen->orderLineTargets`, THEN retorna la relación `hasMany(OrderLineTarget)`.
2. WHEN se accede a `$screen->impressions`, THEN retorna la relación `hasMany(Impression)`.
3. WHEN se accede a `$screenGroup->orderLineTargets`, THEN retorna la relación `hasMany(OrderLineTarget)`.
4. WHEN se accede a `$tenant->orders`, THEN retorna la relación `hasMany(Order)`.
5. WHEN se accede a `$content->creatives`, THEN retorna la relación `hasMany(Creative)`.
6. WHEN se retira `loop_config`, `sources_config`, y `duration_seconds` del modelo `Screen`, THEN esos campos se eliminan de `$fillable` y de cualquier cast existente.

---

### Requirement 14: Validación XOR en OrderLineTarget

**User Story:** Como desarrollador, quiero que el sistema imponga la restricción XOR (exactamente uno de `screen_id` o `screen_group_id` presente) tanto a nivel BD como a nivel aplicación, para prevenir targets inválidos.

#### Acceptance Criteria

1. WHEN se crea un OrderLineTarget con ambos `screen_id` y `screen_group_id` poblados, THEN la operación falla con ValidationException.
2. WHEN se crea un OrderLineTarget con ambos `screen_id` y `screen_group_id` nulos, THEN la operación falla con ValidationException.
3. WHEN se crea un OrderLineTarget con exactamente uno de los dos campos poblado, THEN la operación se ejecuta exitosamente.
4. La constraint CHECK a nivel BD actúa como segunda línea de defensa si la validación de aplicación es bypaseada (ej. insert directo por SQL).
