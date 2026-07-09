# Requirements Document

## Introduction

Este documento define los requisitos para la aplicación web de administración (Admin Frontend) del sistema Prodooh Player. Es un proyecto frontend completamente independiente que consume exclusivamente los endpoints REST del backend Laravel existente vía HTTP.

La aplicación sirve a dos roles de usuario: **super_admin** (administrador global de Prodooh) y **tenant_admin** (administrador de un proveedor/media owner individual). Cada rol tiene visibilidad y permisos diferenciados según el scope del tenant.

### Stack tecnológico

- React 18 + Vite + TypeScript
- React Router v6 (navegación)
- Axios (cliente HTTP)
- TanStack Query (fetching/caching de datos)
- Shadcn/ui (Radix + Tailwind CSS)
- TanStack Table (tablas de datos)
- React Hook Form + Zod (formularios y validación)
- Sonner (notificaciones toast)

### Colores de marca

- Navy: #0f1623 (header únicamente)
- Rojo: #e8403a (acentos, botones primarios, estados activos)
- Fondo de la aplicación: blanco (#ffffff)
- Texto sobre fondo blanco: gris oscuro (#374151)
- Texto sobre elementos rojos: blanco (#ffffff)
- Botones secundarios (cancelar, etc.): gris oscuro (#374151) con texto blanco

### Restricciones técnicas clave

- NO usar `useEffect` para data fetching — usar TanStack Query exclusivamente
- NO usar `useEffect` para estado derivado — calcular durante render

## Glossary

- **Admin_Frontend**: La aplicación web SPA de administración que consume el API REST del backend.
- **Super_Admin**: Rol con acceso total al sistema; puede crear/administrar tenants, ver todas las pantallas y toda la configuración sin restricción.
- **Tenant_Admin**: Rol con acceso limitado a los recursos (pantallas, playlists, contenido) pertenecientes a su propio tenant.
- **Tenant**: Entidad que representa un proveedor/media owner con su propio inventario de pantallas y configuración independiente.
- **Screen**: Una pantalla/dispositivo registrado en el sistema, con su configuración de loop, fuentes activas y estado de heartbeat.
- **Screen_Group**: Agrupación lógica de pantallas dentro de un tenant para aplicar configuraciones comunes.
- **Playlist**: Lista ordenada de ítems de contenido (archivos o URLs con duración) asignable a una o más pantallas.
- **Content**: Archivo multimedia (imagen o video) almacenado en la biblioteca de contenido del tenant.
- **Loop_Config**: Configuración de N slots secuenciales, cada uno con una fuente asignada y una duración, que define la distribución del contenido en una pantalla.
- **Sources_Config**: Configuración de toggles on/off para cada fuente de contenido (prodooh, gam, url, playlist) por pantalla.
- **Device_Token**: Token de acceso para un dispositivo player, generado una sola vez al crear la pantalla y mostrado al usuario una única vez.
- **Heartbeat**: Señal periódica que el player envía al backend para indicar que está operativo; la ausencia de heartbeat indica que la pantalla puede estar offline.
- **Bearer_Token**: Token de autenticación Sanctum devuelto por el endpoint de login, usado en el header Authorization de todas las peticiones autenticadas.
- **Toast**: Notificación breve que aparece temporalmente en la interfaz para informar al usuario sobre el resultado de una acción.

## Requirements

### Requirement 1: Autenticación y gestión de sesión

**User Story:** Como usuario administrador, quiero iniciar sesión con mis credenciales y mantener una sesión autenticada, para poder acceder a las funcionalidades de administración correspondientes a mi rol.

#### Acceptance Criteria

1. CUANDO el usuario envía credenciales válidas (email y contraseña) en el formulario de login, EL Admin_Frontend DEBERÁ enviar una petición POST a `/api/admin/login` y almacenar el bearer token retornado en localStorage.
2. EL Admin_Frontend DEBERÁ incluir el bearer token en el header `Authorization: Bearer {token}` de todas las peticiones HTTP autenticadas al backend.
3. SI el backend retorna un código HTTP 401 en cualquier petición autenticada, ENTONCES EL Admin_Frontend DEBERÁ eliminar el token almacenado, redirigir al usuario a la pantalla de login y mostrar un toast indicando que la sesión expiró.
4. CUANDO el usuario hace clic en el botón de cerrar sesión, EL Admin_Frontend DEBERÁ enviar una petición POST a `/api/admin/logout`, eliminar el token de localStorage y redirigir a la pantalla de login.
5. CUANDO el usuario envía credenciales inválidas, EL Admin_Frontend DEBERÁ mostrar un mensaje de error claro en el formulario de login sin revelar si el email existe o no en el sistema.
6. MIENTRAS no exista un bearer token válido en localStorage, EL Admin_Frontend DEBERÁ redirigir cualquier intento de navegación a rutas protegidas hacia la pantalla de login.
7. CUANDO el Admin_Frontend se carga por primera vez con un token existente en localStorage, EL Admin_Frontend DEBERÁ validar el token enviando una petición GET a `/api/admin/user` para obtener la información del usuario actual (rol, tenant_id).

### Requirement 2: Navegación y estructura de rutas basada en rol

**User Story:** Como usuario autenticado, quiero ver una interfaz de navegación que muestre únicamente las secciones disponibles para mi rol, para acceder rápidamente a las funcionalidades que me corresponden.

#### Acceptance Criteria

1. MIENTRAS el usuario autenticado tenga rol super_admin, EL Admin_Frontend DEBERÁ mostrar en la navegación las secciones: Tenants, Pantallas, Grupos, Playlists, Contenido y Analytics.
2. MIENTRAS el usuario autenticado tenga rol tenant_admin, EL Admin_Frontend DEBERÁ mostrar en la navegación las secciones: Pantallas, Grupos, Playlists, Contenido y Analytics; la sección Tenants NO DEBERÁ ser visible ni accesible.
3. SI un tenant_admin intenta acceder directamente (por URL) a una ruta exclusiva de super_admin, ENTONCES EL Admin_Frontend DEBERÁ redirigir al usuario a su página principal y mostrar un toast de acceso denegado.
4. EL Admin_Frontend DEBERÁ utilizar React Router v6 para gestionar todas las rutas de la aplicación con navegación del lado del cliente (SPA).
5. EL Admin_Frontend DEBERÁ mostrar un header con fondo color navy (#0f1623) que incluya el nombre de la aplicación, la navegación principal y el botón de cerrar sesión.

### Requirement 3: Gestión de tenants (solo super_admin)

**User Story:** Como super_admin, quiero crear, ver, editar y eliminar tenants, para poder administrar los proveedores/media owners que operan pantallas en el sistema.

#### Acceptance Criteria

1. CUANDO el super_admin accede a la sección Tenants, EL Admin_Frontend DEBERÁ obtener la lista de tenants desde GET `/api/admin/tenants` y mostrarla en una tabla con columnas: nombre, cantidad de pantallas y fecha de creación.
2. CUANDO el super_admin hace clic en "Crear tenant", EL Admin_Frontend DEBERÁ mostrar un formulario con el campo nombre (obligatorio) y enviar una petición POST a `/api/admin/tenants` con los datos validados por Zod.
3. CUANDO el super_admin hace clic en "Editar" en un tenant, EL Admin_Frontend DEBERÁ mostrar un formulario precargado con los datos actuales del tenant obtenidos de GET `/api/admin/tenants/{id}` y enviar los cambios con PUT a `/api/admin/tenants/{id}`.
4. CUANDO el super_admin hace clic en "Eliminar" en un tenant, EL Admin_Frontend DEBERÁ mostrar un diálogo de confirmación; SI el usuario confirma, ENTONCES enviar DELETE a `/api/admin/tenants/{id}` e invalidar la query cache de tenants.
5. CUANDO una operación CRUD de tenant se completa exitosamente, EL Admin_Frontend DEBERÁ mostrar un toast de éxito y actualizar la tabla automáticamente mediante invalidación de query cache de TanStack Query.
6. SI una operación CRUD de tenant falla, ENTONCES EL Admin_Frontend DEBERÁ mostrar un toast de error con el mensaje retornado por el backend.

### Requirement 4: Listado y gestión de pantallas

**User Story:** Como usuario administrador, quiero ver todas las pantallas a las que tengo acceso con su estado actual, para poder monitorear y administrar el inventario de dispositivos.

#### Acceptance Criteria

1. CUANDO el usuario accede a la sección Pantallas, EL Admin_Frontend DEBERÁ obtener la lista de pantallas desde GET `/api/admin/screens` y mostrarla en una tabla con columnas: nombre, tenant (solo para super_admin), grupo, estado (online/offline), orientación, resolución y última actividad.
2. EL Admin_Frontend DEBERÁ determinar el estado online/offline de cada pantalla comparando el campo `last_heartbeat` contra un umbral de 2 minutos desde la hora actual; si la diferencia excede el umbral, la pantalla se muestra como offline.
3. EL Admin_Frontend DEBERÁ mostrar un indicador visual de estado: un punto verde para pantallas online y un punto rojo para pantallas offline.
4. CUANDO el usuario hace clic en "Crear pantalla", EL Admin_Frontend DEBERÁ mostrar un formulario con campos: nombre (obligatorio), tenant_id (obligatorio, selector — solo super_admin), venue_id (obligatorio), orientación (landscape/portrait), resolución ancho y alto; enviar POST a `/api/admin/screens` con validación Zod.
5. CUANDO el backend retorna exitosamente la creación de una pantalla incluyendo un `device_token` en la respuesta, EL Admin_Frontend DEBERÁ mostrar el token en un diálogo modal claramente visible con un botón de copiar al portapapeles, indicando que el token solo se muestra una vez y no podrá recuperarse.
6. CUANDO el usuario hace clic en una pantalla de la tabla, EL Admin_Frontend DEBERÁ navegar a la vista de detalle de la pantalla (GET `/api/admin/screens/{id}`).
7. EL Admin_Frontend DEBERÁ permitir editar los datos básicos de una pantalla (nombre, orientación, resolución, duración por defecto) mediante PUT a `/api/admin/screens/{id}`.

### Requirement 5: Vista de detalle de pantalla

**User Story:** Como usuario administrador, quiero ver toda la información y configuración de una pantalla específica en una sola vista, para poder gestionar su loop, fuentes activas y contenido asignado.

#### Acceptance Criteria

1. CUANDO el usuario accede al detalle de una pantalla, EL Admin_Frontend DEBERÁ mostrar: información básica (nombre, venue_id, tenant, grupo, orientación, resolución), estado online/offline con timestamp del último heartbeat, configuración de loop actual y configuración de fuentes activas.
2. EL Admin_Frontend DEBERÁ mostrar la sección de configuración de loop como un editor visual con N slots representados en orden secuencial, donde cada slot muestra su posición, fuente asignada y duración en segundos.
3. EL Admin_Frontend DEBERÁ mostrar la sección de fuentes activas como un grupo de switches on/off para cada fuente disponible (prodooh, gam, url, playlist).
4. CUANDO el usuario accede al detalle de una pantalla, EL Admin_Frontend DEBERÁ mostrar la lista de screenshots recientes obtenidos de GET `/api/admin/screens/{id}/screenshots`.
5. CUANDO el usuario accede al detalle de una pantalla, EL Admin_Frontend DEBERÁ mostrar las playlists asignadas a la pantalla.
6. EL Admin_Frontend DEBERÁ mostrar un botón "Regenerar token de dispositivo" en la vista de detalle de pantalla; CUANDO el usuario hace clic en este botón, EL Admin_Frontend DEBERÁ mostrar un diálogo de confirmación advirtiendo que el token actual será invalidado y el dispositivo perderá conexión hasta que se configure el nuevo token manualmente.
7. SI el usuario confirma la regeneración, ENTONCES EL Admin_Frontend DEBERÁ enviar POST a `/api/admin/screens/{id}/regenerate-token` y mostrar el nuevo token en un diálogo modal con botón de copiar al portapapeles, indicando que el token solo se muestra una vez y no podrá recuperarse.

### Requirement 6: Editor de configuración de loop

**User Story:** Como usuario administrador, quiero editar la configuración de loop de una pantalla mediante un editor visual de slots, para poder definir la distribución de fuentes y duración de cada slot de forma intuitiva.

#### Acceptance Criteria

1. EL Admin_Frontend DEBERÁ mostrar los slots del loop en orden secuencial, cada uno con un selector de fuente (prodooh, gam, url, playlist) y un campo numérico de duración en segundos.
2. EL Admin_Frontend DEBERÁ permitir agregar nuevos slots al final del loop y eliminar slots existentes, con un mínimo de 1 slot.
3. CUANDO el usuario hace clic en "Guardar loop", EL Admin_Frontend DEBERÁ enviar la configuración completa de slots como un array JSON con PUT a `/api/admin/screens/{id}/loop`, donde cada slot contiene: position (índice), source (string) y duration (número).
4. SI la operación de guardado de loop se completa exitosamente, ENTONCES EL Admin_Frontend DEBERÁ mostrar un toast de confirmación e invalidar la query cache del detalle de la pantalla.
5. EL Admin_Frontend DEBERÁ validar que cada slot tenga una fuente seleccionada y una duración mayor a cero antes de permitir el envío.

### Requirement 7: Toggle de fuentes activas

**User Story:** Como usuario administrador, quiero activar o desactivar fuentes de contenido individuales para una pantalla, para poder controlar rápidamente qué fuentes participan en el loop sin editar la configuración completa.

#### Acceptance Criteria

1. EL Admin_Frontend DEBERÁ mostrar un switch on/off por cada fuente de contenido (prodooh, gam, url, playlist), reflejando el estado actual obtenido del campo `sources_config` de la pantalla.
2. CUANDO el usuario cambia el estado de un switch, EL Admin_Frontend DEBERÁ enviar inmediatamente una petición PUT a `/api/admin/screens/{id}/sources` con el objeto completo de configuración de fuentes (todas las fuentes con su estado enabled: true/false).
3. SI la operación de toggle se completa exitosamente, ENTONCES EL Admin_Frontend DEBERÁ mostrar un toast de confirmación.
4. SI la operación de toggle falla, ENTONCES EL Admin_Frontend DEBERÁ revertir visualmente el switch a su estado anterior y mostrar un toast de error.

### Requirement 8: Gestión de grupos de pantallas

**User Story:** Como usuario administrador, quiero crear y administrar grupos de pantallas, para poder organizar el inventario por ubicación o tipo y aplicar configuraciones comunes.

#### Acceptance Criteria

1. CUANDO el usuario accede a la sección Grupos, EL Admin_Frontend DEBERÁ obtener la lista de grupos desde GET `/api/admin/groups` y mostrarla en una tabla con columnas: nombre, cantidad de pantallas, orientación y resolución.
2. CUANDO el usuario hace clic en "Crear grupo", EL Admin_Frontend DEBERÁ mostrar un formulario con campos: nombre (obligatorio), duración por defecto en segundos, orientación, resolución ancho y alto; enviar POST a `/api/admin/groups` con validación Zod.
3. CUANDO el usuario hace clic en un grupo, EL Admin_Frontend DEBERÁ navegar al detalle del grupo (GET `/api/admin/groups/{id}`) mostrando sus datos y la lista de pantallas asignadas.
4. EL Admin_Frontend DEBERÁ permitir editar los datos de un grupo mediante PUT a `/api/admin/groups/{id}`.
5. CUANDO el usuario hace clic en "Eliminar" en un grupo, EL Admin_Frontend DEBERÁ mostrar un diálogo de confirmación y enviar DELETE a `/api/admin/groups/{id}` si el usuario confirma.
6. EL Admin_Frontend DEBERÁ permitir asignar pantallas a un grupo mediante un selector múltiple que envíe POST a `/api/admin/groups/{id}/screens` con el array de screen_ids.

### Requirement 9: Gestión de playlists

**User Story:** Como usuario administrador, quiero crear y editar playlists con ítems ordenados, para poder definir el contenido que se reproducirá en las pantallas que tengan la fuente playlist activa.

#### Acceptance Criteria

1. CUANDO el usuario accede a la sección Playlists, EL Admin_Frontend DEBERÁ obtener la lista desde GET `/api/admin/playlists` y mostrarla en una tabla con columnas: nombre, cantidad de ítems y fecha de creación.
2. CUANDO el usuario hace clic en "Crear playlist", EL Admin_Frontend DEBERÁ mostrar un formulario con: nombre (obligatorio) y un editor de ítems ordenados; enviar POST a `/api/admin/playlists` con nombre y array de items.
3. EL Admin_Frontend DEBERÁ mostrar el editor de ítems de playlist como una lista ordenada donde cada ítem tiene: tipo (content o url), selector de contenido de la biblioteca (si tipo es content) o campo de URL (si tipo es url), duración en segundos y posición; el usuario DEBERÁ poder reordenar los ítems arrastrando (drag) o con botones de mover arriba/abajo.
4. CUANDO el usuario hace clic en "Editar" en una playlist, EL Admin_Frontend DEBERÁ cargar los datos actuales desde GET `/api/admin/playlists/{id}` y permitir modificar nombre e ítems, enviando PUT a `/api/admin/playlists/{id}`.
5. CUANDO el usuario hace clic en "Eliminar" en una playlist, EL Admin_Frontend DEBERÁ mostrar un diálogo de confirmación y enviar DELETE a `/api/admin/playlists/{id}` si el usuario confirma.
6. EL Admin_Frontend DEBERÁ permitir asignar una playlist a una o más pantallas mediante un selector múltiple que envíe POST a `/api/admin/playlists/{id}/assign` con el array de screen_ids.
7. EL Admin_Frontend DEBERÁ validar con Zod que cada ítem de playlist tenga tipo válido, contenido o URL según corresponda, y duración mayor a cero antes de permitir el envío.

### Requirement 10: Biblioteca de contenido

**User Story:** Como usuario administrador, quiero subir, visualizar y gestionar archivos multimedia en la biblioteca de contenido, para poder usarlos en las playlists asignadas a las pantallas.

#### Acceptance Criteria

1. CUANDO el usuario accede a la sección Contenido, EL Admin_Frontend DEBERÁ obtener la lista desde GET `/api/admin/content` y mostrarla en una grilla o tabla con: nombre de archivo, tipo (imagen/video), dimensiones, tamaño y fecha de subida.
2. EL Admin_Frontend DEBERÁ permitir subir archivos mediante un componente de drag-and-drop o selector de archivo que envíe POST a `/api/admin/content` con el archivo como multipart/form-data.
3. MIENTRAS un archivo se está subiendo, EL Admin_Frontend DEBERÁ mostrar una barra de progreso de carga visible al usuario.
4. CUANDO el usuario hace clic en "Eliminar" en un contenido, EL Admin_Frontend DEBERÁ mostrar un diálogo de confirmación y enviar DELETE a `/api/admin/content/{id}` si el usuario confirma.
5. EL Admin_Frontend DEBERÁ permitir rotar un contenido (imagen) enviando PUT a `/api/admin/content/{id}/rotate` con el ángulo de rotación (90, 180, 270).
6. CUANDO el usuario hace clic en "Vista previa" de un contenido, EL Admin_Frontend DEBERÁ mostrar una previsualización del archivo utilizando la URL obtenida de GET `/api/admin/content/{id}/preview`.
7. SI la operación de subida falla por validación del backend (formato no soportado, tamaño excedido, resolución inválida), ENTONCES EL Admin_Frontend DEBERÁ mostrar un toast de error con el mensaje específico retornado por el backend.

### Requirement 11: Analytics de reproducción

**User Story:** Como usuario administrador, quiero consultar estadísticas de reproducción por rango de fechas, para poder analizar el rendimiento y distribución de contenido en las pantallas.

#### Acceptance Criteria

1. CUANDO el usuario accede a la sección Analytics, EL Admin_Frontend DEBERÁ mostrar un selector de rango de fechas (fecha inicio y fecha fin) con valores por defecto de los últimos 7 días.
2. CUANDO el usuario selecciona un rango de fechas y hace clic en "Consultar", EL Admin_Frontend DEBERÁ enviar GET a `/api/admin/analytics/playback?start_date={inicio}&end_date={fin}` y mostrar los resultados en formato tabular o resumen.
3. EL Admin_Frontend DEBERÁ mostrar los datos de analytics agrupados según la estructura retornada por el backend (por pantalla, por fuente, totales).
4. MIENTRAS la consulta de analytics está en progreso, EL Admin_Frontend DEBERÁ mostrar un indicador de carga (skeleton o spinner).

### Requirement 12: Screenshots remotos

**User Story:** Como usuario administrador, quiero ver las capturas de pantalla recientes de una pantalla, para verificar visualmente qué contenido se está reproduciendo sin estar físicamente presente.

#### Acceptance Criteria

1. CUANDO el usuario accede a la sección de screenshots en el detalle de una pantalla, EL Admin_Frontend DEBERÁ obtener la lista desde GET `/api/admin/screens/{id}/screenshots` y mostrar las imágenes como una galería ordenada por fecha (más reciente primero).
2. CUANDO el usuario hace clic en una miniatura de screenshot, EL Admin_Frontend DEBERÁ mostrar la imagen en tamaño completo en un modal/lightbox.
3. EL Admin_Frontend DEBERÁ mostrar la fecha y hora de captura debajo de cada miniatura de screenshot.

### Requirement 13: Manejo de estados de carga y error

**User Story:** Como usuario administrador, quiero ver indicadores claros de carga y mensajes de error informativos, para entender el estado de la aplicación en todo momento.

#### Acceptance Criteria

1. MIENTRAS una petición de datos está en progreso (query de TanStack Query en estado loading), EL Admin_Frontend DEBERÁ mostrar un skeleton loader o spinner en la zona donde se renderizarán los datos.
2. SI una petición de datos falla (query de TanStack Query en estado error), ENTONCES EL Admin_Frontend DEBERÁ mostrar un mensaje de error con un botón de "Reintentar" que dispare un refetch manual.
3. CUANDO una mutación (POST, PUT, DELETE) está en progreso, EL Admin_Frontend DEBERÁ deshabilitar el botón de envío y mostrar un indicador de carga en el botón para evitar envíos duplicados.
4. SI una mutación falla, ENTONCES EL Admin_Frontend DEBERÁ mostrar un toast de error con el mensaje retornado por el backend y mantener los datos del formulario intactos para que el usuario pueda reintentar.
5. EL Admin_Frontend DEBERÁ configurar TanStack Query con retry de máximo 1 reintento automático para queries fallidas y 0 reintentos para mutaciones.

### Requirement 14: Diseño visual y responsividad básica

**User Story:** Como usuario administrador, quiero una interfaz funcional, limpia y consistente con la marca Prodooh, para poder realizar mis tareas de administración de forma eficiente.

#### Acceptance Criteria

1. EL Admin_Frontend DEBERÁ utilizar los colores de marca: navy (#0f1623) exclusivamente para el header, fondo de la aplicación blanco (#ffffff), rojo (#e8403a) para botones primarios, acentos y estados activos con texto blanco sobre ellos, texto gris oscuro (#374151) sobre fondo blanco, y botones secundarios (cancelar, etc.) en gris oscuro (#374151) con texto blanco.
2. EL Admin_Frontend DEBERÁ utilizar componentes de Shadcn/ui para todos los elementos de interfaz (botones, inputs, diálogos, tablas, switches, selects, toasts).
3. EL Admin_Frontend DEBERÁ mostrar todas las tablas de datos utilizando TanStack Table con soporte de ordenamiento por columnas.
4. EL Admin_Frontend DEBERÁ ser funcional en pantallas de escritorio (ancho mínimo 1024px); la responsividad para dispositivos móviles no es un requisito de esta fase.
5. EL Admin_Frontend DEBERÁ utilizar Sonner para todas las notificaciones toast, con posición consistente en la interfaz.

### Requirement 15: Configuración del cliente HTTP y comunicación con el backend

**User Story:** Como desarrollador del frontend, quiero una capa de comunicación HTTP configurada y centralizada, para que todas las peticiones al backend se gestionen de forma consistente y segura.

#### Acceptance Criteria

1. EL Admin_Frontend DEBERÁ configurar una instancia de Axios con la base URL del backend como variable de entorno (`VITE_API_BASE_URL`).
2. EL Admin_Frontend DEBERÁ configurar un interceptor de request en Axios que agregue automáticamente el header `Authorization: Bearer {token}` a toda petición cuando exista un token almacenado.
3. EL Admin_Frontend DEBERÁ configurar un interceptor de response en Axios que detecte respuestas 401 y dispare el flujo de cierre de sesión automático (eliminar token y redirigir a login).
4. EL Admin_Frontend DEBERÁ enviar el header `Accept: application/json` en todas las peticiones al backend.
5. EL Admin_Frontend DEBERÁ utilizar exclusivamente TanStack Query (useQuery, useMutation) para gestionar el ciclo de vida de las peticiones HTTP; NO DEBERÁ usar useEffect para data fetching bajo ninguna circunstancia.
