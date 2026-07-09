# 01 — Modelo de Datos

## Entidades nuevas

### `orders` (Pedido)

| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK (cascade delete) | El Pedido pertenece a un Network/tenant. |
| name | string | Nombre comercial del pedido (ej. "Coca-Cola Julio 2026"). |
| advertiser_name | string nullable | Anunciante, dato administrativo. |
| starts_at | date | Fecha de inicio general del pedido. |
| ends_at | date | Fecha de fin general del pedido. |
| status | enum(`draft`, `active`, `paused`, `finished`) default `draft` | Un pedido `finished` no participa en el motor de prioridad aunque sus fechas no hayan vencido — permite cierre manual anticipado. |
| created_at, updated_at | timestamps | |

Constraint: `ends_at >= starts_at`.

### `order_lines` (Línea de pedido)

| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| order_id | uuid FK (cascade delete) | |
| name | string | Ej. "Tótems Premium", "Espectaculares fin de semana". |
| priority_tier | enum(`patrocinio`, `estandar`, `red_interna`) | Sin sub-niveles en esta fase. |
| starts_at | date | Debe estar dentro de `[order.starts_at, order.ends_at]`. |
| ends_at | date | Debe estar dentro de `[order.starts_at, order.ends_at]`. |
| target_spots | integer nullable | Meta de spots a entregar en el rango de fechas. Null = sin límite (se muestra mientras esté activa y gane su turno de prioridad). |
| delivery_pace | enum(`asap`, `uniform`) default `uniform` | Determina el ritmo de entrega diario de esta línea — ver algoritmo completo en documento 02. |
| share_weight | integer default 100 | Peso relativo de esta línea frente a otras del **mismo `priority_tier`** que compitan por la misma pantalla en el mismo período. Funciona igual que `creatives.weight`, un nivel arriba. |
| time_window | jsonb nullable | **Stub de arquitectura para uso futuro, no implementado en esta fase.** Reservado para restringir una Línea de pedido a una franja horaria específica dentro del día (ej. ligada a un evento como un partido de fútbol). Null = sin restricción, corre en todo el horario operativo. Ver nota de alcance en documento 02 — el motor de prioridad de esta fase ignora este campo por completo aunque venga poblado; no debe exponerse en la UI de administración todavía. |
| status | enum(`draft`, `active`, `paused`, `finished`) default `draft` | |
| created_at, updated_at | timestamps | |

Constraint: `ends_at >= starts_at`. Validación a nivel aplicación (no DB): el rango debe estar contenido en el rango del `order` padre.

### `order_line_targets` (pivot: a qué pantallas o grupos aplica una Línea de pedido)

| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| order_line_id | uuid FK (cascade delete) | |
| screen_id | uuid FK nullable (cascade delete) | Uno de los dos siguientes es obligatorio, no ambos. |
| screen_group_id | uuid FK nullable (cascade delete) | |
| created_at | timestamp | |

Constraint: exactamente uno de `screen_id` / `screen_group_id` debe estar presente (XOR), nunca ambos ni ninguno.

### `creatives` (Creativo — dentro de una Línea de pedido)

| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| order_line_id | uuid FK (cascade delete) | |
| content_id | uuid FK (referencia a `content`, tabla ya existente) | Reutiliza la librería de contenido ya construida (imágenes/videos). |
| weight | integer default 100 | Peso relativo de rotación entre creativos de la misma línea (ej. 90 vs 10 = 90%/10%). |
| active_dates | jsonb | **Conjunto explícito de fechas** (array de fechas ISO), no un patrón de recurrencia. Ej: `["2026-07-11", "2026-07-12", "2026-07-18", "2026-07-19"]` para "solo fines de semana de julio". |
| created_at, updated_at | timestamps | |

Validación a nivel aplicación: cada fecha en `active_dates` debe estar contenida en `[order_line.starts_at, order_line.ends_at]`.

### `impressions` (registro de reproducciones — reemplaza/extiende `playback_logs`)

Esta tabla resuelve la corrección D1 (registro de reproducciones no conectado) integrándola directamente al nuevo modelo, en vez de mantenerla desacoplada como hoy.

| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| screen_id | uuid FK (cascade delete) | |
| creative_id | uuid FK nullable (set null on delete) | Null cuando la impresión proviene de una fuente sin creativo propio (ej. el SSP de Prodooh, cuyo contenido se resuelve en vivo — ver 03). |
| order_line_id | uuid FK nullable (set null on delete) | Denormalizado desde `creative` para reportes rápidos sin join; null en el mismo caso que `creative_id`. |
| source | enum(`order_line`, `playlist`, `prodooh_ssp`) | Reemplaza el enum anterior (`prodooh`,`gam`,`url`,`playlist`) — GAM y URL quedan fuera de esta fase. |
| started_at | timestamp | |
| ended_at | timestamp nullable | |
| duration_seconds | decimal(10,2) nullable | |
| result | enum(`success`, `failed`) | |
| failure_reason | string nullable | |
| synced_at | timestamp nullable | Null mientras está pendiente de confirmación desde el player (ver corrección D1 en documento 04). |
| created_at | timestamp | |

## Cambios a entidades existentes

### `screens` — se retiran campos obsoletos del Loop

| Campo | Acción |
|---|---|
| `loop_config` | **Eliminar.** Reemplazado por la resolución dinámica del motor de prioridad (documento 02) — ya no es config estática por pantalla. |
| `sources_config` | **Eliminar.** El concepto de "fuente habilitada/deshabilitada por slot" desaparece; ahora la prioridad determina qué se muestra, no un toggle de fuente por slot. |
| `duration_seconds` (override individual) | **Eliminar.** Ver decisión en documento 00: la duración se estandariza como máximo a nivel Network o Grupo, no por pantalla. |
| Resto de campos (`venue_id`, `device_token_hash`, `group_id`, `orientation`, `resolution_*`, `schedule`, `playlist_version`, `last_heartbeat`, etc.) | Sin cambios. |

### `screen_groups` — sin cambios de estructura, se confirma su rol

Se confirma que `duration_seconds` a nivel `screen_groups` (y a nivel `tenants` como default) son los **únicos** dos niveles válidos de configuración de duración — ya existían, no se agrega nada nuevo aquí, solo se retira la posibilidad de override a nivel pantalla individual (arriba).

### `playlists` / `playlist_items` — sin cambios

La playlist local sigue siendo el mecanismo de fallback de último nivel ("Red interna" cuando no hay Línea de pedido activa ni respuesta del SSP). No se modifica su estructura.

## Relación con el modelo de prioridad (adelanto, se detalla en 02)

En cualquier instante, para una pantalla dada, el motor de prioridad debe poder resolver: qué Líneas de pedido activas (por fecha, por `target_spots` no agotado, por asignación a esa pantalla o su grupo) existen en cada nivel de prioridad, y de ahí derivar el orden de entrega. Este modelo de datos es la base sobre la que esa resolución opera — el documento 02 define el algoritmo, no el esquema.

## Impacto en la auditoría — mapeo directo a discrepancias

| Discrepancia de la auditoría | Cómo la resuelve este modelo |
|---|---|
| D1 (registro no conectado) | La tabla `impressions` reemplaza `playback_logs` con vínculo directo a `creative_id`/`order_line_id`; se conecta al nuevo motor de ejecución desde el inicio, no como parche posterior. |
| D7 (tipo `PlaylistItem.type` inconsistente `content` vs `image/video/url`) | Se aprovecha esta reingeniería para unificar: `creatives.content_id` apunta siempre a la tabla `content` ya validada: sin ambigüedad de tipos duplicados. |