# Requirements Document

## Introduction

Este spec redefine el modelo de asignación de creativos en el sistema Prodooh Player. Actualmente (spec 08), los creativos se asignan directamente a una Línea de pedido (`order_line_id`), y por separado se asignan pantallas/grupos a esa misma línea. El motor de manifiesto decide "mágicamente" qué creativo reproduce cada pantalla — lo cual es confuso e impráctico para campañas con 70+ pantallas de resoluciones distintas.

**Nuevo modelo:** Pedido → Línea de pedido → Pantallas/Grupos → Creativos (por pantalla o por resolución).

Los creativos se asignan **por pantalla** (o por grupo de resolución) dentro de una línea de pedido, no globalmente a la línea. Esto permite dos modos de asignación que coexisten:
1. **Por pantalla específica**: el usuario selecciona pantallas individuales y asigna creativos a cada una.
2. **Por resolución (bulk)**: el sistema agrupa las pantallas de la línea por resolución exacta (ej. "30 pantallas 1920×1080") y el usuario sube un creativo para esa resolución → se asigna automáticamente a todas las pantallas coincidentes.

La resolución se valida por coincidencia exacta de píxeles (sin escalado). La UX debe ser excepcionalmente intuitiva, permitiendo a cualquier usuario nuevo entender el flujo al instante.

## Glossary

- **Sistema_Admin_Backend:** Controladores y rutas del backend Laravel accesibles por `super_admin` y `tenant_admin` para gestionar la asignación de creativos por pantalla.
- **Admin_Frontend:** Aplicación React (admin-frontend) para la gestión administrativa del sistema.
- **Línea_de_Pedido:** Entidad `order_lines` — subdivisión de un Pedido con prioridad, fechas, pantallas objetivo y creativos asignados por pantalla.
- **Creativo:** Entidad `creatives` — contenido asignado a una pantalla específica (o grupo de resolución) dentro de una Línea de pedido, con peso de rotación y fechas activas.
- **OrderLineTarget:** Entidad `order_line_targets` — pivot que vincula una Línea de pedido a pantallas o grupos específicos. Un target es el "contenedor" al que se asignan creativos.
- **Pantalla:** Entidad `screens` — dispositivo físico con resolución definida (`resolution_width` × `resolution_height`).
- **Grupo_de_Resolución:** Agrupación virtual (calculada, no almacenada) de pantallas asignadas a una Línea de pedido que comparten la misma resolución exacta (ancho × alto).
- **Asignación_por_Resolución:** Modo bulk donde un creativo se asigna a un Grupo_de_Resolución y el sistema lo replica automáticamente a todas las pantallas de esa resolución dentro de la línea.
- **Asignación_por_Pantalla:** Modo granular donde un creativo se asigna directamente a una pantalla específica dentro de la línea.
- **Biblioteca:** Repositorio de archivos multimedia (imágenes y videos) del tenant. Corresponde a la tabla `content` en base de datos y la feature "Content" del frontend. En la interfaz se muestra como "Biblioteca". Los archivos de la Biblioteca son reutilizables: un mismo archivo puede ser asignado como creativo a múltiples pantallas y líneas de pedido.
- **Motor_de_Manifiesto:** Servicio `ManifestGenerator` que genera la secuencia de reproducción para cada pantalla, ahora resolviendo creativos por pantalla en lugar de por línea.
- **Player:** Aplicación Node.js TypeScript en Raspberry Pi que reproduce el manifiesto.
- **Resolución_Exacta:** Validación de que la resolución del contenido (asset) coincide píxel a píxel con la resolución de la pantalla destino, sin escalado ni deformación.
- **Upload_Directo:** Flujo donde el administrador sube un archivo nuevo directamente desde el contexto de asignación de creativos (sin pasar primero por la Biblioteca). El archivo se almacena en la Biblioteca y se asigna como creativo en un solo paso.

## Requirements

### Requirement 1: Reestructuración del modelo de datos — Creativos vinculados a Target/Pantalla

**User Story:** Como administrador, quiero que los creativos se vinculen a pantallas específicas (a través de targets) en lugar de directamente a la línea de pedido, para controlar con precisión qué contenido se reproduce en cada dispositivo.

#### Acceptance Criteria

1. THE Sistema_Admin_Backend SHALL almacenar cada Creativo con una referencia a `order_line_target_id` (pantalla específica dentro de la línea) en lugar de `order_line_id` directamente.
2. WHEN se crea un Creativo, THE Sistema_Admin_Backend SHALL requerir un `order_line_target_id` válido que pertenezca a la misma Línea de pedido del contexto.
3. THE Sistema_Admin_Backend SHALL mantener `order_line_id` como campo derivable (a través de la relación `target.order_line_id`) para consultas optimizadas y compatibilidad.
4. WHEN un OrderLineTarget se elimina, THE Sistema_Admin_Backend SHALL eliminar en cascada los Creativos asociados a ese target.
5. THE Sistema_Admin_Backend SHALL aplicar una migración que transforme los registros existentes en `creatives` (vinculados a `order_line_id`) a la nueva estructura vinculada a `order_line_target_id`, distribuyendo los creativos existentes a todos los targets de su línea original.
6. WHEN se consulta la lista de creativos de una línea de pedido, THE Sistema_Admin_Backend SHALL retornar los creativos agrupados por target (pantalla) con la información de resolución de cada pantalla incluida.

---

### Requirement 2: Validación de resolución exacta para asignación de creativos

**User Story:** Como administrador, quiero que el sistema valide que el contenido asignado a una pantalla tenga la misma resolución exacta que la pantalla destino, para evitar distorsiones o recortes en la reproducción.

#### Acceptance Criteria

1. WHEN se asigna un Creativo a un target que referencia una pantalla individual, THE Sistema_Admin_Backend SHALL validar que la resolución del contenido (Content.width × Content.height) coincida exactamente con la resolución de la pantalla (Screen.resolution_width × Screen.resolution_height).
2. IF la resolución del contenido no coincide exactamente con la de la pantalla destino, THEN THE Sistema_Admin_Backend SHALL rechazar la asignación con error 422 indicando las resoluciones incompatibles (ej. "El contenido es 1080×1920 pero la pantalla requiere 1920×1080").
3. WHEN se asigna un Creativo mediante Asignación_por_Resolución a un Grupo_de_Resolución, THE Sistema_Admin_Backend SHALL validar que la resolución del contenido coincida exactamente con la resolución del grupo seleccionado.
4. THE Sistema_Admin_Backend SHALL almacenar las dimensiones del contenido (width, height) en la tabla `content` al momento del upload si no existen ya, extrayéndolas del archivo multimedia.
5. IF el contenido no tiene dimensiones registradas (contenido legacy sin metadata), THEN THE Sistema_Admin_Backend SHALL rechazar la asignación con error 422 indicando que el contenido requiere re-procesamiento para extraer sus dimensiones.

---

### Requirement 3: Asignación de creativos por resolución (modo bulk) — Desde Biblioteca

**User Story:** Como administrador, quiero seleccionar contenido existente de la Biblioteca y asignarlo automáticamente a todas las pantallas de una resolución específica dentro de la línea de pedido, para gestionar campañas con decenas de pantallas de forma eficiente reutilizando archivos ya subidos.

#### Acceptance Criteria

1. WHEN el administrador solicita la asignación por resolución proporcionando un `content_id` (existente en Biblioteca), un `resolution_width`, un `resolution_height`, y los datos del creativo (weight, active_dates), THE Sistema_Admin_Backend SHALL crear un registro de Creativo para cada OrderLineTarget de la línea cuya pantalla tenga esa resolución exacta.
2. WHEN se ejecuta la Asignación_por_Resolución, THE Sistema_Admin_Backend SHALL retornar la cantidad de pantallas afectadas y la lista de creativos creados.
3. IF no existen pantallas asignadas a la línea con la resolución indicada, THEN THE Sistema_Admin_Backend SHALL rechazar con error 422 indicando que no hay pantallas con esa resolución en la línea.
4. THE Sistema_Admin_Backend SHALL validar que la resolución del contenido coincide con la resolución solicitada antes de replicar la asignación (aplicando la misma Resolución_Exacta de Requirement 2).
5. WHEN nuevas pantallas con la resolución coincidente se agregan a la línea (nuevo target), THE Sistema_Admin_Backend SHALL notificar al usuario que existen creativos por resolución que podrían aplicarse a los nuevos targets, sin auto-asignar.

---

### Requirement 4: CRUD de Creativos — Nuevo endpoint por target

**User Story:** Como administrador, quiero gestionar creativos por pantalla específica a través de la API, para asignar, editar y eliminar contenido a nivel de target individual.

#### Acceptance Criteria

1. WHEN un administrador envía `GET /api/admin/order-line-targets/{target_id}/creatives`, THE Sistema_Admin_Backend SHALL retornar los Creativos asignados a ese target con la relación `content` incluida.
2. WHEN un administrador envía `POST /api/admin/order-line-targets/{target_id}/creatives` con datos válidos (content_id, weight, active_dates), THE Sistema_Admin_Backend SHALL crear el Creativo vinculado al target y retornar el recurso creado con código 201.
3. WHEN un administrador envía `PUT /api/admin/creatives/{id}` con datos válidos, THE Sistema_Admin_Backend SHALL actualizar el Creativo y retornar el recurso actualizado.
4. WHEN un administrador envía `DELETE /api/admin/creatives/{id}`, THE Sistema_Admin_Backend SHALL eliminar el Creativo.
5. THE Sistema_Admin_Backend SHALL validar que `content_id` referencia un contenido existente del mismo tenant.
6. THE Sistema_Admin_Backend SHALL validar que `weight` es un entero positivo mayor o igual a 1.
7. THE Sistema_Admin_Backend SHALL validar que `active_dates` es un array de strings ISO date (YYYY-MM-DD) dentro del rango de la Línea de pedido padre.
8. WHEN se crea o actualiza un Creativo, THE Sistema_Admin_Backend SHALL disparar el job ManifestRecalculation para la pantalla del target afectado.

---

### Requirement 5: Endpoint de asignación bulk por resolución

**User Story:** Como administrador, quiero un endpoint dedicado para asignar un creativo a todas las pantallas de una resolución específica dentro de una línea de pedido, para ejecutar asignaciones masivas con una sola llamada.

#### Acceptance Criteria

1. WHEN un administrador envía `POST /api/admin/order-lines/{order_line_id}/creatives/bulk-by-resolution` con `{ content_id, resolution_width, resolution_height, weight, active_dates }`, THE Sistema_Admin_Backend SHALL crear un Creativo para cada target de la línea cuya pantalla coincida en resolución exacta.
2. THE Sistema_Admin_Backend SHALL retornar con código 201 un objeto con `{ creatives_created: number, affected_screens: string[] }`.
3. IF no se encuentran targets con pantallas de la resolución indicada, THEN THE Sistema_Admin_Backend SHALL retornar error 422 con mensaje "No hay pantallas con resolución {W}×{H} asignadas a esta línea de pedido".
4. THE Sistema_Admin_Backend SHALL ejecutar la validación de Resolución_Exacta (content vs resolución solicitada) antes de crear los registros.
5. THE Sistema_Admin_Backend SHALL disparar el job ManifestRecalculation para todas las pantallas afectadas tras la creación bulk.
6. THE Sistema_Admin_Backend SHALL ejecutar la creación en una transacción de base de datos: si algún creativo falla la validación, no se crea ninguno.

---

### Requirement 6: Endpoint de resoluciones disponibles por línea de pedido

**User Story:** Como administrador, quiero consultar qué resoluciones tienen las pantallas asignadas a una línea de pedido y cuántas pantallas hay de cada resolución, para saber qué creativos necesito subir.

#### Acceptance Criteria

1. WHEN un administrador envía `GET /api/admin/order-lines/{order_line_id}/resolutions`, THE Sistema_Admin_Backend SHALL retornar un array de objetos `{ resolution_width, resolution_height, screen_count, screens: [{id, name}], has_creative: boolean }` agrupando las pantallas asignadas a la línea por resolución exacta.
2. THE Sistema_Admin_Backend SHALL calcular `has_creative` como true si al menos una pantalla del grupo de resolución tiene al menos un creativo asignado.
3. THE Sistema_Admin_Backend SHALL resolver pantallas tanto de targets directos (screen_id) como indirectos (via screen_group_id del grupo).
4. THE Sistema_Admin_Backend SHALL ordenar los resultados por `screen_count` descendente (la resolución con más pantallas primero).

---

### Requirement 7: Vista de creativos agrupados por resolución — Admin Frontend

**User Story:** Como administrador, quiero ver en el detalle de una línea de pedido las pantallas agrupadas por resolución con sus creativos asignados, para gestionar fácilmente campañas con múltiples formatos.

#### Acceptance Criteria

1. WHEN el administrador navega al detalle de una línea de pedido (`/orders/:id/lines/:lineId`), THE Admin_Frontend SHALL mostrar las pantallas agrupadas por resolución en tarjetas visuales (ej. "1920×1080 — 30 pantallas").
2. WHEN una tarjeta de resolución tiene creativos asignados, THE Admin_Frontend SHALL mostrar thumbnails de los creativos dentro de la tarjeta con indicadores de peso y fechas activas.
3. WHEN una tarjeta de resolución no tiene creativos asignados, THE Admin_Frontend SHALL mostrar un estado vacío con un call-to-action "Agregar creativo" destacado visualmente.
4. WHEN el administrador hace clic en "Agregar creativo" de una tarjeta de resolución, THE Admin_Frontend SHALL ofrecer dos opciones: "Seleccionar de Biblioteca" (contenido existente filtrado por resolución) y "Subir nuevo archivo" (Upload_Directo con asignación inmediata).
5. WHEN el administrador desea asignar creativos diferentes a pantallas individuales dentro de un grupo de resolución, THE Admin_Frontend SHALL permitir expandir la tarjeta para ver la lista de pantallas y asignar creativos a cada una por separado.
6. THE Admin_Frontend SHALL mostrar el flujo visual de izquierda a derecha: pantallas (agrupadas) → creativos asignados → acciones.
7. THE Admin_Frontend SHALL usar TanStack Query para obtener los datos del endpoint de resoluciones (`GET /api/admin/order-lines/{id}/resolutions`) y los creativos por target.

---

### Requirement 8: Filtrado de contenido por resolución en el selector de Biblioteca — Admin Frontend

**User Story:** Como administrador, quiero que al seleccionar contenido de la Biblioteca para asignar como creativo, el selector solo muestre archivos con la resolución compatible, para evitar errores y agilizar la selección.

#### Acceptance Criteria

1. WHEN el administrador abre el selector "Seleccionar de Biblioteca" para asignar un creativo a un Grupo_de_Resolución, THE Admin_Frontend SHALL filtrar la Biblioteca mostrando solo archivos cuya resolución coincida exactamente con la del grupo.
2. WHEN el administrador abre el selector "Seleccionar de Biblioteca" para asignar un creativo a una pantalla individual, THE Admin_Frontend SHALL filtrar la Biblioteca mostrando solo archivos cuya resolución coincida exactamente con la de la pantalla.
3. WHEN no existen contenidos con la resolución requerida en la Biblioteca, THE Admin_Frontend SHALL mostrar un mensaje "No hay archivos con resolución {W}×{H} en la Biblioteca" con dos acciones: "Subir nuevo archivo" (Upload_Directo) y "Ir a Biblioteca" (enlace a la sección de upload general).
4. THE Admin_Frontend SHALL mostrar la resolución del filtro activo de forma visible (badge o etiqueta) para que el usuario entienda por qué ve un subconjunto de la Biblioteca.
5. THE Admin_Frontend SHALL enviar el filtro de resolución como query parameters al endpoint de contenido: `GET /api/admin/content?width={W}&height={H}`.

---

### Requirement 9: Asignación individual de creativo a pantalla específica — Admin Frontend

**User Story:** Como administrador, quiero poder asignar un creativo diferente a una pantalla específica dentro de una línea de pedido, para manejar casos donde una pantalla necesita contenido personalizado distinto al del grupo de resolución.

#### Acceptance Criteria

1. WHEN el administrador expande una tarjeta de grupo de resolución, THE Admin_Frontend SHALL mostrar la lista de pantallas individuales con sus creativos asignados (o estado vacío).
2. WHEN el administrador hace clic en "Agregar creativo" para una pantalla individual, THE Admin_Frontend SHALL abrir el selector de contenido filtrado por la resolución de esa pantalla y al confirmar enviar `POST /api/admin/order-line-targets/{target_id}/creatives`.
3. WHEN el administrador elimina un creativo de una pantalla individual, THE Admin_Frontend SHALL mostrar diálogo de confirmación y enviar `DELETE /api/admin/creatives/{id}`.
4. THE Admin_Frontend SHALL diferenciar visualmente los creativos asignados por resolución (bulk) de los asignados individualmente, usando un indicador como "Asignado por resolución" vs "Asignado individualmente".
5. THE Admin_Frontend SHALL permitir al administrador editar el peso y las fechas activas de un creativo individual sin afectar los creativos de otras pantallas del mismo grupo.

---

### Requirement 10: Motor de manifiesto actualizado — Resolución de creativos por pantalla

**User Story:** Como sistema, quiero que el motor de manifiesto resuelva los creativos a nivel de pantalla específica (no de línea de pedido), para que cada pantalla reproduzca exclusivamente el contenido asignado a ella.

#### Acceptance Criteria

1. WHEN el Motor_de_Manifiesto genera el manifiesto para una pantalla, THE Motor_de_Manifiesto SHALL obtener los creativos consultando `creatives` filtrados por los `order_line_target_id` que referencian esa pantalla específica (directamente o via grupo).
2. WHEN una pantalla tiene múltiples creativos asignados (de una o más líneas), THE Motor_de_Manifiesto SHALL seleccionar el creativo usando el sistema de pesos existente (`weight`) aplicando anti-repetición solo dentro del pool de creativos de cada línea/target.
3. IF una pantalla no tiene creativos asignados para una línea de pedido activa que la incluye como target, THEN THE Motor_de_Manifiesto SHALL omitir esa línea de pedido del manifiesto de la pantalla (no asignar spots sin creativo).
4. THE Motor_de_Manifiesto SHALL filtrar los creativos por `active_dates` para la fecha actual: solo creativos cuyas `active_dates` incluyan la fecha de hoy participan en la selección.
5. WHEN se despacha el job ManifestRecalculation para una pantalla, THE Motor_de_Manifiesto SHALL recalcular usando exclusivamente los creativos vinculados a los targets de esa pantalla.

---

### Requirement 11: Migración de datos existentes

**User Story:** Como sistema, quiero migrar los creativos existentes (vinculados a `order_line_id`) al nuevo modelo (vinculados a `order_line_target_id`), para que los datos actuales sigan funcionando sin pérdida de información.

#### Acceptance Criteria

1. WHEN se ejecuta la migración, THE Sistema_Admin_Backend SHALL crear una columna `order_line_target_id` (nullable inicialmente) en la tabla `creatives` y mantener `order_line_id` temporalmente.
2. WHEN se ejecuta el data migration script, THE Sistema_Admin_Backend SHALL para cada creativo existente con `order_line_id` sin `order_line_target_id`, duplicar el creativo para cada target de esa línea de pedido (una copia por target/pantalla).
3. WHEN la migración completa el procesamiento de todos los registros legacy, THE Sistema_Admin_Backend SHALL marcar `order_line_id` como deprecated (mantenerlo como columna nullable para rollback seguro durante 30 días).
4. IF una línea de pedido no tiene targets asignados al momento de la migración, THEN THE Sistema_Admin_Backend SHALL mantener los creativos vinculados al `order_line_id` original sin modificación hasta que se asignen targets.
5. THE Sistema_Admin_Backend SHALL ejecutar la migración de forma idempotente: ejecutarla múltiples veces no duplica creativos ya migrados.
6. THE Sistema_Admin_Backend SHALL registrar un log de migración con: creativos procesados, creativos duplicados creados, errores encontrados.

---

### Requirement 12: Filtrado de contenido por resolución — Backend

**User Story:** Como administrador, quiero buscar contenido de la librería por resolución exacta, para encontrar rápidamente archivos compatibles con mis pantallas al asignar creativos.

#### Acceptance Criteria

1. WHEN un administrador envía `GET /api/admin/content` con query parameters `width` y `height`, THE Sistema_Admin_Backend SHALL retornar solo los contenidos cuya resolución (width × height) coincida exactamente con los valores proporcionados.
2. WHEN no se proporcionan filtros de resolución, THE Sistema_Admin_Backend SHALL retornar todos los contenidos del tenant (comportamiento actual sin cambios).
3. THE Sistema_Admin_Backend SHALL indexar las columnas `width` y `height` de la tabla `content` para optimizar las consultas con filtro de resolución.
4. IF el contenido no tiene dimensiones registradas (legacy), THEN THE Sistema_Admin_Backend SHALL excluirlo de resultados filtrados por resolución (solo aparece en listados sin filtro).

---

### Requirement 13: Calendario de fechas activas por creativo-target

**User Story:** Como administrador, quiero configurar las fechas activas de un creativo de forma independiente para cada pantalla, para tener control granular de cuándo se reproduce cada contenido en cada dispositivo.

#### Acceptance Criteria

1. WHEN el administrador asigna un creativo via Asignación_por_Resolución, THE Admin_Frontend SHALL aplicar las mismas `active_dates` a todos los creativos creados en el bulk.
2. WHEN el administrador edita las `active_dates` de un creativo individual, THE Admin_Frontend SHALL actualizar solo ese creativo sin afectar creativos del mismo contenido en otras pantallas.
3. THE Admin_Frontend SHALL mostrar un componente calendario que permita selección de rangos, multi-rangos y días individuales dentro del período de la Línea de pedido.
4. WHEN el administrador selecciona fechas fuera del rango de la Línea de pedido, THE Admin_Frontend SHALL deshabilitar esas fechas en el calendario y mostrar visualmente los límites del rango permitido.
5. THE Sistema_Admin_Backend SHALL validar que todas las `active_dates` estén contenidas en el rango [Línea_de_Pedido.starts_at, Línea_de_Pedido.ends_at].

---

### Requirement 14: Player — Resolución de creativos por pantalla en el manifiesto

**User Story:** Como Player, quiero recibir en el manifiesto solo los creativos asignados específicamente a mi pantalla, para reproducir exclusivamente el contenido correcto sin necesidad de lógica de filtrado local.

#### Acceptance Criteria

1. WHEN el Player solicita su manifiesto via heartbeat, THE Sistema_Admin_Backend SHALL retornar un manifiesto cuyos items de tipo `order_line_creative` contengan solo creativos asignados a targets que referencian la pantalla específica del Player.
2. THE Player SHALL reproducir los items del manifiesto en el orden y duración indicados sin realizar validación de resolución local (la validación ocurre al asignar, no al reproducir).
3. WHEN el manifiesto no contiene items de tipo `order_line_creative` (ninguna línea con creativos asignados a esta pantalla), THE Player SHALL reproducir los items de tipo `playlist_item` y `prodooh_ssp_call` disponibles.
4. THE Motor_de_Manifiesto SHALL incluir en cada item `order_line_creative` del manifiesto los campos: `asset_url`, `checksum_sha256`, `duration_seconds`, `order_line_id`, `creative_id`, y el nuevo campo `target_id` para trazabilidad.

---

### Requirement 15: Extracción y almacenamiento de dimensiones de contenido

**User Story:** Como sistema, quiero extraer y almacenar las dimensiones (width × height) de cada contenido al momento del upload, para poder validar la compatibilidad de resolución al asignar creativos.

#### Acceptance Criteria

1. WHEN se sube un nuevo contenido via `POST /api/admin/content`, THE Sistema_Admin_Backend SHALL extraer las dimensiones del archivo multimedia (imagen o video) y almacenarlas en los campos `width` y `height` de la tabla `content`.
2. WHEN el archivo es una imagen (JPEG, PNG, WebP), THE Sistema_Admin_Backend SHALL extraer las dimensiones usando la librería de procesamiento de imágenes disponible en PHP (GD o Intervention Image).
3. WHEN el archivo es un video (MP4, WebM), THE Sistema_Admin_Backend SHALL extraer las dimensiones usando FFProbe o equivalente disponible en el servidor.
4. IF la extracción de dimensiones falla, THEN THE Sistema_Admin_Backend SHALL almacenar `width: null, height: null` y permitir el upload (no bloquear), registrando un warning en el log.
5. THE Sistema_Admin_Backend SHALL proporcionar un comando artisan `content:extract-dimensions` para re-procesar contenido legacy que no tenga dimensiones registradas.
6. WHEN se ejecuta el comando de extracción en contenido existente, THE Sistema_Admin_Backend SHALL procesar solo registros con `width IS NULL` y registrar el progreso (procesados/fallidos/total).

---

### Requirement 16: Dashboard de resoluciones y cobertura de creativos — Admin Frontend

**User Story:** Como administrador, quiero ver un dashboard visual con las resoluciones de las pantallas asignadas a la línea de pedido, su distribución porcentual y el estado de cobertura de creativos, para entender la composición de mi campaña de un vistazo y saber qué formatos necesito preparar.

#### Acceptance Criteria

1. WHEN el administrador navega al detalle de una línea de pedido, THE Admin_Frontend SHALL mostrar un panel tipo dashboard en la parte superior con la distribución de resoluciones: cada resolución como una tarjeta o barra con el formato "{W}×{H}", la cantidad de pantallas, y el porcentaje que representa sobre el total de pantallas de la línea.
2. THE Admin_Frontend SHALL representar la distribución de resoluciones visualmente usando un gráfico (barras horizontales o donut chart) donde cada segmento represente una resolución con su porcentaje proporcional y color diferenciado.
3. WHEN todas las pantallas de un grupo de resolución tienen al menos un creativo asignado, THE Admin_Frontend SHALL mostrar un indicador de estado "Completo" (ícono check verde) en la tarjeta de esa resolución.
4. WHEN alguna pantalla de un grupo de resolución no tiene creativos asignados, THE Admin_Frontend SHALL mostrar un indicador de estado "Incompleto" (ícono warning amarillo) con el conteo: "{N} de {Total} pantallas con creativo".
5. THE Admin_Frontend SHALL mostrar un resumen global de cobertura encima del dashboard: "Cobertura total: {X}/{Y} pantallas con creativo asignado ({Z}%)" con barra de progreso visual.
6. WHEN el administrador hace clic en una tarjeta de resolución del dashboard, THE Admin_Frontend SHALL hacer scroll suave hasta la sección de esa resolución con sus creativos y pantallas expandidas.
7. THE Admin_Frontend SHALL calcular el porcentaje por resolución como: (pantallas de esa resolución / total pantallas de la línea) × 100, redondeado a un decimal.

---

### Requirement 17: Upload directo con asignación inmediata (bulk por resolución)

**User Story:** Como administrador, quiero subir un archivo nuevo directamente desde la vista de creativos de una línea de pedido y que se asigne automáticamente a todas las pantallas de la resolución correspondiente, para no tener que ir a la Biblioteca y luego volver a asignar.

#### Acceptance Criteria

1. WHEN el administrador hace clic en "Subir nuevo archivo" desde una tarjeta de resolución, THE Admin_Frontend SHALL abrir un diálogo de upload que acepte archivos de imagen (JPEG, PNG, WebP) y video (MP4, WebM).
2. WHEN el administrador sube un archivo, THE Admin_Frontend SHALL enviar `POST /api/admin/content` para almacenar el archivo en la Biblioteca y, al recibir respuesta exitosa con el `content_id` creado, ejecutar inmediatamente `POST /api/admin/order-lines/{id}/creatives/bulk-by-resolution` con ese `content_id` y la resolución del grupo.
3. IF la resolución del archivo subido no coincide con la resolución del grupo desde el que se inició el upload, THEN THE Admin_Frontend SHALL mostrar un error indicando la incompatibilidad de resolución y NO crear el creativo (el archivo queda en Biblioteca para uso futuro).
4. WHEN el upload y la asignación se completan exitosamente, THE Admin_Frontend SHALL cerrar el diálogo y actualizar la tarjeta de resolución mostrando el nuevo creativo asignado a todas las pantallas del grupo.
5. THE Admin_Frontend SHALL mostrar una barra de progreso durante el upload y un indicador de estado durante la asignación bulk, diferenciando las dos etapas: "Subiendo archivo..." → "Asignando a {N} pantallas...".
6. WHEN el administrador inicia un Upload_Directo desde una pantalla individual (no de tarjeta de resolución), THE Admin_Frontend SHALL subir a Biblioteca y asignar solo a esa pantalla específica via `POST /api/admin/order-line-targets/{target_id}/creatives`.

---

### Requirement 18: Renombrar "Contenido" a "Biblioteca" en la interfaz

**User Story:** Como usuario del admin-frontend, quiero ver el término "Biblioteca" en la interfaz en lugar de "Contenido", para reflejar que es un repositorio reutilizable de archivos multimedia y no solo un listado de archivos.

#### Acceptance Criteria

1. WHEN el admin-frontend renderiza el menú de navegación, THE Admin_Frontend SHALL mostrar "Biblioteca" en lugar de "Contenido" como label del enlace de la sección de archivos multimedia.
2. WHEN el administrador navega a la sección de archivos multimedia, THE Admin_Frontend SHALL mostrar el título "Biblioteca" y la ruta SHALL cambiar de `/content` a `/biblioteca`.
3. WHEN el selector de contenido se abre desde el flujo de asignación de creativos, THE Admin_Frontend SHALL mostrar el título "Seleccionar de Biblioteca" con el filtro de resolución activo.
4. THE Admin_Frontend SHALL mantener internamente los nombres de modelos, endpoints API (`/admin/content`), hooks y variables sin cambios — solo cambia lo visible en la interfaz y la ruta de navegación.
5. THE Admin_Frontend SHALL actualizar los textos de empty states y mensajes de error para usar "Biblioteca" en lugar de "contenido" o "librería de contenido".
