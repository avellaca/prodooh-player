# Requirements Document

## Introduction

Este feature implementa un conjunto de capacidades de gestión publicitaria avanzada para la plataforma Prodooh Hybrid Ad Player. Incluye: división de inventario por slots/anunciantes, nuevo rol "trafficker", cálculo dinámico de fechas de órdenes, alertas de disponibilidad de inventario, modo "por Slot" para líneas de patrocinio, herencia de configuración de slots, auditoría de cambios, configuración de red, e integración de caché SSP en el player.

## Glossary

- **Sistema**: La plataforma Prodooh Hybrid Ad Player en su conjunto (backend + frontend + player)
- **Panel_Admin**: La interfaz web de administración (React/TypeScript)
- **Motor_Prioridad**: El servicio PriorityEngine que calcula la distribución de spots por pantalla
- **Player**: El cliente TypeScript que ejecuta contenido en Chromium kiosk (Raspberry Pi 5)
- **Tenant**: Entidad de red/media owner, nivel superior de la jerarquía multi-tenant
- **ScreenGroup**: Agrupación de pantallas dentro de un Tenant
- **Screen**: Pantalla individual que pertenece a un ScreenGroup y un Tenant
- **Order**: Orden publicitaria que agrupa líneas de orden para un anunciante
- **OrderLine**: Línea de orden con prioridad, ritmo de entrega y spots objetivo
- **Slot**: Fracción del inventario diario de una pantalla, definida como total_daily_spots / num_slots
- **num_slots**: Valor de configuración que divide el inventario diario en partes iguales (no es entidad de BD)
- **Anunciante**: Identificado por el campo `advertiser_name` en Order (no requiere entidad propia)
- **Trafficker**: Nuevo rol de usuario con permisos limitados de gestión de órdenes y creativos
- **Audit_Log**: Registro de auditoría que almacena cambios históricos sobre entidades
- **StorageManager**: Componente del Player que gestiona el almacenamiento local con política LRU
- **SSP**: Supply-Side Platform, servicio externo que provee anuncios programáticos
- **ProDoohSource**: Componente del Player que integra con la API SSP

## Requirements

### Requirement 1: Configuración de Slots por Inventario

**User Story:** Como tenant_admin, quiero configurar el número de slots que dividen el inventario diario de mis pantallas, para poder planificar la capacidad publicitaria por anunciante.

#### Acceptance Criteria

1. THE Tenant SHALL tener un campo `num_slots` de tipo entero con valor por defecto de 10 y rango válido de 1 a 100
2. THE ScreenGroup SHALL poder definir un campo `num_slots` (nullable, entero, rango 1–100) que sobreescriba el valor heredado del Tenant
3. THE Screen SHALL poder definir un campo `num_slots` (nullable, entero, rango 1–100) que sobreescriba el valor heredado del ScreenGroup
4. WHEN el Sistema calcula la capacidad de un slot para una pantalla, THE Sistema SHALL calcular floor(total_daily_spots / num_slots efectivo) como la cantidad de spots por slot
5. WHEN un Tenant tiene num_slots como null, THE Sistema SHALL utilizar el valor por defecto hardcoded de 10
6. WHEN un ScreenGroup tiene num_slots como null, THE Sistema SHALL heredar el valor del Tenant al que pertenece
7. WHEN una Screen tiene num_slots como null, THE Sistema SHALL heredar el valor del ScreenGroup al que pertenece (y transitivamente del Tenant si el grupo tampoco lo define)
8. IF un usuario intenta configurar num_slots con un valor fuera del rango 1–100 o no entero, THEN THE Sistema SHALL rechazar la operación y retornar un error de validación

---

### Requirement 2: Propagación "Aplicar a Todos" para num_slots

**User Story:** Como tenant_admin, quiero poder propagar el valor de num_slots a niveles inferiores con una confirmación clara, para facilitar la configuración masiva sin perder control.

#### Acceptance Criteria

1. WHEN el tenant_admin ejecuta "Aplicar a Todos" desde el nivel Tenant, THE Panel_Admin SHALL sobreescribir el num_slots de todos los ScreenGroups y Screens del Tenant con el valor de num_slots actualmente configurado en ese Tenant
2. WHEN el tenant_admin ejecuta "Aplicar a Todos" desde el nivel ScreenGroup, THE Panel_Admin SHALL sobreescribir el num_slots de todas las Screens de ese grupo con el valor de num_slots actualmente configurado en ese ScreenGroup
3. WHEN existen 1 o más entidades con num_slots explícitamente configurado en niveles inferiores al ejecutar "Aplicar a Todos", THE Panel_Admin SHALL mostrar un diálogo de confirmación que indique la cantidad de entidades con overrides que serán sobreescritas
4. WHEN el admin confirma el diálogo de propagación, THE Sistema SHALL aplicar la sobreescritura de forma atómica a todas las entidades afectadas, de modo que o todas se actualizan o ninguna se modifica
5. WHEN el admin cancela el diálogo, THE Sistema SHALL mantener los valores actuales de num_slots en todas las entidades sin modificación
6. IF la propagación falla por error del sistema después de la confirmación, THEN THE Panel_Admin SHALL mostrar un mensaje de error indicando que la operación no se completó y que los valores no fueron modificados
7. IF no existen ScreenGroups en el Tenant o no existen Screens en el ScreenGroup al ejecutar "Aplicar a Todos", THEN THE Panel_Admin SHALL mostrar un mensaje informativo indicando que no hay entidades inferiores a las cuales propagar
8. IF no existen overrides en niveles inferiores al ejecutar "Aplicar a Todos", THEN THE Sistema SHALL ejecutar la propagación directamente sin mostrar el diálogo de confirmación

---

### Requirement 3: Impacto de Cambio de num_slots en Líneas Activas

**User Story:** Como tenant_admin, quiero recibir una alerta al cambiar num_slots si hay líneas activas afectadas, para evitar conflictos involuntarios.

#### Acceptance Criteria

1. WHEN el admin modifica num_slots en cualquier nivel (Tenant, ScreenGroup o Screen) y existen OrderLines con status "active" que apuntan a pantallas cuyo num_slots efectivo cambia por la modificación, THE Panel_Admin SHALL mostrar una alerta no-bloqueante que liste la cantidad de OrderLines activas afectadas e informe que el cambio solo aplica a nuevas activaciones
2. WHEN el admin modifica num_slots y no existen OrderLines con status "active" que apunten a pantallas afectadas por el cambio, THE Panel_Admin SHALL aplicar la modificación sin mostrar alerta
3. WHEN una OrderLine cambia su status de "draft" a "active" después de una modificación de num_slots, THE Motor_Prioridad SHALL calcular sus target_spots utilizando el valor de num_slots efectivo vigente al momento de la activación
4. THE Motor_Prioridad SHALL mantener los target_spots almacenados de OrderLines que ya tenían status "active" al momento del cambio de num_slots, sin recalcularlos
5. IF una OrderLine con status "paused" cambia a status "active" después de una modificación de num_slots, THEN THE Motor_Prioridad SHALL conservar los target_spots originales calculados en su primera activación sin recalcular con el nuevo num_slots

---

### Requirement 4: Inventario No Utilizado por Slot

**User Story:** Como operador, quiero que los slots sin órdenes activas se destinen a Playlist/SSP en lugar de redistribuirse, para mantener la disponibilidad para futuros anunciantes.

#### Acceptance Criteria

1. WHEN un slot no tiene OrderLines activas que lo consuman, THE Motor_Prioridad SHALL asignar el 100% de la capacidad de ese slot (total_daily_spots / num_slots) al pool de Playlist/SSP
2. WHEN existen OrderLines activas en otros slots de la misma pantalla pero un slot permanece sin consumir, THE Motor_Prioridad SHALL mantener las asignaciones de los otros slots sin incremento, sin redistribuir la capacidad del slot vacío a otros anunciantes
3. WHEN la capacidad no utilizada se asigna al pool de Playlist/SSP, THE Motor_Prioridad SHALL dividir el remanente asignando floor(remanente / 2) spots a SSP y el resto a Playlist
4. WHEN una nueva OrderLine se activa y apunta a una pantalla con slots previamente vacíos, THE Motor_Prioridad SHALL recalcular la asignación de esa pantalla en el siguiente ciclo de recálculo, desplazando spots de Playlist/SSP para servir la nueva línea según su priority_tier y daily_budget
5. IF una OrderLine activa no consume la totalidad de la capacidad de su slot asignado, THEN THE Motor_Prioridad SHALL asignar la capacidad sobrante de ese slot al pool de Playlist/SSP sin redistribuirla a OrderLines de otros anunciantes

---

### Requirement 5: Orden de Prioridad y Entrega (Waterfall)

**User Story:** Como operador de tráfico, quiero que el motor de prioridad respete un orden estricto de tiers con reglas de inserción ASAP, para garantizar la entrega correcta según la prioridad comercial.

#### Acceptance Criteria

1. THE Motor_Prioridad SHALL procesar los tiers en este orden estricto: patrocinio → estandar → red_interna → SSP/Playlist, asignando capacidad al siguiente nivel solo con el remanente no consumido por el nivel anterior
2. THE Motor_Prioridad SHALL procesar todas las líneas de patrocinio antes que cualquier línea de otro tier, independientemente de su delivery_pace, y sin aplicar reglas de entrelazado ASAP/uniform dentro de este tier
3. WHEN el total de creativos activos (creativos con active_dates que incluyen hoy, sumados entre todas las OrderLines activas del tier estandar para la pantalla evaluada) es menor o igual a 10, THE Motor_Prioridad SHALL insertar 1 spot de línea ASAP cada 2 spots de líneas uniform dentro de la subsequencia del tier estandar, resultando en un patrón repetitivo de ratio 1:2 (ASAP:uniform)
4. WHEN el total de creativos activos (creativos con active_dates que incluyen hoy, sumados entre todas las OrderLines activas del tier estandar para la pantalla evaluada) es mayor a 10, THE Motor_Prioridad SHALL insertar 1 spot de línea ASAP cada 3 spots de líneas uniform dentro de la subsequencia del tier estandar, resultando en un patrón repetitivo de ratio 1:3 (ASAP:uniform)
5. WHILE se distribuyen spots ASAP dentro del tier estandar, IF existen múltiples OrderLines con delivery_pace "asap", THEN THE Motor_Prioridad SHALL repartir los slots ASAP entre ellas proporcionalmente por share_weight, aplicando el mismo entrelazado Bresenham usado en el resto del sistema
6. IF no existen líneas con delivery_pace "asap" en el tier estandar, THEN THE Motor_Prioridad SHALL distribuir todos los spots del tier estandar usando solo líneas uniform con entrelazado Bresenham estándar, sin aplicar ratio de inserción ASAP
7. IF todas las líneas activas del tier estandar tienen delivery_pace "asap" (no existen líneas uniform), THEN THE Motor_Prioridad SHALL distribuir todos los spots del tier estandar entre las líneas ASAP por share_weight con entrelazado Bresenham, sin aplicar ratio de inserción respecto a uniform

---

### Requirement 6: Modo "Por Slot" para Líneas de Patrocinio

**User Story:** Como tenant_admin, quiero activar un toggle "por Slot" en líneas de patrocinio para que el sistema calcule automáticamente los spots objetivo como un slot completo, simplificando la contratación.

#### Acceptance Criteria

1. WHEN una OrderLine tiene priority_tier "patrocinio", THE Panel_Admin SHALL mostrar un toggle "por Slot" en el formulario de la línea
2. WHEN el toggle "por Slot" está activado, THE Sistema SHALL calcular target_spots como floor(total_daily_spots / num_slots efectivo) para cada pantalla objetivo
3. WHEN el toggle "por Slot" está activado y la OrderLine apunta a múltiples pantallas con diferente num_slots efectivo, THE Sistema SHALL calcular y almacenar un target_spots independiente por cada pantalla objetivo
4. WHEN el toggle "por Slot" está desactivado, THE Panel_Admin SHALL permitir al usuario ingresar target_spots manualmente con un valor mínimo de 1 y máximo igual a total_daily_spots de la pantalla objetivo
5. WHEN el usuario guarda la OrderLine con el toggle "por Slot" activado, THE Sistema SHALL fijar el valor de target_spots calculado en ese momento sin recalcular ante cambios posteriores en total_daily_spots o num_slots
6. WHEN el usuario desactiva el toggle "por Slot" en una OrderLine que previamente lo tenía activado, THE Panel_Admin SHALL limpiar el valor de target_spots calculado y mostrar el campo de entrada manual vacío
7. WHEN una OrderLine tiene priority_tier diferente de "patrocinio", THE Panel_Admin SHALL ocultar el toggle "por Slot"
8. WHEN el toggle "por Slot" está activado, THE Panel_Admin SHALL mostrar el valor calculado de target_spots como campo de solo lectura visible para el usuario antes de guardar

---

### Requirement 7: Cálculo Dinámico de Fechas de Order

**User Story:** Como usuario del sistema, quiero que las fechas de una Order se calculen automáticamente desde sus líneas de orden, para eliminar la entrada manual redundante.

#### Acceptance Criteria

1. WHEN el Sistema recibe una solicitud GET de una Order que tiene al menos una OrderLine, THE Sistema SHALL retornar starts_at calculado como el valor mínimo de starts_at entre todas sus OrderLines, y ends_at calculado como el valor máximo de ends_at entre todas sus OrderLines
2. WHEN una Order no tiene OrderLines asociadas, THE Sistema SHALL retornar starts_at y ends_at como null en la respuesta de la API
3. WHEN una Order no tiene OrderLines asociadas, THE Panel_Admin SHALL no mostrar rango de fechas en la vista de detalle ni en el listado de Orders
4. THE Sistema SHALL eliminar las columnas starts_at y ends_at de la tabla orders en base de datos mediante una migración
5. THE Panel_Admin SHALL eliminar los campos starts_at y ends_at del formulario de creación y edición de Orders, de modo que el formulario solo contenga nombre, anunciante y estado
6. WHEN una Order tiene OrderLines asociadas, THE Panel_Admin SHALL mostrar las fechas calculadas (starts_at y ends_at) como campos de solo lectura en formato dd-MM-yyyy en la vista de detalle y en el listado de Orders
7. WHEN se crea, actualiza o elimina una OrderLine, THE Sistema SHALL recalcular las fechas de la Order padre en la siguiente consulta GET, reflejando el nuevo mínimo de starts_at y máximo de ends_at de las OrderLines restantes
8. THE Panel_Admin SHALL eliminar la restricción de que las fechas de una OrderLine deban estar contenidas dentro de las fechas de la Order padre, dado que la Order ya no posee fechas propias

---

### Requirement 8: Alerta de Disponibilidad de Inventario al Activar

**User Story:** Como tenant_admin, quiero ver un análisis de disponibilidad de inventario al activar una OrderLine, para tomar decisiones informadas sobre posibles conflictos de capacidad.

#### Acceptance Criteria

1. WHEN un usuario activa una OrderLine, THE Sistema SHALL calcular para cada pantalla objetivo y cada día del rango active_dates si la suma de target_spots diarios de OrderLines activas existentes más los target_spots diarios de la OrderLine que se activa excede el total_daily_spots de esa pantalla
2. WHEN el análisis detecta al menos una pantalla con al menos un día donde la demanda comprometida excede el total_daily_spots, THE Panel_Admin SHALL mostrar un modal informativo con el detalle del análisis de disponibilidad antes de proceder con la activación
3. WHEN el análisis no detecta conflicto de capacidad en ninguna pantalla ni día, THE Sistema SHALL proceder directamente con la activación sin mostrar el modal
4. THE Panel_Admin SHALL mostrar en el modal de disponibilidad: la lista de pantallas con conflicto, y para cada una el total_daily_spots, los spots ya comprometidos por otras OrderLines activas, los spots solicitados por la OrderLine que se activa, y el déficit resultante
5. THE Panel_Admin SHALL incluir un botón "Estoy de acuerdo" en el modal que cierra el diálogo y procede con la activación sin bloquearla
6. THE Panel_Admin SHALL incluir un botón "Modificar" en el modal que retorna al formulario de edición de la OrderLine sin activarla y sin cambiar su status
7. THE Sistema SHALL considerar como inventario comprometido únicamente los target_spots de OrderLines con status "active" que compartan al menos una pantalla objetivo y al menos un día en común dentro de sus active_dates
8. THE Sistema SHALL excluir la capacidad reservada para SSP y Playlist del cálculo de disponibilidad, tratando el total_daily_spots completo como disponible para OrderLines
9. THE Sistema SHALL ejecutar el cálculo de disponibilidad únicamente al momento de activación, sin recalculación posterior ni actualización en tiempo real

---

### Requirement 9: Rol Trafficker

**User Story:** Como tenant_admin, quiero crear usuarios con rol trafficker que puedan gestionar órdenes y creativos sin acceso a configuración ni activación, para delegar tareas operativas de forma segura.

#### Acceptance Criteria

1. THE Sistema SHALL soportar un rol "trafficker" adicional a los existentes "super_admin" y "tenant_admin", asociado obligatoriamente a un tenant_id válido
2. WHEN un usuario con rol trafficker crea, edita o elimina una Order o una OrderLine dentro de su propio tenant, THE Sistema SHALL ejecutar la operación y persistir los cambios
3. WHEN un usuario con rol trafficker sube un creativo o asigna un creativo a un target/resolución dentro de su propio tenant, THE Sistema SHALL ejecutar la operación y persistir los cambios
4. IF un usuario con rol trafficker intenta cambiar el status de una Order u OrderLine a "active" o a "paused", THEN THE Sistema SHALL rechazar la operación con un error HTTP 403 indicando permisos insuficientes y no modificar el status
5. IF un usuario con rol trafficker intenta acceder a la configuración de red (campos num_slots, schedule, duration, cache_flush_interval_hours) mediante API o interfaz, THEN THE Sistema SHALL rechazar la solicitud con un error HTTP 403 indicando permisos insuficientes
6. IF un usuario con rol trafficker intenta crear, editar o eliminar cualquier usuario, THEN THE Sistema SHALL rechazar la operación con un error HTTP 403 indicando permisos insuficientes
7. IF un usuario con rol trafficker intenta acceder a una Order, OrderLine o creativo que pertenece a un tenant diferente al suyo, THEN THE Sistema SHALL rechazar la solicitud con un error HTTP 403
8. WHILE un usuario con rol trafficker tiene sesión activa, THE Panel_Admin SHALL mostrar únicamente las secciones de Pedidos, Contenidos y gestión de creativos, ocultando secciones de Configuración de Red, Pantallas, Grupos y gestión de usuarios en la navegación
9. IF un usuario con rol trafficker intenta acceder por URL directa a una ruta restringida, THEN THE Panel_Admin SHALL redirigir al usuario a la vista de Pedidos (/orders) y mostrar un mensaje de acceso denegado

---

### Requirement 10: Gestión de Usuarios e Invitaciones

**User Story:** Como tenant_admin, quiero invitar nuevos usuarios mediante email y gestionar sus cuentas, para controlar el acceso a mi red de forma autónoma.

#### Acceptance Criteria

1. WHEN un tenant_admin ingresa un email válido y confirma la creación de usuario, THE Sistema SHALL enviar un email de invitación a la dirección proporcionada mediante la API de Resend conteniendo un enlace único con token de activación
2. WHEN el Sistema genera una invitación, THE Sistema SHALL crear un token de invitación con expiración de 48 horas asociado al email y tenant del usuario invitado
3. WHEN el usuario invitado accede al enlace de invitación con un token válido y no expirado, THE Panel_Admin SHALL mostrar un formulario para establecer contraseña que requiera mínimo 8 caracteres
4. WHEN el usuario establece una contraseña que cumple los requisitos mínimos, THE Sistema SHALL almacenarla hasheada con bcrypt, activar la cuenta y redirigir al usuario a la página de login
5. IF el token de invitación ha expirado o ya fue utilizado, THEN THE Sistema SHALL mostrar un mensaje de error indicando que el enlace no es válido y no permitir establecer contraseña
6. IF el email proporcionado ya está registrado en el mismo tenant, THEN THE Sistema SHALL rechazar la creación y mostrar un mensaje de error indicando que el usuario ya existe
7. IF el envío del email de invitación falla en la API de Resend, THEN THE Sistema SHALL mostrar un mensaje de error al admin indicando que la invitación no pudo enviarse y no crear el registro de usuario
8. WHEN un tenant_admin elimina un usuario, THE Sistema SHALL desactivar la cuenta del usuario seleccionado, siempre que el usuario no sea el mismo admin que ejecuta la acción
9. WHEN un admin solicita reseteo de contraseña para un usuario, THE Sistema SHALL enviar un email mediante la API de Resend con un enlace que contiene un token de reseteo con expiración de 1 hora
10. WHEN un super_admin accede a gestión de usuarios, THE Panel_Admin SHALL mostrar usuarios de todos los tenants con indicación del tenant al que pertenece cada usuario
11. WHEN un tenant_admin accede a gestión de usuarios, THE Panel_Admin SHALL mostrar únicamente usuarios pertenecientes a su propio tenant
12. THE Panel_Admin SHALL incluir un enlace "¿Olvidaste tu contraseña?" en la página de login que, al ser activado, solicite el email del usuario y envíe un email de reseteo con token de expiración de 1 hora mediante la API de Resend

---

### Requirement 11: Registro de Auditoría (Bitácora)

**User Story:** Como tenant_admin, quiero ver un historial cronológico de todos los cambios realizados en Orders y OrderLines, para mantener trazabilidad y control sobre las modificaciones.

#### Acceptance Criteria

1. WHEN se crea, modifica cualquier campo o cambia el status de una Order, THE Sistema SHALL registrar un evento en la tabla audit_logs con campos auditable_type, auditable_id (relación polimórfica), user_id, event_type, diff, y timestamp del evento
2. WHEN se crea, modifica cualquier campo o cambia el status de una OrderLine, THE Sistema SHALL registrar un evento en la tabla audit_logs con campos auditable_type, auditable_id (relación polimórfica), user_id, event_type, diff, y timestamp del evento
3. THE Audit_Log SHALL clasificar cada evento con uno de los siguientes valores de event_type: "created", "field_modified", "status_changed", "creative_added", "creative_removed", "spots_modified", "name_changed", "target_added", "target_removed"
4. THE Audit_Log SHALL almacenar en el campo diff un objeto JSON con las claves "old" y "new", donde cada una contiene únicamente los campos que cambiaron con sus valores anteriores y posteriores respectivamente
5. WHEN el evento es de tipo "created", THE Sistema SHALL registrar el campo diff con "old" como null y "new" con todos los valores iniciales de la entidad
6. WHEN un usuario modifica múltiples campos de una entidad en una misma operación de guardado, THE Sistema SHALL registrar un único evento de tipo "field_modified" con todos los campos modificados incluidos en el diff
7. THE Panel_Admin SHALL mostrar un botón con ícono de reloj con flecha circular en la vista de detalle de Order y OrderLine que abre un modal con el historial de auditoría ordenado del más reciente al más antiguo, mostrando un máximo de 50 entradas con scroll para cargar entradas anteriores
8. THE Panel_Admin SHALL mostrar en cada entrada del historial: el nombre completo del usuario autor, la fecha y hora del evento, el tipo de evento, y los valores anteriores y nuevos de los campos modificados
9. THE Panel_Admin SHALL mostrar un badge de color pastel junto a cada entrada del historial según la categoría de la acción: verde para creación y adiciones (created, creative_added, target_added), amarillo para modificaciones (field_modified, status_changed, spots_modified, name_changed), y rojo para eliminaciones (creative_removed, target_removed)
10. IF el usuario autor de un evento ha sido eliminado del sistema, THEN THE Panel_Admin SHALL mostrar el texto "Usuario eliminado" en lugar del nombre en la entrada de auditoría correspondiente

---

### Requirement 12: Configuración de Red (Tenant Settings)

**User Story:** Como tenant_admin, quiero configurar parámetros globales de mi red incluyendo el intervalo de flush de caché, para controlar el comportamiento de los players remotos.

#### Acceptance Criteria

1. THE Tenant SHALL tener un campo configurable `cache_flush_interval_hours` de tipo entero con un rango válido de 1 a 720 (horas) y un valor por defecto de 24 cuando no ha sido configurado explícitamente
2. WHEN un player solicita su configuración (heartbeat), THE Sistema SHALL incluir el campo `cache_flush_interval_hours` con su valor numérico actual del Tenant dentro del objeto de respuesta del heartbeat
3. THE Panel_Admin SHALL incluir el campo `cache_flush_interval_hours` en la sección de configuración de red del Tenant, mostrando el valor actual y permitiendo su edición únicamente a usuarios con rol tenant_admin o superior
4. IF un tenant_admin ingresa un valor de `cache_flush_interval_hours` fuera del rango 1–720 o no entero, THEN THE Sistema SHALL rechazar la actualización y retornar un mensaje de error indicando el rango válido permitido
5. IF el campo `cache_flush_interval_hours` no ha sido configurado para un Tenant, THEN THE Sistema SHALL utilizar el valor por defecto de 24 horas en la respuesta de heartbeat al player

---

### Requirement 13: Caché de Creativos SSP en el Player

**User Story:** Como operador, quiero que el player cachee localmente los archivos multimedia recibidos del SSP, para reducir el consumo de ancho de banda y mejorar la velocidad de reproducción.

#### Acceptance Criteria

1. WHEN el SSP retorna una respuesta exitosa con una URL de medio, THE Player SHALL descargar el archivo completo y almacenarlo en caché local antes de reproducirlo, con un timeout máximo de 30 segundos para la descarga
2. THE Player SHALL usar la URL completa (string exacto incluyendo query parameters) como clave de caché para identificar archivos almacenados
3. WHEN la misma URL (comparación string-exact) aparece en una respuesta SSP posterior y el archivo existe en caché local, THE Player SHALL usar el archivo cacheado sin realizar una nueva descarga
4. WHEN se reproduce un archivo cacheado obtenido de una respuesta SSP posterior, THE Player SHALL utilizar el print_id de la respuesta más reciente para el reporte de Proof of Play, descartando el print_id de la respuesta original que generó el cacheo
5. THE Player SHALL registrar los archivos SSP cacheados en el CachedFileProvider del StorageManager existente, de modo que participen en la misma política LRU que el resto de archivos cacheados del player
6. IF el espacio libre en disco es menor al 20% del total, THEN THE Player SHALL ejecutar limpieza de caché mediante LRU (eliminando primero los archivos con lastAccessed más antiguo), respetando la protección de archivos activos en playlist y fallback buffer
7. IF la descarga del archivo falla (error de red, timeout de 30 segundos, o respuesta HTTP no exitosa), THEN THE Player SHALL reproducir directamente desde la URL remota sin almacenar en caché, y registrar el fallo para reintento en el próximo ciclo
8. WHEN el tiempo transcurrido desde la última limpieza de caché supera el valor de cache_flush_interval_hours configurado en el Tenant, THE Player SHALL ejecutar una limpieza LRU independientemente del porcentaje de espacio libre en disco
9. IF un archivo cacheado no se encuentra en disco al momento de reproducción (archivo eliminado externamente o corrupto), THEN THE Player SHALL descargar nuevamente el archivo desde la URL original y actualizar la entrada en caché

---

### Requirement 14: Permisos de Acceso por Rol

**User Story:** Como super_admin, quiero que cada rol tenga permisos claramente delimitados, para garantizar la seguridad y segregación de acceso en la plataforma.

#### Acceptance Criteria

1. THE Sistema SHALL otorgar al super_admin acceso de lectura, creación, edición, eliminación y activación sobre todos los recursos (Orders, OrderLines, creativos, usuarios, configuración de red) en todos los tenants sin restricción de tenant
2. THE Sistema SHALL otorgar al tenant_admin acceso de lectura, creación, edición, eliminación y activación sobre todos los recursos (Orders, OrderLines, creativos, usuarios, configuración de red) exclusivamente dentro de su propio tenant
3. THE Sistema SHALL restringir al trafficker a operaciones de lectura, creación, edición y eliminación de Orders, OrderLines y creativos exclusivamente dentro de su propio tenant, sin acceso a activación de órdenes, configuración de red ni gestión de usuarios
4. WHEN un usuario con rol trafficker intenta realizar una operación de activación (cambio de status a "active"), acceder a configuración de red (num_slots, schedule, duration, cache_flush_interval_hours), o gestionar usuarios (crear, editar, eliminar usuarios), THE Sistema SHALL retornar un error HTTP 403 con un mensaje indicando permiso insuficiente
5. WHEN un usuario con rol tenant_admin intenta acceder a recursos pertenecientes a un tenant distinto al suyo, THE Sistema SHALL retornar un error HTTP 403 con un mensaje indicando permiso insuficiente
6. WHEN un usuario con rol trafficker intenta acceder a recursos pertenecientes a un tenant distinto al suyo, THE Sistema SHALL retornar un error HTTP 403 con un mensaje indicando permiso insuficiente
7. THE Sistema SHALL validar permisos de rol en cada solicitud al backend antes de ejecutar la operación, independientemente de la visibilidad de elementos en el Panel_Admin
