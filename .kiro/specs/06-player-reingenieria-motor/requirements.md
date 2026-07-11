# Requirements Document

## Introduction

Este spec cubre el motor de resolución de prioridad del backend y el nuevo contrato de manifiesto que reemplaza al sistema de Loop de slots fijos. Incluye: el algoritmo de asignación diaria (waterfall por prioridad con entrelazado Bresenham), la generación del manifiesto como secuencia concreta pre-resuelta, el endpoint de manifiesto para el player, el reporte de impresiones, y la adaptación del player para consumir el nuevo manifiesto.

El alcance es: servicio del motor de prioridad, generación de manifiesto, endpoints de dispositivo (manifest, impressions), y reemplazo del LoopEngine del player por un ManifestEngine que ejecuta la secuencia recibida. NO incluye: UI de administración de pedidos (spec posterior), time_window (stub, no se implementa), ni reconciliación retroactiva de impresiones.

## Glossary

- **Motor de Prioridad:** Algoritmo backend que resuelve cuántos spots le tocan a cada Línea de pedido por día y genera la secuencia entrelazada.
- **Manifiesto:** Secuencia concreta y ordenada de ítems que el player reproduce en loop. Reemplaza al concepto de "Loop config" de slots fijos.
- **Waterfall:** Modelo de asignación donde Patrocinio se sirve primero, luego Estándar con lo que sobra, y finalmente Red Interna/SSP/Playlist con el remanente.
- **Entrelazado Bresenham:** Algoritmo de distribución proporcional que reparte los turnos de cada línea uniformemente a lo largo del día, evitando bloques consecutivos.
- **Daily Budget:** Número de spots que una Línea de pedido puede consumir en un día, calculado según delivery_pace.
- **Total Daily Spots:** Capacidad total de una pantalla en un día, derivada de la duración estandarizada (grupo > tenant) y la ventana operativa (schedule).
- **SSP Call:** Slot en el manifiesto que instruye al player a hacer una llamada en vivo al SSP de Prodooh para obtener contenido.
- **Prefetch:** Pre-carga del contenido del siguiente ítem mientras el actual se reproduce.

## Requirements

### Requirement 1: Cálculo de capacidad diaria por pantalla (`total_daily_spots`)

**User Story:** Como sistema backend, quiero calcular automáticamente la capacidad total de spots por día de cada pantalla, para que el motor de prioridad sepa cuánta capacidad tiene disponible para distribuir.

#### Acceptance Criteria

1. WHEN se calcula `total_daily_spots` para una pantalla, THEN se usa la fórmula: `ventana_operativa_en_segundos ÷ duración_estandarizada_efectiva`.
2. WHEN se resuelve la duración estandarizada efectiva, THEN se sigue la jerarquía: `screen_groups.duration_seconds` > `tenants.default_duration_seconds` > 10 (default global). El campo `screens.duration_seconds` ya no existe (eliminado en spec 05).
3. WHEN se resuelve la ventana operativa, THEN se sigue la jerarquía existente: `screens.schedule` > `screen_groups.schedule` > `tenants.default_schedule`. IF ningún schedule está configurado (todos null), THEN se asume operación 24/7 (86400 segundos).
4. WHEN el schedule tiene múltiples reglas (ej. distintos horarios por día de la semana), THEN se calcula la ventana operativa del día actual según las reglas que aplican a ese día específico.

---

### Requirement 2: Cálculo de presupuesto diario por Línea de pedido (`daily_budget`)

**User Story:** Como sistema backend, quiero calcular cuántos spots le corresponden a cada Línea de pedido por día, para respetar su `target_spots` y su `delivery_pace`.

#### Acceptance Criteria

1. WHEN `delivery_pace = 'uniform'` AND `target_spots` está definido, THEN `daily_budget = ceil((target_spots - spots_ya_entregados) / remaining_days)`, donde `remaining_days` = días entre hoy y `ends_at` inclusive.
2. WHEN `delivery_pace = 'asap'` AND `target_spots` está definido, THEN `daily_budget = target_spots - spots_ya_entregados` (todo el remanente disponible hoy).
3. WHEN `target_spots` es null (sin límite), THEN la Línea de pedido participa sin presupuesto propio — solo acotada por la capacidad disponible y su `share_weight` relativo a otras líneas del mismo nivel.
4. WHEN una Línea de pedido alcanza `target_spots` (spots entregados >= target_spots), THEN se excluye del conjunto de líneas activas y no participa en la resolución del motor, aunque sus fechas sigan vigentes.
5. WHEN se calcula `spots_ya_entregados`, THEN se cuentan las filas en `impressions` con `order_line_id` = la línea, `result = 'success'`, sin filtro de fecha (acumulado total desde el inicio de la línea).

---

### Requirement 3: Algoritmo de asignación diaria (waterfall por prioridad)

**User Story:** Como sistema backend, quiero distribuir la capacidad diaria de cada pantalla respetando la prioridad (Patrocinio > Estándar > Red Interna), para garantizar que las líneas de mayor prioridad siempre cumplan su cuota.

#### Acceptance Criteria

1. WHEN se ejecuta el waterfall, THEN se procesan los niveles en orden estricto: primero `patrocinio`, luego `estandar`, finalmente `red_interna` + SSP + playlist.
2. WHEN las líneas de un nivel tienen demanda total (`suma de daily_budget`) <= capacidad restante, THEN cada línea recibe exactamente su `daily_budget`, y el sobrante pasa al siguiente nivel.
3. WHEN las líneas de un nivel tienen demanda total > capacidad restante (sobreventa), THEN la capacidad restante se reparte proporcionalmente por `share_weight`: cada línea recibe `capacidad_restante × (share_weight_línea / suma_share_weights_nivel)`.
4. WHEN se procesan las líneas activas de un nivel, THEN solo se incluyen líneas cuyo `order.status = 'active'`, `order_line.status = 'active'`, rango de fechas del order y la línea incluye hoy, target no agotado, y que tengan al menos un creativo con `active_dates` que incluya hoy.
5. WHEN se procesan las líneas activas, THEN solo se incluyen las que aplican a la pantalla evaluada — directamente via `order_line_targets.screen_id` o via `order_line_targets.screen_group_id` = `screens.group_id` de esa pantalla.
6. WHEN se llega al nivel Red Interna, THEN el remanente se reparte entre: (a) Líneas de pedido explícitas con `priority_tier = 'red_interna'` (por `share_weight`), y (b) lo que sobre tras esas líneas se divide 50/50 entre slots SSP y slots playlist.
7. WHEN no hay ninguna Línea de pedido activa en ningún nivel para una pantalla, THEN el manifiesto es 100% playlist local.

---

### Requirement 4: Entrelazado Bresenham (distribución anti-bloque)

**User Story:** Como sistema backend, quiero distribuir los turnos de cada línea uniformemente a lo largo del día, para que ninguna marca se concentre en bloques consecutivos y todas tengan presencia constante.

#### Acceptance Criteria

1. WHEN se genera la secuencia final del manifiesto, THEN se aplica un solo entrelazado global sobre todas las líneas activas de todos los niveles (no bloques separados por prioridad).
2. WHEN se calcula la posición de cada turno de una línea, THEN se usa la fórmula: `posición_objetivo = round(k × (T / count_i))` para k = 0 hasta count_i - 1, donde T = total_daily_spots y count_i = spots asignados a esa línea.
3. WHEN una posición objetivo ya está ocupada, THEN se usa la siguiente posición libre en la secuencia.
4. WHEN una Línea de pedido tiene 40 de 52 spots totales y otra tiene 12 de 52, THEN la primera aparece aproximadamente cada 1.3 turnos y la segunda cada ~4.3 turnos, distribuidas a lo largo de todo el día.

---

### Requirement 5: Selección de creativo por turno (peso + anti-repetición)

**User Story:** Como sistema backend, quiero seleccionar qué creativo específico se reproduce en cada turno de una Línea de pedido, respetando pesos y evitando repeticiones consecutivas.

#### Acceptance Criteria

1. WHEN le toca turno a una Línea de pedido con múltiples creativos activos hoy, THEN se selecciona uno mediante selección aleatoria ponderada por `creatives.weight`.
2. WHEN se selecciona un creativo, THEN no puede repetirse en dos turnos consecutivos de la misma Línea de pedido.
3. WHEN el pool de creativos de una línea tiene más de 5 elementos, THEN un creativo no puede repetirse hasta que hayan pasado al menos `min(pool_size - 1, 5)` turnos distintos de esa misma línea (regla de ventana anti-repetición).
4. WHEN una Línea de pedido tiene un solo creativo activo hoy, THEN ese creativo se usa en todos sus turnos (la regla anti-repetición no aplica con pool de 1).

---

### Requirement 6: Recálculo del manifiesto — disparadores y capacidad restante

**User Story:** Como sistema backend, quiero recalcular el manifiesto de una pantalla automáticamente cuando ocurren cambios relevantes, para que el contenido servido esté siempre actualizado.

#### Acceptance Criteria

1. WHEN ocurre un rollover de medianoche (inicio de nuevo día), THEN se recalcula el manifiesto de todas las pantallas activas usando `total_daily_spots` completo del día.
2. WHEN ocurre un evento disparador intra-día (activación/pausa/edición de una Línea de pedido, cruce de fecha inicio/fin, alcance de target_spots), THEN se recalcula inmediatamente usando `capacidad_restante_hoy = total_daily_spots - impresiones_ya_entregadas_hoy`.
3. WHEN se recalcula intra-día, THEN las impresiones ya entregadas antes del evento no se revierten ni recalculan retroactivamente — solo se redistribuye lo que queda del día.
4. WHEN una línea `uniform` agota su `daily_budget` a media jornada, THEN cede su capacidad restante del día al siguiente nivel disponible. El ajuste definitivo ocurre al día siguiente con el nuevo `daily_budget` recalculado.
5. WHEN se recalcula el manifiesto, THEN se genera una nueva `version` (hash único) y se persiste para que el player la detecte en su siguiente polling.

---

### Requirement 7: Endpoint de manifiesto (`GET /api/device/manifest`)

**User Story:** Como player, quiero obtener mi secuencia de reproducción actual en un formato concreto y pre-resuelto, para ejecutarla sin necesidad de lógica de prioridad local.

#### Acceptance Criteria

1. WHEN el player hace `GET /api/device/manifest` con JWT válido, THEN recibe un JSON con: `version` (string), `generated_at` (ISO datetime), e `items` (array ordenado).
2. WHEN el player envía header `If-None-Match: {version}`, IF la versión no ha cambiado, THEN responde `304 Not Modified`.
3. WHEN hay un manifiesto nuevo, THEN cada ítem contiene: `position` (int), `type` (enum: order_line_creative | prodooh_ssp_call | playlist_item), `duration_seconds` (int), y campos adicionales según el tipo.
4. WHEN `type = 'order_line_creative'`, THEN el ítem incluye: `asset_url`, `checksum_sha256`, `order_line_id`, `creative_id`.
5. WHEN `type = 'prodooh_ssp_call'`, THEN el ítem solo incluye `duration_seconds` (no tiene asset_url — el player resuelve el contenido en vivo).
6. WHEN `type = 'playlist_item'`, THEN el ítem incluye: `asset_url`, `checksum_sha256`, `playlist_item_id`.
7. WHEN se recibe el manifiesto, THEN este endpoint reemplaza completamente a `GET /api/device/playlist` y `GET /api/device/config` (endpoints anteriores se eliminan o devuelven 410 Gone).

---

### Requirement 8: Confirmación de adopción del manifiesto (`POST /api/device/manifest/confirm`)

**User Story:** Como player, quiero confirmar que adopté exitosamente un nuevo manifiesto, para que el backend sepa qué versión estoy ejecutando.

#### Acceptance Criteria

1. WHEN el player descarga y valida todos los assets nuevos del manifiesto, THEN envía `POST /api/device/manifest/confirm` con `{ "version": "abc123" }`.
2. WHEN el backend recibe la confirmación, THEN actualiza el campo `playlist_version` (o equivalente) de la pantalla con la versión confirmada.
3. WHEN la confirmación falla por error de red, THEN el player mantiene el manifiesto nuevo (no hace rollback) y reintenta la confirmación — decisión deliberada ya documentada.

---

### Requirement 9: Endpoint de reporte de impresiones (`POST /api/device/impressions`)

**User Story:** Como player, quiero reportar las impresiones de contenido de pedidos que reproduje exitosamente, para que el backend contabilice entregas contra `target_spots` y alimente los reportes.

#### Acceptance Criteria

1. WHEN el player completa la reproducción de un ítem `type = 'order_line_creative'`, THEN envía un reporte con: `order_line_id`, `creative_id`, `started_at`, `ended_at`, `duration_seconds`, `result` (success/failed), `failure_reason` (nullable).
2. WHEN el backend recibe impresiones, THEN crea filas en la tabla `impressions` con `source = 'order_line'`, vinculando `screen_id` del dispositivo autenticado.
3. WHEN el player no tiene conectividad al momento de reportar, THEN acumula impresiones en cola local y las reenvía con backoff exponencial al recuperar conexión.
4. WHEN el player reenvía impresiones acumuladas, THEN el backend acepta impresiones con cualquier antigüedad — no descarta por timestamp viejo.
5. WHEN se reporta una impresión con `result = 'success'`, THEN cuenta contra el `daily_budget` y `target_spots` de su Línea de pedido.
6. WHEN el player reproduce ítems `type = 'playlist_item'` o `type = 'prodooh_ssp_call'`, THEN NO reporta impresiones al backend (playlist no genera registros; SSP lleva su propio conteo).

---

### Requirement 10: ManifestEngine del player (reemplazo del LoopEngine)

**User Story:** Como player, quiero ejecutar la secuencia del manifiesto recibido en loop continuo, para reproducir exactamente lo que el backend resolvió sin lógica de prioridad local.

#### Acceptance Criteria

1. WHEN el player recibe un manifiesto válido, THEN reproduce los ítems en orden secuencial (position 0, 1, ..., N-1, 0, 1, ...) en loop continuo.
2. WHEN un ítem es `type = 'order_line_creative'`, THEN el player reproduce el asset descargado por la duración especificada y emite el evento de impresión al finalizar.
3. WHEN un ítem es `type = 'playlist_item'`, THEN el player reproduce el asset descargado por la duración especificada sin reportar impresión.
4. WHEN un ítem es `type = 'prodooh_ssp_call'`, THEN el player ejecuta la llamada al SSP de Prodooh (`POST /public/v1/ad`) para obtener contenido, lo reproduce, y si no está listo a tiempo, lo rellena con el siguiente ítem de playlist disponible.
5. WHEN el player está reproduciendo un ítem, THEN hace prefetch del asset del siguiente ítem en la secuencia.
6. WHEN el player recibe un manifiesto actualizado (nueva versión), THEN hace swap atómico: descarga assets nuevos → valida checksums → reemplaza secuencia activa → confirma adopción.
7. WHEN el player pierde conectividad, THEN sigue reproduciendo el último manifiesto válido indefinidamente.

---

### Requirement 11: Prefetch del slot SSP con margen extendido

**User Story:** Como player, quiero iniciar la llamada al SSP con antelación suficiente, para tener el contenido listo cuando le toque su turno sin interrumpir la reproducción.

#### Acceptance Criteria

1. WHEN el siguiente ítem en la secuencia es `type = 'prodooh_ssp_call'`, THEN el player dispara la llamada al SSP al entrar al ítem ANTERIOR (no espera los últimos segundos).
2. WHEN el arte del SSP no está listo cuando le toca su turno, THEN el player rellena con el siguiente ítem de playlist local disponible y el SSP reintenta en su siguiente turno programado.
3. WHEN el player obtuvo un `print_id` del SSP pero el manifiesto cambia antes de reproducirlo, THEN el player llama `expiration` sobre ese `print_id` para que el SSP no lo cuente como entregado.
4. WHEN se confirma la reproducción o expiración de un arte del SSP, THEN el archivo se borra inmediatamente del almacenamiento local (contenido de un solo uso, no participa del LRU).

---

### Requirement 12: Renovación automática de JWT del dispositivo

**User Story:** Como player, quiero renovar automáticamente mi token de autenticación cuando expire, para mantener comunicación ininterrumpida con el backend sin intervención manual.

#### Acceptance Criteria

1. WHEN el player recibe una respuesta `401 Unauthorized` de cualquier endpoint (`manifest`, `impressions`, `heartbeat`), THEN ejecuta automáticamente `POST /api/device/auth` para obtener un JWT nuevo.
2. WHEN la renovación es exitosa, THEN reintenta la petición original que falló con el token nuevo.
3. WHEN la renovación falla, THEN el player reintenta con backoff exponencial sin detener la reproducción del manifiesto vigente.

---

### Requirement 13: Eliminación de endpoints y código obsoleto

**User Story:** Como desarrollador, quiero eliminar los endpoints y controladores del modelo antiguo de Loop, para que no exista ambigüedad entre el sistema viejo y el nuevo.

#### Acceptance Criteria

1. WHEN se despliega el nuevo sistema, THEN se eliminan: `GET /api/device/playlist`, `POST /api/device/playlist/confirm`, `GET /api/device/config`, `PUT /screens/{id}/loop`, `PUT /screens/{id}/sources`.
2. WHEN se eliminan los endpoints, THEN se eliminan también: `LoopConfigController`, `SourceToggleController`, `SourceToggleService`, y cualquier referencia a `loop_config` / `sources_config` en el código backend.
3. WHEN un dispositivo con firmware viejo llama a un endpoint eliminado, THEN recibe `410 Gone` con un mensaje indicando que debe actualizarse.
4. WHEN se elimina el `LoopEngine` del player, THEN se reemplaza por el `ManifestEngine` — no coexisten ambos motores.

---

### Requirement 14: Migración de la columna `source` en `impressions`

**User Story:** Como desarrollador, quiero simplificar el enum `source` en la tabla `impressions` para reflejar que solo `order_line` genera registros en esta fase.

#### Acceptance Criteria

1. WHEN se ejecuta la migración, THEN el enum `source` en `impressions` se reduce a un solo valor: `order_line`.
2. WHEN se diseñe una extensión futura que requiera reportar impresiones de otras fuentes, THEN se ampliará el enum en ese momento — no antes.

