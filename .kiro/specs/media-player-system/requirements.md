# Requirements Document

## Introduction

Prodooh opera pantallas digitales usando **Doohmain** como reproductor (player) de terceros, bajo licencia. El objetivo estratégico de este proyecto es reemplazar Doohmain con un **player propio** (Hybrid Ad Player), para:

- Eliminar el costo de licenciamiento de Doohmain.
- Tener control técnico total sobre el reproductor (formatos soportados, telemetría, integración directa con las fuentes de contenido de Prodooh).
- Poder ofrecer este player a futuro a media owners/proveedores que hoy no usan ninguna plataforma de gestión de pantallas.

Este MVP es la **Fase 1** de un proyecto más amplio. No es un spike desechable: es la primera versión funcional real, usando desarrollo asistido por IA (Kiro).

**Objetivo adicional de esta fase:** el piloto debe poder demostrar, con 2 tótems de oficina, que el player soporta **múltiples proveedores (media owners) operando de forma independiente** — cada uno con su propia playlist y su propia configuración de fuentes activas. Esto valida en vivo la hipótesis de negocio de que el player puede convertirse en un producto ofrecido a media owners externos.

### Alcance de esta fase

- Piloto en **2 tótems digitales en una oficina** (a futuro 70 pantallas en un aeropuerto + multiples clientes con su propio inventario de pantallas).
- Hardware: Raspberry Pi 5, conectada por HDMI a pantallas Samsung QM65C (4K nativo, control remoto vía RS-232/LAN — protocolo MDC).
- El player debe poder mostrar contenido de **cuatro fuentes**, distribuidas mediante un **loop fijo con slots asignados** (por defecto 25% share of voice cada una, configurable por tenant):
  1. Arte servido por el **API de Ad Serving de Prodooh** (pseudo-SSP interno).
  2. Anuncio servido por **Google Ad Manager vía VAST** (usando ad tags de prueba).
  3. **Contenido web por URL** (páginas web cargadas en webview embebido).
  4. **Playlist local** (contenido propio — imágenes, videos y URLs — precargado, siempre disponible como respaldo).
- Si una fuente asignada a un slot no responde, el slot se rellena con playlist local (nunca pantalla en negro).
- Todo el desarrollo y las pruebas de esta fase usan **entornos sandbox**.

### Fuera de alcance de esta fase

- Autoservicio real de proveedores/tenants (onboarding sin intervención manual, regeneración de credenciales desde UI, invitación de usuarios adicionales, aislamiento de datos a nivel de infraestructura).
- Configuración de slots del loop por media owner autogestionada (en esta fase la configuración del loop la hace el admin del tenant o el super-admin, pero el orden es configurable).
- Integración real (no sandbox) con Google Ad Manager.
- Rollout a las 70 pantallas de aeropuerto.
- Gestión de flota a escala (OTA, monitoreo centralizado con alertas, control de encendido/apagado programado vía MDC).

## Stack Tecnológico

### Backend

- **Framework:** Laravel (PHP 8.4)
- **Base de datos (desarrollo local):** PostgreSQL
- **Base de datos (producción):** MySQL o PostgreSQL (por definir)
- El backend se ejecuta en un entorno local de desarrollo durante esta fase

### Player

- **Lenguaje:** JavaScript/TypeScript vanilla (sin frameworks)
- El player se despliega y ejecuta en las Raspberry Pi 5

### Sistema Operativo de Raspberry Pi 5

- **SO recomendado:** Raspberry Pi OS Lite (sin desktop environment)
- **Window manager mínimo:** Cage o labwc (compositor Wayland ligero)
- **Navegador en modo kiosko:** Chromium en kiosk mode, ejecutado sobre el window manager mínimo
- **Alternativa viable:** Solución basada en Electron o CEF para renderizar el player TS/JS a pantalla completa sin posibilidad de escape

**Requisitos del SO:**
- Al encender la Raspberry, el player se ejecuta automáticamente (modo kiosko)
- Un modo operativo que NO permite salir del player (bloqueo de teclado/mouse)
- Para poder salir del player se requiere una contraseña de mantenimiento

## Estructura del Proyecto (Monorepo)

Para facilitar el desarrollo del MVP, el proyecto se organiza como un **monorepo único** que contiene tanto el código del backend como el del player. Sin embargo, el código está separado de forma que facilite:

- **Deployment independiente hacia el ambiente local** (Backend — Laravel + PostgreSQL)
- **Deployment independiente hacia las Raspberry Pi** (Player — JS/TS vanilla)

Eventualmente, el proyecto se dividirá en **2 repositorios separados** (backend y player) una vez que la fase de MVP esté completa y se requiera gestión de releases y CI/CD independientes.

## Referencia Técnica: API de Ad Serving de Prodooh

Documentación completa: `https://prodooh.com/developers/ad-serving-api.html`

### Ambientes

| Ambiente | Base URL | Descripción |
|---|---|---|
| Producción | `https://api.prodooh.com` | Ambiente real. Impresiones afectan reportes. |
| Sandbox | `https://sandbox.api.prodooh.com` | Ambiente de pruebas. Artes ficticios, sin registro de impresiones reales. |

### Autenticación

Cada proveedor/red se autentica con dos credenciales obligatorias en cada request:
- `api_key` (UUID): Clave única del proveedor. No expira a menos que sea revocada.
- `network_id` (string): Identificador de red. Segundo factor de validación.

Credenciales de producción y sandbox son independientes.

### Credenciales Sandbox (para desarrollo y piloto)

```
API_KEY="sandbox-api-key"
NETWORK_ID="sandbox-network"
VENUE_ID="sandbox-screen-1"
SCREEN_WIDTH=1920
SCREEN_HEIGHT=1080
```

### Flujo de integración (3 pasos)

1. **Obtener arte** — `POST /public/v1/ad` — La pantalla consulta arte disponible. Recibe URL del recurso y `print_id`.
2. **Confirmar reproducción** — `GET /public/v1/ad/proof_of_play/{print_id}` — Después de mostrar el arte, se confirma el `print_id`.
3. **Expirar arte (opcional)** — `GET /public/v1/expiration/{print_id}` — Si el arte no se mostró, se expira para evitar duplicidades.

### Endpoint: Obtener arte

**Request:** `POST /public/v1/ad`

| Parámetro | Tipo | Requerido | Descripción |
|---|---|---|---|
| `api_key` | string (UUID) | Sí | Clave única del proveedor |
| `network_id` | string | Sí | Identificador de red del proveedor |
| `venue_id` | string | Sí | Identificador único de la pantalla |
| `width` | integer | Sí | Ancho de pantalla en píxeles |
| `height` | integer | Sí | Alto de pantalla en píxeles |
| `supported_media` | array\<string\> | Sí | MIME types soportados (ej: `["image/jpeg","video/mp4"]`) |

**Respuesta exitosa (200):**

| Campo | Tipo | Descripción |
|---|---|---|
| `media` | string (URL) | URL del recurso creativo para descargar y mostrar |
| `type` | string | MIME type del arte (ej: `video/mp4`) |
| `print_id` | string (UUID) | Identificador único de la impresión |
| `proof_of_play` | string (URL) | URL para confirmar reproducción (paso 2) |
| `expiration` | string (URL) | URL para expirar si no se mostró (paso 3) |
| `media_id` | integer (opcional) | ID interno del creativo |
| `campaign_id` | integer (opcional) | ID de la campaña |

**Respuestas sin arte disponible:**
- `200` con `"status": "no fill"` — Pantalla llegó a su límite de spots diarios o totales.
- `200` con `"error": "No ad configured for this screen"` — No hay pauta asignada en este momento.

**Errores:**
- `401` — Credenciales inválidas
- `404` — `venue_id` no encontrado
- `422` — Parámetros incorrectos o medidas no coinciden
- `429` — Rate limit excedido (implementar backoff exponencial)
- `500` — Error interno del servidor

### Endpoint: Proof of Play

**Request:** `GET /public/v1/ad/proof_of_play/{print_id}`

Usar directamente la URL del campo `proof_of_play` de la respuesta del paso 1.

- `201` — Impresión registrada correctamente
- `404` — `print_id` no encontrado
- `409` — `print_id` ya fue registrado o expirado previamente

### Endpoint: Expiración

**Request:** `GET /public/v1/expiration/{print_id}`

- `201` — Impresión expirada correctamente
- `404` — `print_id` no encontrado

### Límites de polling

| Métrica | Valor |
|---|---|
| Intervalo mínimo entre requests por pantalla | 10 segundos |
| Máximo requests/minuto por pantalla | 100 |
| Código HTTP cuando se excede | 429 |

Ante un 429, implementar backoff exponencial: 1s → 2s → 4s → ... hasta máximo 60s. El header `Retry-After` indica el tiempo de espera.

## Glossary

| Término | Definición |
|---|---|
| **Player** | El software que corre en cada Raspberry Pi / pantalla, responsable de decidir y reproducir contenido. |
| **Pantalla / Screen** | Una unidad física de despliegue (Raspberry Pi + monitor). En esta fase, los 2 tótems de oficina. |
| **venue_id** | Identificador único de una pantalla, ya usado por el API de Ad Serving de Prodooh. Se reutiliza como identificador único del player en todo el sistema. |
| **Fuente de contenido** | Cualquiera de las cuatro procedencias posibles de un arte a reproducir: API de Ad Serving de Prodooh, Google Ad Manager (VAST), URL (contenido web), o Playlist local. |
| **API de Ad Serving de Prodooh** | El servicio REST existente (documentado en `https://prodooh.com/developers/ad-serving-api.html`) que responde si hay una campaña/arte aprobado para una pantalla en un momento dado. |
| **print_id** | Identificador que entrega el API de Ad Serving por cada arte servido, usado para confirmar reproducción (proof of play) o invalidar el envío (expiration). |
| **Proof of Play (POP)** | Confirmación de que un arte efectivamente se reprodujo en pantalla. Debe enviarse únicamente después de que la reproducción fue exitosa, nunca antes. |
| **Expiration** | Notificación de que un arte fue recibido pero no se reprodujo (falla de carga, timeout, etc.), para invalidar ese envío del lado del servidor. |
| **VAST** | Formato estándar de anuncios de video que entrega Google Ad Manager. |
| **Sandbox** | Entorno de pruebas de cualquiera de las dos fuentes externas (Prodooh o Google), que no genera impresiones reales. |
| **Playlist local** | Lista de contenido propio de Prodooh (imágenes, videos y URLs), definida centralmente y sincronizada al player, que se reproduce cuando no hay arte disponible de ninguna otra fuente. |
| **Fuente URL** | Cuarta fuente de contenido en el loop que carga páginas web en un webview embebido a pantalla completa. Funciona como fuente independiente con su propia "playlist de URLs" y slots asignados. |
| **Prefetch** | Acción de descargar y preparar el siguiente arte a reproducir mientras el arte actual todavía se está reproduciendo. |
| **Media owner** | Cliente/proveedor de Prodooh que aprueba campañas y creativos a través de la plataforma SSP existente. |
| **Cascada de prioridad / Loop fijo** | Mecanismo de distribución de fuentes basado en un loop de N slots que se repite secuencialmente. Cada slot está asignado a una fuente. Si la fuente no responde, el slot se rellena con playlist local. |
| **Loop** | Secuencia fija de N slots que se repite continuamente durante el horario de operación. Cada slot tiene una fuente asignada y una duración definida. |
| **Share of Voice (SOV)** | Porcentaje de tiempo/slots que una fuente ocupa dentro del loop. Con 4 slots y 1 asignado a una fuente, su SOV es 25%. |
| **Tenant / Proveedor** | Una entidad (media owner) que administra su propio conjunto de pantallas, con su propia playlist y configuración de fuentes activas. Su administrador es el media owner. |
| **Super-admin** | Rol interno de Prodooh que puede crear/administrar tenants, generar credenciales de acceso, y configurar cualquier aspecto del sistema sin restricción. |
| **Credencial de dispositivo** | El token que usa el player para autenticarse ante el backend propio del Hybrid Player. |
| **Modo kiosko** | Modo de operación en el que el dispositivo ejecuta exclusivamente el player a pantalla completa, sin posibilidad de que el usuario acceda al sistema operativo subyacente. |
| **Monorepo** | Estructura de proyecto donde múltiples componentes (backend y player) coexisten en un único repositorio, con separación lógica que permite deployment independiente. |
| **Horario de operación** | Franja horaria durante la cual una pantalla está activa y reproduce contenido. Fuera de este horario, la pantalla se apaga o muestra una pantalla de reposo. |
| **Duración de slot** | Tiempo que un contenido individual permanece visible en pantalla antes de pasar al siguiente (configurable por ítem o por defecto del tenant). |
| **Grupo de pantallas** | Agrupación lógica de pantallas dentro de un tenant (por ejemplo, por ubicación geográfica o tipo de venue) que permite aplicar configuraciones comunes (duración, horarios) a todas las pantallas del grupo sin configurarlas una por una. |
| **Biblioteca de contenido** | Repositorio centralizado por tenant donde se almacenan todos los artes (imágenes y videos) que luego pueden asignarse a una o múltiples pantallas. |
| **Contenido precargado** | Animaciones de marca Prodooh incluidas de fábrica en cada dispositivo, usadas como respaldo de última instancia cuando no hay playlist ni conectividad. |
| **Screenshot remoto** | Captura de pantalla bajo demanda que el player toma y envía al backend para verificación visual remota del contenido en reproducción. |
| **Log de reproducción** | Registro detallado de cada spot/arte reproducido en una pantalla, incluyendo fuente, duración, timestamp y resultado, usado para analytics y reportes a anunciantes. |

## Requirements

### Requirement 1: Identificación y autenticación de la pantalla

**User Story:** Como dispositivo player, quiero identificarme con un venue_id único y autenticarme correctamente ante cada sistema con el que me comunico, para poder solicitar contenido de las fuentes correctas y reportar mi estado sin confundir credenciales de distintos sistemas.

#### Acceptance Criteria

1. CUANDO el player arranca, EL Player DEBERÁ leer su `venue_id` de una configuración local presente en el dispositivo; este identificador es el mismo en las tres relaciones de autenticación (backend propio, API de Ad Serving de Prodooh, y GAM).
2. EL Player DEBERÁ autenticarse ante el backend propio del Hybrid Player usando una credencial emitida y controlada por ese mismo backend, independiente de cualquier credencial de sistemas externos.
3. EL Player DEBERÁ usar por separado las credenciales del API de Ad Serving de Prodooh únicamente cuando consulta esa fuente específica.
4. SI falta una configuración específica (credencial de backend híbrido, credenciales de API de Prodooh, o configuración de GAM), ENTONCES EL Player DEBERÁ bloquear únicamente las operaciones que requieren esa configuración faltante, mientras continúa operando normalmente con las fuentes cuya configuración está presente.

### Requirement 2: Consulta de arte al API de Ad Serving de Prodooh

**User Story:** Como dispositivo player, quiero consultar el API de Ad Serving de Prodooh para buscar arte disponible para mi pantalla, para poder priorizar contenido aprobado de campañas de media owners sobre otras fuentes.

#### Acceptance Criteria

1. EL Player DEBERÁ consultar el API de Ad Serving en modo sandbox usando su `venue_id`.
2. SI la respuesta del API incluye arte disponible, ENTONCES EL Player DEBERÁ reproducirlo y registrar una confirmación de proof of play pendiente.
3. SI el player recibe arte pero no logra reproducirlo por problemas técnicos (fallo de decodificación, archivo corrupto, error de renderizado), ENTONCES EL Player DEBERÁ notificar la expiración al API y pasar a la siguiente fuente activa en la rotación.
4. SI la respuesta indica que no hay arte disponible, ENTONCES EL Player DEBERÁ pasar a la siguiente fuente activa en la rotación sin necesidad de distinguir el motivo específico de la ausencia.
5. EL Player DEBERÁ respetar los límites de frecuencia de consulta documentados por el API (mínimo de tiempo entre solicitudes por pantalla).

### Requirement 3: Consulta de anuncio a Google Ad Manager (VAST, sandbox)

**User Story:** Como dispositivo player, quiero solicitar un anuncio VAST de prueba a Google Ad Manager cuando me corresponde el slot de esta fuente en el loop, para poder validar la integración con GAM sin exponer inventario ni cuentas de producción.

#### Acceptance Criteria

1. ANTES de enviar cualquier solicitud a GAM, EL Player DEBERÁ validar el formato del ad tag para confirmar que corresponde a un tag de prueba/sandbox; SI el tag no pasa la validación, ENTONCES EL Player DEBERÁ rehusarse a enviar la solicitud y registrar un error.
2. SI GAM responde con un anuncio válido, ENTONCES EL Player DEBERÁ reproducirlo.
3. SI GAM no responde con un anuncio válido dentro de un tiempo razonable, responde sin anuncio disponible, o provee un anuncio válido que no puede reproducirse por cualquier razón, ENTONCES EL Player DEBERÁ cambiar a la playlist local sin quedar bloqueado.
4. EL Player DEBERÁ garantizar que ningún dato de esta prueba se reporte como impresión real ni se conecte a una cuenta de producción de Google.

### Requirement 4: Reproducción de playlist local como respaldo

**User Story:** Como dispositivo player, quiero tener siempre una playlist local de contenido propio disponible, para que la pantalla nunca quede en negro aunque ambas fuentes externas fallen o no tengan contenido disponible.

#### Acceptance Criteria

1. EL Player DEBERÁ tener siempre al menos un ítem de playlist local disponible en el dispositivo, sin depender de conexión a internet en el momento de reproducirlo. CUANDO el dispositivo está en configuración inicial o después de un reseteo de fábrica y ningún contenido ha sido sincronizado aún, ENTONCES EL Player DEBERÁ mostrar una pantalla de splash con marca o indicador de configuración y operar en modo de degradación elegante hasta que la primera sincronización de playlist se complete.
2. SI tanto el API de Prodooh como GAM no entregan contenido, ENTONCES EL Player DEBERÁ reproducir el siguiente ítem de la playlist local sin demora perceptible; EL Player NO DEBERÁ intentar reproducción de fuentes externas a menos que al menos un ítem de playlist local esté disponible como respaldo.
3. EL Player DEBERÁ garantizar que la playlist local se define y mantiene exclusivamente de forma centralizada; los dispositivos no pueden editar su playlist local de forma manual ni automática, incluso cuando el sistema central está inaccesible.
4. EL Player DEBERÁ sincronizar periódicamente su copia local de la playlist contra la fuente central, y seguir operando con su última copia conocida si pierde conectividad.

### Requirement 5: Confirmación de reproducción (Proof of Play) y expiración

**User Story:** Como dispositivo player, quiero confirmar al API de Prodooh que un arte se reprodujo exitosamente, o notificar que no se pudo reproducir, para que los media owners tengan reportes de reproducción confiables.

#### Acceptance Criteria

1. EL Player DEBERÁ confirmar la reproducción (proof of play) únicamente después de que el arte terminó de reproducirse exitosamente en pantalla.
2. SI el arte recibido no se pudo reproducir (falla de carga, formato no soportado, timeout), ENTONCES EL Player DEBERÁ notificar la expiración correspondiente en vez de confirmar reproducción.
3. EL Player DEBERÁ garantizar que un arte nunca queda en un estado ambiguo: siempre termina confirmado como reproducido o notificado como no reproducido.
4. SI una notificación de proof of play o expiración no puede entregarse debido a problemas de red o fallas del sistema, ENTONCES EL Player DEBERÁ encolar la notificación localmente y reintentar la entrega con backoff exponencial hasta lograrlo, garantizando la entrega eventual.

### Requirement 6: Transición sin espacios en negro entre artes

**User Story:** Como espectador de la pantalla, quiero que las transiciones entre contenidos sean inmediatas, para que la experiencia visual sea profesional y continua sin importar de qué fuente proviene cada pieza de contenido.

#### Acceptance Criteria

1. EL Player DEBERÁ empezar a preparar el siguiente arte a mostrar mientras el arte actual todavía se está reproduciendo (prefetch).
2. EL Player DEBERÁ realizar la transición entre un arte y el siguiente sin frames en negro perceptibles, independientemente de si el contenido proviene de la misma fuente o de una distinta.
3. SI el siguiente contenido programado no está listo cuando el contenido actual termina, ENTONCES EL Player DEBERÁ cambiar inmediatamente a un ítem de respaldo local pre-bufferizado y ya cargado en memoria.
4. EL Player DEBERÁ mantener un buffer secundario de respaldo (al menos un ítem de playlist local pre-decodificado y listo en memoria en todo momento) para garantizar que la activación del respaldo sea instantánea incluso si el mecanismo primario de respaldo encuentra un retraso.

### Requirement 7: Distribución de fuentes mediante loop fijo con slots asignados

**User Story:** Como Head of Product & Engineering, quiero que la distribución de contenido entre fuentes se haga mediante un loop fijo de N slots que se repite continuamente, donde cada fuente tiene slots asignados según su peso, para garantizar una distribución predecible y poder calcular el share of voice de cada fuente con precisión.

#### Acceptance Criteria

1. EL Sistema DEBERÁ definir un loop como una secuencia fija de N slots que se repite continuamente mientras la pantalla está en horario de operación; el número de slots y la asignación de fuentes por slot son configurables por el administrador del tenant o por el super-admin.
2. EL Sistema DEBERÁ asignar los slots del loop a cada fuente de contenido según su peso configurado; por defecto en esta fase, un loop de 4 slots de 10 segundos con distribución equitativa: 1 slot Prodooh API, 1 slot GAM, 1 slot URL, 1 slot Playlist local (25% share of voice cada uno).
3. SI la fuente asignada a un slot no responde (timeout, no fill, cap alcanzado, error), ENTONCES EL Player DEBERÁ rellenar ese slot con el siguiente ítem de la playlist local, garantizando que nunca haya pantalla en negro.
4. EL Player DEBERÁ tratar cada fuente de contenido de manera intercambiable frente al resto del sistema (todas exponen la misma interfaz de "dame el siguiente contenido" y "confirma o invalida lo reproducido").
5. EL Sistema DEBERÁ permitir modificar la cantidad de slots del loop, la duración de cada slot, y la asignación de fuentes por slot, sin requerir modificar la lógica interna de ninguna fuente individual.
6. CUANDO una fuente se desactiva (toggle off), EL Sistema DEBERÁ reasignar sus slots a la playlist local (o a otra fuente según configuración) sin alterar la estructura del loop.
7. EL Sistema DEBERÁ permitir configurar loops con distribución no equitativa; por ejemplo, un loop de 6 slots donde Prodooh API tiene 3 slots (50%), GAM tiene 1 slot (16.6%), URL tiene 1 slot (16.6%) y Playlist tiene 1 slot (16.6%).
8. EL Player DEBERÁ ejecutar los slots del loop en el orden definido secuencialmente, sin aleatoriedad, para que el share of voice sea predecible y auditable.

#### Nota de referencia: Cálculo de spots por día

Con el loop por defecto de 4 slots x 10 segundos (40 segundos por loop):

| Horario operación | Loops/hora | Loops/día | Spots por fuente/día (25% SOV) |
|---|---|---|---|
| 24 horas | 90 | 2,160 | 2,160 |
| 18 horas | 90 | 1,620 | 1,620 |
| 12 horas | 90 | 1,080 | 1,080 |

El API de Prodooh controla internamente su propio cap de spots diarios por pantalla (responde "no fill" cuando se alcanza el límite), por lo que no es necesario re-implementar un cap engine en el player para esa fuente.

### Requirement 8: Visibilidad remota del estado del player

**User Story:** Como Head of Product & Engineering, quiero poder ver remotamente qué está reproduciendo cada pantalla y si está funcionando correctamente, para poder operar y depurar el piloto sin estar físicamente presente en el tótem.

#### Acceptance Criteria

1. EL Sistema DEBERÁ permitir consultar remotamente, para una pantalla dada: qué está reproduciendo en este momento, de qué fuente proviene, y cuándo fue la última vez que el player reportó actividad (heartbeat).
2. SI un player deja de reportar actividad más allá del umbral de heartbeat configurado, ENTONCES EL Sistema DEBERÁ esperar un período de gracia adicional antes de marcarlo como no responsivo, para evitar falsos positivos por interrupciones de red transitorias.

### Requirement 9: Actualización remota de la playlist local

**User Story:** Como Head of Product & Engineering, quiero actualizar la playlist local asignada a una pantalla sin acceso físico al dispositivo, para poder iterar sobre el contenido de prueba durante el piloto.

#### Acceptance Criteria

1. EL Sistema DEBERÁ permitir modificar la playlist asignada a una pantalla desde una fuente central, sin necesidad de manipular directamente el sistema de archivos del dispositivo; las operaciones automatizadas del sistema de archivos (caché, archivos temporales) en el dispositivo como parte del proceso de actualización están permitidas siempre que no requieran intervención manual.
2. EL Player DEBERÁ adoptar la playlist actualizada en un tiempo razonable, sin requerir reinicio manual del dispositivo.
3. CUANDO el player recibe una actualización de playlist, ENTONCES EL Player DEBERÁ confirmar la adopción exitosa de la nueva playlist al sistema central; SI la adopción falla, ENTONCES EL Player DEBERÁ reportar la falla y continuar operando con la versión anterior de la playlist. SI la playlist se adopta exitosamente pero el mensaje de confirmación falla al enviarse, ENTONCES EL Player DEBERÁ tratar esto como un fallo de adopción y revertir a la versión anterior de la playlist.

### Requirement 10: Desactivación remota de una fuente específica (kill switch operativo)

**User Story:** Como Head of Product & Engineering, quiero desactivar remotamente una fuente de contenido específica (por ejemplo, GAM) para una pantalla, para poder reaccionar rápidamente a un problema con una fuente sin desplegar código nuevo.

#### Acceptance Criteria

1. EL Sistema DEBERÁ permitir desactivar remotamente cualquiera de las cuatro fuentes de contenido para una pantalla específica.
2. CUANDO una fuente está desactivada, EL Player DEBERÁ omitirla por completo en el loop, rellenando sus slots con playlist local.
3. EL Sistema DEBERÁ permitir reactivar una fuente previamente desactivada sin requerir ninguna acción distinta a revertir la misma configuración.

### Requirement 11: Administración de múltiples proveedores (tenants) por un super-admin

**User Story:** Como super-admin, quiero crear y administrar diferentes proveedores (tenants), cada uno con su propia credencial de acceso, para poder demostrar que el player soporta operar para múltiples media owners de forma independiente.

#### Acceptance Criteria

1. EL Sistema DEBERÁ permitir crear un nuevo tenant con un nombre identificable.
2. CUANDO se crea un tenant, EL Sistema DEBERÁ generar una credencial de acceso propia para ese tenant, distinta a la de cualquier otro tenant existente.
3. EL Sistema DEBERÁ permitir asignar una pantalla existente a un tenant específico.
4. EL Sistema DEBERÁ garantizar que el super-admin puede ver todos los tenants y todas las pantallas del sistema, sin restricción; no existen circunstancias bajo las cuales el acceso de un super-admin sea restringido. Los usuarios que no son super-admins NO DEBERÁN tener visibilidad alguna sobre tenants o pantallas fuera de su propio tenant asignado.

### Requirement 12: Administración de un tenant individual con visibilidad acotada

**User Story:** Como administrador de tenant, quiero ver y configurar únicamente las pantallas, playlists y fuentes activas pertenecientes a mi propio tenant, para que cada proveedor opere de forma independiente sin ver ni afectar la configuración de otros proveedores.

#### Acceptance Criteria

1. CUANDO un administrador de tenant inicia sesión, EL Sistema DEBERÁ mostrar únicamente las pantallas asignadas a ese tenant.
2. EL Sistema DEBERÁ permitir que un administrador de tenant edite la playlist, los toggles de fuentes activas, y la configuración de slots del loop únicamente de sus propias pantallas.
3. EL Sistema DEBERÁ garantizar que un administrador de tenant no puede ver ni modificar pantallas, playlists o configuración de otro tenant, bajo ninguna circunstancia — incluyendo durante el proceso de configuración del piloto.
4. EL Sistema DEBERÁ permitir configurar dos tenants de forma que uno tenga la fuente GAM activa y el otro la tenga desactivada, cada uno con su propia playlist, para demostrar la independencia entre ambos durante el piloto.

### Requirement 13: Estructura de monorepo con separación para deployment independiente

**User Story:** Como desarrollador del equipo, quiero que el proyecto esté organizado como un monorepo con separación clara entre backend y player, para poder desarrollar ambos componentes de forma coordinada durante el MVP pero con la posibilidad de dividirlos en repositorios independientes en el futuro.

#### Acceptance Criteria

1. EL Proyecto DEBERÁ organizarse como un monorepo único que contenga tanto el código del backend (Laravel) como el del player (JS/TS vanilla) en directorios separados a nivel raíz.
2. EL Proyecto DEBERÁ estructurar el código de forma que el backend pueda desplegarse de forma independiente hacia el ambiente de desarrollo local sin incluir artefactos del player.
3. EL Proyecto DEBERÁ estructurar el código de forma que el player pueda desplegarse de forma independiente hacia las Raspberry Pi sin incluir artefactos del backend.
4. EL Proyecto DEBERÁ garantizar que no existan dependencias de código compartido entre el directorio del backend y el directorio del player que impidan la separación futura en repositorios independientes; la comunicación entre ambos componentes DEBERÁ ser exclusivamente a través de APIs y contratos definidos.
5. CUANDO el proyecto alcance madurez post-MVP, EL Proyecto DEBERÁ poder dividirse en dos repositorios separados (backend y player) sin requerir refactorización significativa de la estructura interna de ninguno de los dos componentes.

### Requirement 14: Modo kiosko del player en Raspberry Pi

**User Story:** Como operador del sistema, quiero que el player en la Raspberry Pi funcione en modo kiosko bloqueado, para garantizar que las pantallas operen de forma continua sin que usuarios no autorizados puedan interrumpir la reproducción ni acceder al sistema operativo.

#### Acceptance Criteria

1. CUANDO la Raspberry Pi se enciende, EL Player DEBERÁ arrancar automáticamente en modo pantalla completa sin requerir intervención humana ni inicio de sesión manual.
2. MIENTRAS el player está en modo kiosko, EL Sistema_Operativo DEBERÁ bloquear toda interacción de teclado y mouse que permita salir del player, cerrar la ventana, cambiar de aplicación o acceder al sistema operativo subyacente.
3. CUANDO un usuario autorizado necesita acceder al sistema para mantenimiento o configuración, EL Sistema DEBERÁ requerir la introducción de una contraseña de desbloqueo antes de permitir la salida del modo kiosko.
4. SI el proceso del player se cierra inesperadamente (crash, error fatal, o terminación no autorizada), ENTONCES EL Sistema_Operativo DEBERÁ reiniciar automáticamente el proceso del player en un tiempo máximo de 10 segundos, garantizando la recuperación sin intervención humana.
5. EL Sistema DEBERÁ mantener la contraseña de desbloqueo del modo kiosko de forma segura en el dispositivo, sin almacenarla en texto plano en archivos de configuración accesibles.

### Requirement 15: Duración de reproducción por contenido

**User Story:** Como administrador de tenant, quiero poder definir cuánto tiempo se muestra el contenido estático en pantalla a distintos niveles (tenant, grupo de pantallas, pantalla individual), para controlar el ritmo de rotación y cumplir con los tiempos pactados con anunciantes según la ubicación geográfica o tipo de venue.

#### Acceptance Criteria

1. EL Sistema DEBERÁ permitir configurar una duración por defecto a nivel de tenant (en segundos) que aplique a todas las pantallas del tenant como valor base; el valor inicial por defecto es de 10 segundos para imágenes estáticas.
2. EL Sistema DEBERÁ permitir crear grupos de pantallas dentro de un tenant (por ejemplo, "CDMX - Centro Comercial X", "Estado de México - Plaza Y") y asignar una duración específica al grupo que sobreescriba el default del tenant para todas las pantallas pertenecientes a ese grupo.
3. EL Sistema DEBERÁ permitir asignar una duración individual a una pantalla específica que sobreescriba tanto el valor del grupo como el del tenant.
4. EL Player DEBERÁ resolver la duración aplicable usando herencia con override, donde el valor más específico gana: Pantalla individual > Grupo de pantallas > Tenant default.
5. PARA contenido de video (proveniente de cualquier fuente), EL Player DEBERÁ respetar la duración natural del video como tiempo de reproducción, sin cortarlo ni extenderlo, independientemente de la duración configurada.
6. PARA anuncios VAST de GAM, EL Player DEBERÁ respetar la duración definida en el XML del anuncio VAST, que viene especificada por Google y no es configurable por el tenant.
7. PARA contenido del API de Ad Serving de Prodooh, EL Player DEBERÁ respetar la duración indicada en la respuesta del API si ésta incluye un campo de duración; si no lo incluye, DEBERÁ usar la duración configurada según la herencia (pantalla > grupo > tenant).
8. EL Sistema DEBERÁ permitir que una pantalla pertenezca a un solo grupo a la vez; si se reasigna a otro grupo, la pantalla hereda inmediatamente la configuración del nuevo grupo.

### Requirement 16: Horarios de operación de las pantallas

**User Story:** Como administrador de tenant, quiero poder configurar los horarios en que cada pantalla opera y muestra contenido, para cumplir con las regulaciones o políticas del lugar donde están instaladas (centros comerciales, aeropuertos, oficinas).

#### Acceptance Criteria

1. EL Sistema DEBERÁ permitir configurar un horario de operación por pantalla, definido como una franja horaria de inicio y fin (por ejemplo, 10:00 a 22:00) con zona horaria explícita.
2. DENTRO del horario de operación, EL Player DEBERÁ funcionar normalmente reproduciendo contenido según la distribución de fuentes configurada.
3. FUERA del horario de operación, EL Player DEBERÁ dejar de reproducir contenido y mostrar una pantalla en negro o entrar en modo de reposo; si el hardware lo soporta (Samsung QM65C vía MDC), EL Sistema DEBERÁ enviar un comando de apagado a la pantalla.
4. CUANDO el horario de operación inicie nuevamente, EL Player DEBERÁ reanudar la reproducción automáticamente sin intervención humana; si la pantalla fue apagada vía MDC, EL Sistema DEBERÁ enviar un comando de encendido.
5. EL Sistema DEBERÁ soportar horarios distintos por día de la semana (por ejemplo, lunes a viernes de 08:00 a 20:00, sábados de 10:00 a 18:00, domingos apagado).
6. SI no se configura un horario de operación para una pantalla, ENTONCES EL Player DEBERÁ operar las 24 horas del día (comportamiento por defecto).
7. EL Sistema DEBERÁ permitir definir un horario de operación por defecto a nivel de tenant, que aplique a todas sus pantallas a menos que una pantalla tenga un override individual.

### Requirement 17: Screenshot remoto bajo demanda

**User Story:** Como administrador de tenant o super-admin, quiero poder solicitar un screenshot de lo que una pantalla está mostrando en tiempo real, para verificar remotamente que el contenido se está desplegando correctamente sin ir físicamente al sitio.

#### Acceptance Criteria

1. EL Sistema DEBERÁ permitir solicitar un screenshot bajo demanda para cualquier pantalla activa, desde el panel de administración.
2. CUANDO el player recibe la solicitud de screenshot, DEBERÁ capturar la imagen actual en pantalla y enviarla al backend en un tiempo máximo de 30 segundos.
3. EL Sistema DEBERÁ almacenar el screenshot capturado asociado a la pantalla con su timestamp, para consulta posterior.
4. EL Sistema DEBERÁ permitir al administrador del tenant ver screenshots únicamente de sus propias pantallas; el super-admin puede ver screenshots de cualquier pantalla.
5. SI el player no puede completar la captura (offline, error técnico), ENTONCES EL Sistema DEBERÁ notificar al solicitante que la captura falló, indicando el motivo.

### Requirement 18: Log de reproducción y analytics por arte

**User Story:** Como administrador de tenant, quiero tener un registro detallado de cada arte/spot reproducido en cada pantalla, para poder reportar a mis anunciantes cuántos spots tuvo cada campaña y generar reportes de analytics confiables.

#### Acceptance Criteria

1. EL Player DEBERÁ registrar localmente cada reproducción individual con: identificador del arte/contenido, fuente de origen (Prodooh API, GAM, Playlist local), timestamp de inicio y fin de reproducción, duración real, y resultado (exitoso o fallido).
2. EL Player DEBERÁ sincronizar periódicamente su log de reproducción local con el backend central; si pierde conectividad, DEBERÁ acumular los registros localmente y enviarlos cuando se restablezca la conexión.
3. EL Sistema DEBERÁ permitir consultar, para un rango de fechas dado: total de spots reproducidos por pantalla, desglosado por fuente de contenido y por arte/campaña individual.
4. EL Sistema DEBERÁ permitir al administrador del tenant exportar o consultar los reportes de reproducción únicamente de sus propias pantallas.
5. EL Sistema DEBERÁ garantizar que un registro de reproducción nunca se pierde: si el envío al backend falla, el log local actúa como fuente de verdad y se reintenta hasta confirmar la recepción.

### Requirement 19: Preview de contenido antes de publicar

**User Story:** Como administrador de tenant, quiero poder previsualizar cómo se verá un contenido en pantalla antes de asignarlo a una playlist o publicarlo, para evitar errores de formato, resolución o proporción que se detectarían demasiado tarde.

#### Acceptance Criteria

1. EL Sistema DEBERÁ ofrecer una vista de preview que renderice el contenido con las dimensiones y orientación reales de la pantalla destino (por ejemplo, 3840x2160 horizontal o 2160x3840 vertical).
2. EL Sistema DEBERÁ permitir previsualizar tanto imágenes estáticas como videos antes de agregarlos a la playlist.
3. EL Sistema DEBERÁ mostrar en el preview información relevante: resolución del arte, duración (si es video), formato de archivo, y si hay discrepancia con la resolución/orientación de la pantalla destino.
4. SI el contenido no coincide con la orientación o resolución de la pantalla destino, ENTONCES EL Sistema DEBERÁ mostrar una advertencia visual indicando la discrepancia antes de permitir la publicación.

### Requirement 20: Resolución y orientación de pantalla configurable

**User Story:** Como administrador de tenant, quiero poder configurar la resolución y orientación (horizontal/vertical) de cada pantalla, para que el player ajuste la reproducción correctamente según cómo esté instalado físicamente el monitor.

#### Acceptance Criteria

1. EL Sistema DEBERÁ permitir configurar por cada pantalla: resolución nativa (ancho x alto en píxeles) y orientación (horizontal/landscape o vertical/portrait).
2. EL Player DEBERÁ ajustar la rotación del contenido según la orientación configurada para la pantalla, garantizando que el contenido se muestre correctamente sin importar la posición física del monitor.
3. EL Sistema DEBERÁ validar que el contenido asignado a una pantalla sea compatible con su orientación configurada; SI hay incompatibilidad, ENTONCES DEBERÁ mostrar una advertencia al administrador.
4. EL Sistema DEBERÁ permitir definir una resolución y orientación por defecto a nivel de grupo de pantallas, con override posible a nivel de pantalla individual.

### Requirement 21: Formatos soportados con validación al subir contenido

**User Story:** Como administrador de tenant, quiero que el sistema valide automáticamente que los archivos que subo son compatibles con las pantallas, para evitar que contenido no reproducible llegue a las pantallas y cause errores o pantallas en negro.

#### Acceptance Criteria

1. EL Sistema DEBERÁ definir y documentar una lista explícita de formatos soportados: imágenes (JPEG, PNG, WebP), videos (MP4 con codec H.264, MP4 con codec H.265/HEVC), y contenido web (HTML5 autocontenido).
2. CUANDO un usuario sube contenido a la biblioteca, EL Sistema DEBERÁ validar automáticamente: formato de archivo, codec de video (si aplica), resolución, y tamaño de archivo.
3. SI el contenido no cumple con los formatos soportados, ENTONCES EL Sistema DEBERÁ rechazar la carga y mostrar un mensaje claro indicando qué requisito no se cumple y cuáles son los formatos aceptados.
4. EL Sistema DEBERÁ definir un tamaño máximo de archivo permitido por tipo (configurable por el super-admin) para evitar saturar el almacenamiento de las Raspberry Pi.
5. EL Sistema DEBERÁ validar que el codec del video sea reproducible por el hardware de la Raspberry Pi 5 (decodificación hardware H.264/H.265 4K60).

### Requirement 22: Gestión de almacenamiento y limpieza automática

**User Story:** Como operador del sistema, quiero que el player gestione automáticamente su espacio de almacenamiento local, para evitar que las Raspberry Pi se queden sin espacio y dejen de funcionar.

#### Acceptance Criteria

1. EL Player DEBERÁ monitorear periódicamente el espacio disponible en su almacenamiento local y reportar este dato al backend como parte de su heartbeat.
2. CUANDO el espacio disponible baje de un umbral configurable (por defecto 20% del total), ENTONCES EL Player DEBERÁ ejecutar una limpieza automática de caché, eliminando contenido descargado que ya no forma parte de la playlist activa, usando una estrategia LRU (least recently used).
3. EL Player DEBERÁ garantizar que la limpieza automática NUNCA elimine contenido que forme parte de la playlist activa actual ni el buffer de respaldo en memoria.
4. SI después de la limpieza automática el espacio sigue por debajo del umbral crítico (por defecto 10%), ENTONCES EL Player DEBERÁ reportar una alerta al backend indicando almacenamiento críticamente bajo.
5. EL Sistema DEBERÁ mostrar en el panel de administración el estado de almacenamiento de cada pantalla, con indicadores visuales de estado (normal, advertencia, crítico).

### Requirement 23: Transiciones animadas configurables entre contenidos

**User Story:** Como administrador de tenant, quiero poder elegir el tipo de transición visual entre contenidos, para dar una apariencia profesional y pulida a la experiencia visual de las pantallas.

#### Acceptance Criteria

1. EL Player DEBERÁ soportar al menos tres tipos de transición: corte directo (sin animación), fundido (fade in/out), y deslizamiento (slide horizontal).
2. EL Sistema DEBERÁ permitir configurar el tipo de transición a nivel de tenant (aplica a todas sus pantallas como default) con override posible por pantalla individual.
3. EL Player DEBERÁ ejecutar la transición configurada entre cada pieza de contenido, independientemente de la fuente de origen del contenido entrante y saliente.
4. EL Sistema DEBERÁ permitir configurar la duración de la transición (por defecto 500ms), dentro de un rango de 200ms a 2000ms.
5. EL Player DEBERÁ garantizar que la transición animada no introduce frames en negro ni artefactos visuales entre contenidos.

### Requirement 24: Rotación de artes ya subidos al backend

**User Story:** Como administrador de tenant, quiero poder rotar (90°, 180°, 270°) un arte que ya fue subido a la biblioteca, para ajustarlo a la orientación de la pantalla destino sin necesidad de re-subir el archivo original editado externamente.

#### Acceptance Criteria

1. EL Sistema DEBERÁ permitir aplicar una rotación (0°, 90°, 180°, 270°) a cualquier arte de imagen almacenado en la biblioteca del tenant.
2. EL Sistema DEBERÁ almacenar la rotación como metadata del arte (no modificar el archivo original), de modo que el archivo fuente se conserva intacto.
3. EL Player DEBERÁ aplicar la rotación configurada al momento de renderizar el contenido en pantalla, respetando la orientación indicada.
4. EL Sistema DEBERÁ actualizar el preview del arte para reflejar la rotación aplicada, de forma que el administrador vea cómo se verá en pantalla.
5. PARA contenido de video, EL Sistema DEBERÁ permitir la rotación únicamente si el video no está actualmente asignado a una playlist activa, mostrando advertencia si se intenta rotar contenido en uso.

### Requirement 25: Contenido precargado de fábrica (branding Prodooh)

**User Story:** Como operador del sistema, quiero que cada player venga con contenido de marca Prodooh precargado (al menos una animación vertical y una horizontal), para que al encender un dispositivo nuevo tenga algo que mostrar inmediatamente mientras se completa la configuración y sincronización inicial.

#### Acceptance Criteria

1. EL Player DEBERÁ incluir de fábrica al menos dos piezas de contenido precargado: una animación de marca Prodooh en orientación vertical (portrait) y una en orientación horizontal (landscape).
2. CUANDO el dispositivo arranca por primera vez y aún no ha completado su primera sincronización de playlist, EL Player DEBERÁ reproducir el contenido precargado correspondiente a la orientación configurada de la pantalla.
3. EL contenido precargado DEBERÁ funcionar como el respaldo de última instancia: si la playlist local está vacía y no hay conectividad, el player reproduce el contenido precargado en vez de mostrar pantalla en negro.
4. CUANDO el player recibe y adopta su primera playlist real, EL contenido precargado DEBERÁ dejar de mostrarse en la rotación normal, pero permanecer almacenado en el dispositivo como respaldo de emergencia.
5. EL Sistema DEBERÁ permitir al super-admin actualizar el contenido precargado que se incluye en nuevos dispositivos aprovisionados.

### Requirement 26: Biblioteca de contenido del tenant con asignación a pantallas

**User Story:** Como administrador de tenant, quiero poder subir artes a una biblioteca centralizada de mi tenant y luego asignarlos a una o varias pantallas a la vez, para gestionar el contenido de forma eficiente sin duplicar archivos ni configurar pantalla por pantalla.

#### Acceptance Criteria

1. EL Sistema DEBERÁ proveer una biblioteca de contenido por tenant donde el administrador puede subir, organizar y gestionar todos sus artes (imágenes y videos).
2. EL Sistema DEBERÁ validar al momento de subir: formato soportado, resolución, codec (si es video), tamaño de archivo, y orientación del contenido.
3. EL Sistema DEBERÁ permitir asignar un arte de la biblioteca a una o múltiples pantallas simultáneamente, agregándolo a la playlist local de cada pantalla seleccionada en una sola operación.
4. CUANDO se asigna un arte a una pantalla, EL Sistema DEBERÁ validar que la orientación del contenido sea compatible con la orientación configurada de la pantalla destino; SI hay incompatibilidad, ENTONCES DEBERÁ mostrar una advertencia y solicitar confirmación antes de proceder.
5. EL Sistema DEBERÁ permitir filtrar pantallas por grupo, tags o nombre al momento de asignar contenido, para facilitar operaciones masivas.
6. EL Sistema DEBERÁ garantizar que un arte en la biblioteca solo se almacena una vez a nivel de backend, independientemente de cuántas pantallas lo tengan asignado (no se duplica el archivo por cada pantalla).
7. CUANDO un arte se elimina de la biblioteca, EL Sistema DEBERÁ removerlo automáticamente de todas las playlists donde esté asignado y notificar al administrador cuántas pantallas fueron afectadas.

### Requirement 27: Fuente de contenido por URL (Web Content Source)

**User Story:** Como administrador de tenant, quiero poder configurar una o más URLs como fuente de contenido independiente con slots asignados en el loop, para poder mostrar dashboards, menús, redes sociales u otro contenido web en vivo como parte del ciclo de reproducción con su propio share of voice.

#### Acceptance Criteria

1. EL Sistema DEBERÁ soportar "URL" como una cuarta fuente de contenido en el loop, con slots asignados según la configuración; la distribución por defecto en esta fase es 25% para cada fuente (Prodooh API, GAM, URL, Playlist local) es decir 1 slot cada una en un loop de 4 slots.
2. EL Sistema DEBERÁ permitir configurar una o múltiples URLs dentro de la fuente URL, que rotarán internamente entre sí cuando le corresponda el turno a esta fuente (una "playlist de URLs" propia de la fuente).
3. PARA cada URL configurada, EL Sistema DEBERÁ permitir definir: URL de destino, duración del slot (cuánto tiempo se muestra antes de pasar a la siguiente), e intervalo de refresh opcional (cada cuánto se recarga la página mientras está visible).
4. CUANDO le corresponde el turno a la fuente URL, EL Player DEBERÁ cargar la URL configurada en un webview/navegador embebido a pantalla completa y mostrarla por la duración del slot definido.
5. SI la URL no carga dentro de un tiempo máximo configurable (timeout por defecto 10 segundos), ENTONCES EL Player DEBERÁ saltar a la siguiente fuente activa en la rotación, sin quedar bloqueado.
6. EL Sistema DEBERÁ permitir inyectar variables dinámicas en la URL (como venue_id, tenant_id, timestamp) para personalizar el contenido web por pantalla sin necesidad de crear URLs distintas manualmente.
7. SI la fuente URL está desactivada (toggle off), ENTONCES EL Sistema DEBERÁ reasignar sus slots en el loop a la playlist local.

### Requirement 28: Soporte de URLs como ítems dentro de la playlist local

**User Story:** Como administrador de tenant, quiero poder incluir URLs (páginas web) como ítems dentro de la playlist local junto con fotos y videos, para tener flexibilidad total sobre el tipo de contenido que mis pantallas muestran en el slot de playlist.

#### Acceptance Criteria

1. EL Sistema DEBERÁ soportar tres tipos de ítems dentro de una playlist: imágenes (JPEG, PNG, WebP), videos (MP4 H.264/H.265), y URLs (páginas web).
2. PARA cada ítem tipo URL en la playlist, EL Sistema DEBERÁ permitir configurar: URL de destino, duración del slot, e intervalo de refresh opcional.
3. CUANDO el player reproduce un ítem tipo URL de la playlist, DEBERÁ cargarlo en un webview/navegador embebido a pantalla completa, respetando la duración configurada para ese ítem.
4. SI un ítem tipo URL no carga dentro del timeout definido, ENTONCES EL Player DEBERÁ saltar al siguiente ítem de la playlist sin demora perceptible.
5. EL Player DEBERÁ poder alternar sin problemas entre ítems de distintos tipos dentro de la misma playlist (por ejemplo: imagen → video → URL → imagen) sin frames en negro ni artefactos visuales entre transiciones.
6. EL Sistema DEBERÁ validar que la URL ingresada tenga un formato válido (protocolo HTTP/HTTPS) antes de permitir agregarla a la playlist.
7. EL Sistema DEBERÁ permitir previsualizar un ítem tipo URL en el panel de administración antes de agregarlo a la playlist, mostrando cómo se renderizaría en las dimensiones de la pantalla destino.
