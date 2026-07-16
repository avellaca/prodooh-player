# Requirements Document

## Introduction

Este documento define los requisitos para la migración del sistema ProDooh desde un manifiesto plano (5.760 posiciones pre-calculadas por día) hacia un modelo de **Loop Template** estándar de la industria DOOH. En este modelo, un loop es un ciclo de duración fija (e.g., 10 slots × 10 segundos = 100 segundos) que se repite a lo largo del día. El backend genera la plantilla del loop; el player la reproduce de forma autónoma y rotando creativos localmente. El sistema incluye además gestión de órdenes, roles de usuario, auditoría y sincronización player-backend.

## Glossary

- **Loop**: Ciclo de reproducción de duración fija que se repite durante la ventana operativa de una pantalla. Contiene un número fijo de slots.
- **Loop_Template**: Estructura de datos generada por el backend que define la composición de un loop: qué contenido va en cada slot y las reglas de rotación entre iteraciones.
- **Slot**: Posición individual dentro de un loop. Cada slot tiene una duración fija (slot_duration_seconds) y puede contener uno o varios candidatos.
- **num_slots**: Número total de slots que componen un loop. Configurable por Tenant, heredable a ScreenGroup y Screen.
- **ad_slots**: Slots reservados para líneas de orden publicitarias. Calculado como: num_slots - ssp_slots - playlist_slots.
- **ssp_slots**: Slots reservados para proveedores SSP (programmatic). Configurables por Tenant.
- **playlist_slots**: Slots reservados para contenido propio del operador (playlists). Configurables por Tenant.
- **slot_duration_seconds**: Duración de cada slot en segundos. Campo existente como duration_seconds en la jerarquía ScreenGroup/Tenant.
- **loops_per_day**: Número de iteraciones del loop en un día operativo. Calculado como: ventana_operativa_segundos / (num_slots × slot_duration_seconds).
- **Candidato**: Creativo asignado a un slot. Un slot puede tener múltiples candidatos con estrategia de rotación round-robin entre iteraciones del loop.
- **Priority_Engine**: Servicio del backend que ejecuta la jerarquía de prioridades para asignar líneas de orden a ad_slots.
- **Patrocinio**: Tier de prioridad máxima. Ocupa slots garantizados en cada iteración del loop.
- **Estandar**: Tier de prioridad intermedia. Puede configurarse como ASAP o Uniform.
- **Red_Interna**: Tier de prioridad mínima. Rellena ad_slots no utilizados. Siempre uniforme.
- **ASAP**: Ritmo de entrega acelerado. La línea aparece con mayor frecuencia en la rotación entre iteraciones.
- **Uniform**: Ritmo de entrega uniforme. La línea se distribuye equitativamente según share_weight.
- **Round_Robin**: Estrategia de rotación donde candidatos de un slot compartido se alternan entre iteraciones del loop.
- **sync_interval_seconds**: Intervalo en segundos entre consultas del player al backend para detectar cambios en la versión del Loop_Template.
- **Tenant**: Organización operadora de red. Nivel superior de la jerarquía de configuración.
- **ScreenGroup**: Agrupación de pantallas dentro de un Tenant. Nivel intermedio de herencia.
- **Screen**: Pantalla individual. Nivel más bajo de la jerarquía.
- **Sistema**: El conjunto backend + frontend + player del sistema ProDooh.
- **Backend**: Servicio API Laravel que genera Loop_Templates y gestiona la lógica de negocio.
- **Player**: Aplicación cliente que reproduce contenido en las pantallas físicas.
- **Frontend**: Panel de administración web (React/TypeScript).
- **Trafficker**: Rol de usuario con permisos limitados a gestión de órdenes sin capacidad de activación ni configuración.
- **Audit_Log**: Registro polimórfico de todos los cambios realizados sobre entidades del sistema.

## Requirements

### Requisito 1: Configuración de Loop (num_slots, ssp_slots, playlist_slots)

**User Story:** Como tenant_admin, quiero configurar la estructura del loop de mis pantallas (número de slots totales, reservados para SSP y para playlist), para que la distribución del inventario refleje mi modelo de negocio.

#### Criterios de Aceptación

1. THE Backend SHALL almacenar num_slots como entero con valor por defecto 10 y rango permitido de 1 a 100 en la configuración de Tenant.
2. THE Backend SHALL almacenar ssp_slots como entero con valor por defecto 2 y rango de 0 a num_slots en la configuración de Tenant.
3. THE Backend SHALL almacenar playlist_slots como entero con valor por defecto 1 y rango de 0 a num_slots en la configuración de Tenant.
4. THE Backend SHALL calcular ad_slots como: num_slots - ssp_slots - playlist_slots.
5. IF ssp_slots + playlist_slots es mayor o igual a num_slots, THEN THE Backend SHALL rechazar la configuración con un error de validación indicando que debe quedar al menos 1 ad_slot.
6. WHEN un Screen no tiene num_slots configurado, THE Backend SHALL heredar num_slots del ScreenGroup padre; si el ScreenGroup tampoco lo tiene, THE Backend SHALL heredar del Tenant.
7. WHEN un tenant_admin modifica num_slots en el Tenant y selecciona "Aplicar a todos", THE Frontend SHALL mostrar un modal de confirmación indicando cuántos ScreenGroups y Screens se verán afectados.
8. WHEN el usuario confirma "Aplicar a todos", THE Backend SHALL propagar num_slots a todos los ScreenGroups y Screens del Tenant que no tengan un override explícito.
9. THE Backend SHALL rechazar con HTTP 403 las solicitudes de configuración de num_slots, ssp_slots o playlist_slots de usuarios que no sean tenant_admin o super_admin.
10. THE Frontend SHALL usar el campo existente duration_seconds (slot_duration_seconds) sin crear un campo nuevo para la duración del slot.

### Requisito 2: Generación de Loop Template (Priority Engine v3)

**User Story:** Como operador de red, quiero que el backend genere automáticamente un Loop Template optimizado para cada pantalla, para que el player reproduzca contenido según las prioridades contratadas sin necesitar un manifiesto plano de 5.760 posiciones.

#### Criterios de Aceptación

1. THE Priority_Engine SHALL generar un Loop_Template por cada Screen activa (con al menos un schedule vigente y estado operativo), conteniendo exactamente num_slots posiciones (donde num_slots se resuelve por herencia: Screen → ScreenGroup → Tenant → 10).
2. THE Priority_Engine SHALL asignar ad_slots siguiendo la jerarquía estricta: Patrocinio > Estandar ASAP > Estandar Uniform > Red_Interna, procesando cada tier en orden y consumiendo slots disponibles antes de pasar al siguiente.
3. WHEN una línea de Patrocinio tiene configurado slots_purchased = N, THE Priority_Engine SHALL asignar N posiciones fijas garantizadas dentro de cada Loop_Template de las pantallas objetivo, de modo que esas posiciones se reproduzcan en TODAS las iteraciones del loop sin rotación.
4. IF la suma de slots_purchased de todas las líneas de Patrocinio activas para una pantalla excede los ad_slots disponibles, THEN THE Priority_Engine SHALL rechazar la activación de la última línea que causa el exceso y generar un error indicando la cantidad de ad_slots insuficientes.
5. WHEN hay más líneas activas del mismo tier que ad_slots restantes disponibles para ese tier, THE Priority_Engine SHALL asignar múltiples candidatos al mismo slot con estrategia Round_Robin entre iteraciones del loop, registrando el orden de rotación en la lista de candidatos del slot.
6. WHEN existen líneas Estandar con pace ASAP y líneas con pace Uniform activas simultáneamente para una pantalla, y la suma de creativos activos (con active_dates incluyendo hoy) es de 10 o menos, THE Priority_Engine SHALL programar la rotación de líneas ASAP con ratio 1 aparición ASAP cada 2 Uniform entre iteraciones sucesivas.
7. WHEN existen líneas Estandar con pace ASAP y líneas con pace Uniform activas simultáneamente para una pantalla, y la suma de creativos activos es mayor que 10, THE Priority_Engine SHALL programar la rotación con ratio 1 aparición ASAP cada 3 Uniform entre iteraciones sucesivas.
8. THE Priority_Engine SHALL asignar posiciones fijas dentro del loop para ssp_slots y playlist_slots en índices separados de los ad_slots, de manera que los tipos de slot ocupen rangos definidos y predecibles.
9. WHEN todos los ad_slots están asignados a líneas de Patrocinio y Estandar, THE Priority_Engine SHALL excluir líneas de Red_Interna del Loop_Template.
10. WHEN quedan ad_slots sin asignar después de Patrocinio y Estandar, THE Priority_Engine SHALL rellenar los slots restantes con líneas de Red_Interna distribuyendo proporcionalmente al share_weight de cada línea.
11. WHEN una línea se activa, desactiva, cambia de creativos o cambia de configuración, THE Backend SHALL regenerar el Loop_Template de todas las pantallas afectadas en un tiempo máximo de 30 segundos.
12. THE Loop_Template SHALL incluir para cada slot: tipo (ad, ssp, playlist), posición ordinal, duración en segundos, lista ordenada de candidatos con asset_url, checksum_sha256, y estrategia de rotación (fixed o round_robin).
13. WHEN el Loop_Template cambia, THE Backend SHALL recalcular la versión como hash SHA-256 del contenido serializado para que el player detecte el cambio comparando hashes.
14. IF no existen líneas activas de ningún tier ni contenido SSP ni playlist para una pantalla activa, THEN THE Priority_Engine SHALL generar un Loop_Template vacío con su versión correspondiente, para que el player muestre la pantalla en estado idle.
15. IF solo existen líneas Estandar ASAP sin líneas Uniform activas, THEN THE Priority_Engine SHALL distribuir las líneas ASAP por share_weight sin aplicar ratio ASAP:Uniform.

### Requisito 3: Restricciones de Pace por Tier

**User Story:** Como product owner, quiero que Patrocinio y Red Interna siempre usen distribución uniforme y que solo Estandar permita elegir ASAP, para mantener la coherencia del modelo de negocio.

#### Criterios de Aceptación

1. WHEN una OrderLine tiene priority_tier "patrocinio", THE Backend SHALL forzar delivery_pace a "uniform" independientemente del valor enviado en la solicitud.
2. WHEN una OrderLine tiene priority_tier "red_interna", THE Backend SHALL forzar delivery_pace a "uniform" independientemente del valor enviado en la solicitud.
3. WHEN una OrderLine tiene priority_tier "estandar", THE Backend SHALL aceptar delivery_pace con valor "asap" o "uniform" según lo indicado por el usuario.
4. WHILE el usuario edita una OrderLine con priority_tier "patrocinio" en el Frontend, THE Frontend SHALL mostrar el campo delivery_pace deshabilitado con valor fijo "uniform".
5. WHILE el usuario edita una OrderLine con priority_tier "red_interna" en el Frontend, THE Frontend SHALL mostrar el campo delivery_pace deshabilitado con valor fijo "uniform".
6. WHILE el usuario edita una OrderLine con priority_tier "estandar" en el Frontend, THE Frontend SHALL habilitar el campo delivery_pace con opciones "asap" y "uniform".

### Requisito 4: Toggle "Por Slot" para Patrocinio

**User Story:** Como trafficker o tenant_admin, quiero poder configurar una línea de Patrocinio indicando cuántos slots del loop deseo comprar, para que el sistema calcule automáticamente los spots diarios garantizados.

#### Criterios de Aceptación

1. WHILE el usuario crea o edita una OrderLine con priority_tier "patrocinio", THE Frontend SHALL mostrar un toggle "Por Slot" visible únicamente para este tier.
2. WHEN el toggle "Por Slot" está activado, THE Frontend SHALL mostrar un campo numérico "Slots" con rango 1 a ad_slots de la configuración del Tenant.
3. WHEN el toggle "Por Slot" está activado y el usuario selecciona N slots, THE Backend SHALL calcular target_spots como: N × loops_per_day (donde loops_per_day = ventana_operativa_segundos / (num_slots × slot_duration_seconds)).
4. WHEN el toggle "Por Slot" está desactivado, THE Frontend SHALL mostrar el campo target_spots para entrada manual directa.
5. THE Backend SHALL almacenar tanto el número de slots comprados (slots_purchased) como el target_spots calculado al momento de la configuración.
6. WHEN el usuario cambia num_slots del Tenant después de crear una línea de Patrocinio con "Por Slot", THE Backend SHALL mantener el target_spots original sin recalcular (valor fijo al momento de configuración).

### Requisito 5: Fechas Dinámicas de Orden

**User Story:** Como desarrollador, quiero que las fechas de inicio y fin de una orden se calculen dinámicamente a partir de sus líneas, para eliminar datos redundantes y simplificar el formulario de creación.

#### Criterios de Aceptación

1. THE Backend SHALL eliminar las columnas starts_at y ends_at de la tabla orders.
2. WHEN se consulta una orden, THE Backend SHALL calcular starts_at como el MIN(starts_at) de todas las OrderLines asociadas, y ends_at como el MAX(ends_at) de todas las OrderLines asociadas.
3. THE Frontend SHALL mostrar en el formulario de creación de orden únicamente los campos: nombre y advertiser_name.
4. THE Frontend SHALL omitir los campos de fecha y estado del formulario de creación de orden.
5. WHEN se crea una nueva orden, THE Backend SHALL asignar status "draft" automáticamente.
6. IF un usuario intenta activar una orden que no tiene al menos 1 OrderLine con al menos 1 Creative asignado, THEN THE Backend SHALL rechazar la activación con un mensaje de error descriptivo.

### Requisito 6: Alerta de Disponibilidad de Inventario al Activar

**User Story:** Como tenant_admin, quiero recibir una alerta informativa al activar una línea de orden cuando el inventario podría ser insuficiente, para tomar decisiones informadas sin bloquear la activación.

#### Criterios de Aceptación

1. WHEN el usuario activa una OrderLine, THE Backend SHALL calcular la disponibilidad comparando: target_spots de la línea contra (loops_per_day × slots asignables) considerando las demás líneas activas en las mismas pantallas.
2. IF la disponibilidad calculada indica que target_spots supera la capacidad disponible, THEN THE Frontend SHALL mostrar un modal informativo con el mensaje de saturación y las opciones "Estoy de acuerdo" y "Modificar".
3. WHEN el usuario selecciona "Estoy de acuerdo", THE Frontend SHALL proceder con la activación sin bloquear.
4. WHEN el usuario selecciona "Modificar", THE Frontend SHALL regresar al formulario de edición de la OrderLine.
5. THE Backend SHALL ejecutar el cálculo de disponibilidad únicamente al momento de activación, no durante la edición en estado draft.
6. IF la disponibilidad es suficiente para cumplir target_spots, THEN THE Backend SHALL activar la OrderLine directamente sin mostrar alerta.

### Requisito 7: Sincronización Player y Reproducción del Loop

**User Story:** Como operador de red, quiero que el player sincronice eficientemente con el backend descargando solo cambios incrementales, para minimizar el uso de ancho de banda y garantizar continuidad de reproducción.

#### Criterios de Aceptación

1. THE Player SHALL consultar al Backend la versión del Loop_Template cada sync_interval_seconds (configurable entre 30 y 900 segundos, por defecto 240 segundos).
2. WHEN la versión del Loop_Template no ha cambiado, THE Backend SHALL responder con HTTP 304 y THE Player SHALL continuar reproduciendo el loop actual sin interrupciones ni reiniciar la posición de reproducción.
3. WHEN la versión del Loop_Template ha cambiado, THE Player SHALL descargar la nueva plantilla y comparar los assets mediante checksum SHA-256 contra los almacenados localmente.
4. WHEN el Player detecta assets nuevos en el Loop_Template actualizado, THE Player SHALL descargar únicamente los assets cuyo checksum no coincida con ningún asset almacenado localmente, validando el checksum de cada archivo descargado.
5. IF la descarga o validación de checksum de un asset falla, THEN THE Player SHALL continuar reproduciendo el Loop_Template anterior hasta el siguiente ciclo de sincronización.
6. WHEN el Player detecta assets que ya no están en el Loop_Template actualizado, THE Player SHALL marcar esos assets como elegibles para limpieza LRU sin eliminarlos inmediatamente.
7. WHILE un asset está incluido en el Loop_Template activo, THE Player SHALL proteger ese asset de la limpieza LRU independientemente de su antigüedad.
8. WHEN un slot de tipo SSP es el siguiente en la secuencia de reproducción, THE Player SHALL iniciar la pre-carga del contenido SSP antes de que el slot actual termine su duración (utilizando la lógica existente de ProDoohSource).
9. IF el SSP no retorna contenido (no-fill) o la pre-carga falla antes de que el slot SSP deba reproducirse, THEN THE Player SHALL reproducir el primer playlist_item disponible como contenido de fallback por la duración del slot SSP.
10. WHEN el Player reproduce un slot SSP, THE Player SHALL utilizar el print_id de la respuesta SSP más reciente para el Proof-of-Play, manteniendo deduplicación de caché por URL exacta del asset.
11. WHILE el Player no puede contactar al Backend durante la sincronización (timeout de 30 segundos o error de red), THE Player SHALL continuar reproduciendo el Loop_Template más reciente disponible localmente y reintentar en el siguiente ciclo.
12. THE Player SHALL rotar los candidatos dentro de cada slot que contenga múltiples creativos asignados usando estrategia Round_Robin secuencial sin necesitar un nuevo Loop_Template del Backend.

### Requisito 8: Configuración de Tenant (Ajustes de Red)

**User Story:** Como super_admin o tenant_admin, quiero configurar los parámetros de red de un tenant desde un panel centralizado, para controlar el comportamiento del loop y la sincronización de todas las pantallas.

#### Criterios de Aceptación

1. THE Backend SHALL almacenar sync_interval_seconds como entero con valor por defecto 240 y rango de 30 a 900 en la configuración de Tenant.
2. THE Backend SHALL almacenar cache_flush_interval_hours como entero con valor por defecto 24 y rango de 1 a 720 en la configuración de Tenant.
3. THE Frontend SHALL presentar un panel de "Ajustes de Red" con los campos: num_slots, ssp_slots, playlist_slots, sync_interval_seconds, cache_flush_interval_hours.
4. THE Backend SHALL rechazar con HTTP 403 las solicitudes de modificación de ajustes de red de usuarios que no sean tenant_admin o super_admin.
5. WHEN se modifican sync_interval_seconds o cache_flush_interval_hours, THE Backend SHALL incluir los nuevos valores en la próxima respuesta de sincronización al Player.

### Requisito 9: Rol Trafficker

**User Story:** Como tenant_admin, quiero crear usuarios con rol trafficker que puedan gestionar órdenes y creativos pero no activar campañas ni modificar configuración, para delegar tareas operativas manteniendo el control.

#### Criterios de Aceptación

1. THE Backend SHALL soportar el rol "trafficker" con permisos limitados a: crear, leer, editar y eliminar órdenes, líneas de orden y creativos.
2. WHEN un usuario con rol trafficker intenta activar una OrderLine o una Order, THE Backend SHALL rechazar la solicitud con HTTP 403.
3. WHEN un usuario con rol trafficker intenta acceder a configuración de Tenant, ScreenGroup o Screen, THE Backend SHALL rechazar la solicitud con HTTP 403.
4. WHEN un usuario con rol trafficker intenta gestionar usuarios, THE Backend SHALL rechazar la solicitud con HTTP 403.
5. WHILE un usuario con rol trafficker navega el Frontend, THE Frontend SHALL ocultar las secciones de configuración, activación y gestión de usuarios del menú y la interfaz.
6. THE Frontend SHALL mostrar al trafficker únicamente las secciones: Órdenes, Líneas de Orden y Creativos.

### Requisito 10: Gestión de Usuarios

**User Story:** Como tenant_admin, quiero invitar usuarios a mi tenant mediante email y gestionar sus contraseñas, para administrar el acceso al sistema de forma segura.

#### Criterios de Aceptación

1. WHEN un tenant_admin invita a un nuevo usuario, THE Backend SHALL enviar un email de invitación mediante Resend con un token de registro válido por 48 horas.
2. IF el token de invitación ha expirado (más de 48 horas), THEN THE Backend SHALL rechazar el registro con un mensaje indicando que la invitación ha expirado.
3. WHEN un usuario completa el registro con un token válido, THE Backend SHALL almacenar la contraseña hasheada con bcrypt y activar la cuenta.
4. THE Backend SHALL permitir a super_admin gestionar usuarios de todos los tenants.
5. THE Backend SHALL limitar a tenant_admin la gestión de usuarios únicamente dentro de su propio tenant.
6. WHEN un usuario solicita restablecimiento de contraseña, THE Backend SHALL enviar un email con un enlace de reset válido por 1 hora.
7. THE Frontend SHALL mostrar un enlace "¿Olvidaste tu contraseña?" en la página de login que inicie el flujo de restablecimiento.

### Requisito 11: Registro de Auditoría

**User Story:** Como tenant_admin, quiero ver un historial detallado de todos los cambios realizados sobre órdenes, líneas y creativos, para tener trazabilidad completa de las modificaciones.

#### Criterios de Aceptación

1. THE Backend SHALL registrar en la tabla audit_logs cada cambio sobre entidades del sistema usando estructura polimórfica (auditable_type, auditable_id).
2. THE Backend SHALL soportar los event_types: created, field_modified, status_changed, creative_added, creative_removed, spots_modified, name_changed, target_added, target_removed.
3. WHEN se registra un evento field_modified, THE Backend SHALL almacenar un diff con los valores old_value y new_value del campo modificado.
4. THE Frontend SHALL mostrar un ícono de reloj en cada entidad auditable que al presionarse abra un modal con el historial cronológico de cambios.
5. THE Frontend SHALL usar badges de color para diferenciar tipos de cambio: verde para adiciones (created, creative_added, target_added), amarillo para modificaciones (field_modified, spots_modified, name_changed, status_changed), rojo para eliminaciones (creative_removed, target_removed).
6. THE Backend SHALL registrar el usuario que realizó cada cambio (user_id) y la marca temporal (created_at) en cada entrada de audit_logs.

### Requisito 12: Permisos y Autorización

**User Story:** Como product owner, quiero que cada rol tenga permisos claramente definidos y aplicados tanto en frontend como en backend, para garantizar la seguridad del sistema.

#### Criterios de Aceptación

1. THE Backend SHALL otorgar al rol super_admin acceso completo a todos los tenants y todas las operaciones del sistema.
2. THE Backend SHALL limitar al rol tenant_admin acceso completo únicamente dentro de su propio tenant (órdenes, líneas, creativos, configuración, usuarios).
3. THE Backend SHALL limitar al rol trafficker a operaciones CRUD sobre órdenes, líneas de orden y creativos, excluyendo activación, configuración y gestión de usuarios.
4. WHEN un usuario intenta realizar una operación no autorizada para su rol, THE Backend SHALL responder con HTTP 403 y un mensaje de error descriptivo.
5. THE Frontend SHALL evaluar el rol del usuario autenticado para mostrar u ocultar elementos de interfaz según los permisos correspondientes.
6. THE Backend SHALL validar permisos en cada endpoint independientemente de lo que muestre el Frontend, para prevenir acceso no autorizado mediante llamadas directas a la API.
