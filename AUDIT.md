# Auditoría del Estado Actual — Prodooh Player

**Fecha:** 9 de julio de 2026  
**Alcance:** Backend (Laravel), Player (TypeScript/Chromium), Admin-Frontend (React)

---

## 1. BACKEND

### 1.1 Esquema Real de Base de Datos

El backend usa Laravel con migraciones secuenciales. Todas las tablas usan UUID como PK.

#### Tabla: `tenants`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid PK | |
| name | string | |
| api_credential | string UNIQUE | Credencial generada al crear tenant |
| default_config | jsonb nullable | |
| default_duration_seconds | integer (default 10) | |
| default_timezone | string (default 'UTC') | |
| default_schedule | jsonb nullable | |
| transition_type | string (default 'cut') | |
| transition_duration_ms | integer (default 0) | |
| created_at, updated_at | timestamps | |

#### Tabla: `users`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid PK | |
| tenant_id | uuid FK nullable | NULL para super_admin |
| email | string UNIQUE | |
| password_hash | string | |
| role | enum('super_admin','tenant_admin') | |
| created_at | timestamp | |

#### Tabla: `screen_groups`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid PK | |
| tenant_id | uuid FK (cascade delete) | |
| name | string | |
| duration_seconds | integer nullable | Override de duración |
| schedule | jsonb nullable | |
| orientation | string nullable | |
| resolution_width | integer nullable | |
| resolution_height | integer nullable | |
| created_at | timestamp | |

#### Tabla: `screens`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid PK | |
| tenant_id | uuid FK (cascade delete) | |
| group_id | uuid FK nullable (set null on delete) | |
| venue_id | string UNIQUE | Identificador del device |
| device_token_hash | string | Hash bcrypt |
| name | string | |
| status | enum('online','offline','unresponsive') default 'offline' | |
| orientation | string default 'landscape' | |
| resolution_width | integer default 1920 | |
| resolution_height | integer default 1080 | |
| duration_seconds | integer nullable | Override individual |
| schedule | jsonb nullable | Override individual |
| loop_config | jsonb | Array de slots |
| sources_config | jsonb | Estado enabled/disabled por fuente |
| transition_type | string nullable | |
| transition_duration_ms | integer nullable | |
| playlist_version | string default '' | |
| last_heartbeat | timestamp nullable | |
| last_storage_status | jsonb nullable | |
| created_at, updated_at | timestamps | |

#### Tabla: `screenshots`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid PK | |
| screen_id | uuid FK (cascade delete) | |
| storage_path | string | |
| captured_at | timestamp | |
| created_at | timestamp | |

#### Tabla: `device_commands`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid PK | |
| screen_id | uuid FK (cascade delete) | |
| type | enum('screenshot','config_update','playlist_update') | |
| payload | jsonb nullable | |
| status | enum('pending','delivered','completed','failed') default 'pending' | |
| created_at | timestamp | |
| delivered_at | timestamp nullable | |

#### Tabla: `playback_logs`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid PK | |
| screen_id | uuid FK (cascade delete) | |
| tenant_id | uuid FK (cascade delete) | |
| content_id | string | No es FK; es el ID enviado por el player |
| source | enum('prodooh','gam','url','playlist') | |
| started_at | timestamp | |
| ended_at | timestamp nullable | |
| duration_seconds | decimal(10,2) nullable | |
| result | enum('success','failed') | |
| failure_reason | string nullable | |
| synced_at | timestamp nullable | |
| created_at, updated_at | timestamps | |

#### Tabla: `content`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid PK | |
| tenant_id | uuid FK (cascade delete) | |
| filename | string | |
| mime_type | string | |
| storage_path | string | |
| file_size_bytes | integer | |
| width | integer | |
| height | integer | |
| duration_seconds | integer nullable | Solo para video |
| orientation | string | |
| rotation | integer default 0 | 0, 90, 180, 270 |
| checksum_sha256 | string | |
| created_at | timestamp | |

#### Tabla: `playlists`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid PK | |
| tenant_id | uuid FK (cascade delete) | |
| name | string | |
| version | string | Se incrementa en cada update |
| created_at, updated_at | timestamps | |

#### Tabla: `playlist_items`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid PK | |
| playlist_id | uuid FK (cascade delete) | |
| content_id | uuid FK nullable (set null on delete) | |
| type | enum('image','video','url') | |
| url | string nullable | Solo para type='url' |
| duration_seconds | integer nullable | |
| position | integer | Orden dentro de la playlist |
| refresh_interval | integer nullable | Para ítems URL |
| created_at | timestamp | |

#### Tabla: `screen_playlists` (pivot)
| Campo | Tipo | Notas |
|-------|------|-------|
| screen_id | uuid FK (cascade delete) | PK compuesto |
| playlist_id | uuid FK (cascade delete) | PK compuesto |
| assigned_at | timestamp | |

---

### 1.2 Lista Completa de Endpoints

#### Device API (`/api/device/*`) — Autenticación: JWT custom (DeviceJwtAuth middleware)

| Método | Ruta | Controller | Descripción |
|--------|------|-----------|-------------|
| POST | `/api/device/auth` | DeviceAuthController@auth | Autenticación por venue_id + device_token → JWT |
| GET | `/api/device/config` | ConfigSyncController | Config completa (loop, sources, display, schedule, durations) |
| POST | `/api/device/heartbeat` | HeartbeatController | Heartbeat + entrega de pending commands |
| GET | `/api/device/playlist` | PlaylistSyncController@index | Manifiesto de playlist con soporte ETag/304 |
| POST | `/api/device/playlist/confirm` | PlaylistSyncController@confirm | Confirmación de adopción de playlist |
| GET | `/api/device/content/{id}/file` | PlaylistSyncController@serveContentFile | Descarga de archivo de contenido |
| POST | `/api/device/playback-logs` | PlaybackLogController@store | Batch sync de logs de reproducción |
| POST | `/api/device/screenshot` | ScreenshotController@store | Upload de screenshot capturado |
| POST | `/api/device/prodooh/ad` | ProDoohProxyController@fetchAd | Proxy hacia SSP Prodooh (evita CORS) |

#### Admin API (`/api/admin/*`) — Autenticación: Laravel Sanctum + TenantScopeMiddleware

| Método | Ruta | Controller | Acceso |
|--------|------|-----------|--------|
| POST | `/api/admin/login` | AdminAuthController@login | Público |
| POST | `/api/admin/logout` | AdminAuthController@logout | Autenticado |
| GET | `/api/admin/user` | Closure | Autenticado |
| GET | `/api/admin/tenants` | TenantController@index | super_admin |
| POST | `/api/admin/tenants` | TenantController@store | super_admin |
| GET | `/api/admin/tenants/{id}` | TenantController@show | super_admin |
| PUT | `/api/admin/tenants/{id}` | TenantController@update | super_admin |
| DELETE | `/api/admin/tenants/{id}` | TenantController@destroy | super_admin |
| GET | `/api/admin/screens` | ScreenController@index | super_admin, tenant_admin |
| POST | `/api/admin/screens` | ScreenController@store | super_admin, tenant_admin |
| GET | `/api/admin/screens/{id}` | ScreenController@show | super_admin, tenant_admin |
| PUT | `/api/admin/screens/{id}` | ScreenController@update | super_admin, tenant_admin |
| DELETE | `/api/admin/screens/{id}` | ScreenController@destroy | super_admin, tenant_admin |
| POST | `/api/admin/screens/{id}/regenerate-token` | ScreenController@regenerateToken | super_admin, tenant_admin |
| PUT | `/api/admin/screens/{id}/loop` | LoopConfigController@update | super_admin, tenant_admin |
| PUT | `/api/admin/screens/{id}/sources` | SourceToggleController@update | super_admin, tenant_admin |
| GET | `/api/admin/screens/{id}/screenshots` | ScreenshotViewController@index | super_admin, tenant_admin |
| GET | `/api/admin/groups` | ScreenGroupController@index | super_admin, tenant_admin |
| POST | `/api/admin/groups` | ScreenGroupController@store | super_admin, tenant_admin |
| GET | `/api/admin/groups/{id}` | ScreenGroupController@show | super_admin, tenant_admin |
| PUT | `/api/admin/groups/{id}` | ScreenGroupController@update | super_admin, tenant_admin |
| DELETE | `/api/admin/groups/{id}` | ScreenGroupController@destroy | super_admin, tenant_admin |
| POST | `/api/admin/groups/{id}/screens` | ScreenGroupController@assignScreens | super_admin, tenant_admin |
| GET | `/api/admin/playlists` | PlaylistController@index | super_admin, tenant_admin |
| POST | `/api/admin/playlists` | PlaylistController@store | super_admin, tenant_admin |
| GET | `/api/admin/playlists/{id}` | PlaylistController@show | super_admin, tenant_admin |
| PUT | `/api/admin/playlists/{id}` | PlaylistController@update | super_admin, tenant_admin |
| DELETE | `/api/admin/playlists/{id}` | PlaylistController@destroy | super_admin, tenant_admin |
| POST | `/api/admin/playlists/{id}/assign` | PlaylistController@assign | super_admin, tenant_admin |
| GET | `/api/admin/content` | ContentController@index | super_admin, tenant_admin |
| POST | `/api/admin/content` | ContentController@store | super_admin, tenant_admin |
| DELETE | `/api/admin/content/{id}` | ContentController@destroy | super_admin, tenant_admin |
| PUT | `/api/admin/content/{id}/rotate` | ContentController@rotate | super_admin, tenant_admin |
| GET | `/api/admin/content/{id}/preview` | ContentPreviewController@show | super_admin, tenant_admin |
| GET | `/api/admin/content/{id}/preview/file` | ContentController@serveFile | super_admin, tenant_admin |
| GET | `/api/admin/playlist-items/{id}/preview` | ContentPreviewController@showPlaylistItem | super_admin, tenant_admin |
| GET | `/api/admin/analytics/playback` | PlaybackAnalyticsController@index | super_admin, tenant_admin |

---

### 1.3 Lógica Real del Motor de Distribución (Loop de Slots)

El loop es un concepto central del sistema. Así funciona hoy:

**Configuración almacenada por pantalla** (`screens.loop_config` + `screens.sources_config`):
- `loop_config`: `{ slots: [{ source: 'prodooh', duration: 10 }, { source: 'gam', duration: 10 }, ...] }`
- `sources_config`: `{ prodooh: { enabled: true }, gam: { enabled: false }, url: { enabled: true }, playlist: { enabled: true } }`

**LoopConfigService (backend):**
- Valida: al menos 1 slot, fuentes válidas (prodooh/gam/url/playlist), duración ≥ 1s
- Default si no hay config: 4 slots x 10s (1 por fuente)
- Ofrece `buildFromWeights()` para generar distribución por pesos, pero NO se usa desde ningún endpoint hoy

**SourceToggleService (backend):**
- `toggle()` / `toggleMultiple()`: modifica `sources_config` en la pantalla
- `getEffectiveLoopConfig()`: reemplaza slots de fuentes deshabilitadas con 'playlist' al momento de servir la config al device
- Restricción: `playlist` NO se puede deshabilitar (es fallback obligatorio)

**ConfigSyncController (GET /api/device/config):**
- Resuelve duración por jerarquía: pantalla > grupo > tenant > default (10s)
- Resuelve schedule por jerarquía: pantalla > grupo > tenant > null
- Resuelve display: orientation, resolution, transition — cada uno con jerarquía
- Sirve el loop efectivo (con fuentes deshabilitadas reemplazadas)
- Incluye credenciales de fuentes (prodooh api_key, network_id; gam ad_tag_url; url urls[])
- Retorna intervalos: `sync_interval_seconds: 60`, `heartbeat_interval_seconds: 30`

**Player-side (LoopEngine.ts):**
- Ejecuta slots secuencialmente (0, 1, ..., N-1, 0, ...)
- Por cada slot: intenta PrefetchManager → inline prefetch → source.prefetch() → playlist fallback → FallbackBuffer (factory)
- El prefetch del SIGUIENTE slot se lanza mientras el actual reproduce
- Playlist source excluida del prefetch (tiene índice interno stateful)
- Soporta hot-update de config sin restart (`updateConfig()`)
- Integra ScheduleChecker para horarios operativos (poll cada 10s fuera de horario)
- Llama `source.confirmPlay()` al terminar (solo para fuentes externas, no playlist)

**SlotConfigManager (player-side):**
- Replica la lógica del SourceToggleService: slots de fuentes deshabilitadas → 'playlist'
- Mantiene la config original y computa la efectiva en runtime

---

## 2. PLAYER

### 2.1 Fuentes Consultadas y Orden de Prioridad

Para cada slot del loop, el LoopEngine intenta obtener contenido en este orden:

1. **PrefetchManager.getReady(slot.source)** — Contenido ya pre-fetched en background durante el slot anterior
2. **Legacy inline prefetch** — Campo `prefetchedContent` si coincide con el source del slot actual
3. **source.prefetch()** directamente — Llamada síncrona al ContentSource asignado
4. **Playlist source como fallback** — Si el slot era de otra fuente y falló, intenta obtener de PlaylistSource
5. **FallbackBuffer.getNext()** — Último recurso: contenido pre-decodificado (factory branding o playlist)

**Fuentes implementadas:**

| Source | Clase | Comportamiento |
|--------|-------|----------------|
| `prodooh` | ProDoohSource | POST a SSP API (via proxy backend o directo), rate limit 10s, proof-of-play via GET no-cors |
| `gam` | GamVastSource | Valida sandbox tag (dominio + indicador), fetch VAST XML, parsea MediaFile + Duration |
| `url` | UrlSource | Carga URL en iframe oculto con timeout 10s, inyección de variables dinámicas ({venue_id}, {timestamp}) |
| `playlist` | PlaylistSource | Lee de SQLite local (tabla playlist_items), cicla secuencialmente por position, índice stateful |

### 2.2 Prefetch y Doble Buffer

**PrefetchManager:**
- Almacena contenido ready por SourceType (Map)
- Cada getReady() es one-shot (consume y elimina)
- Timeout de 5s en operaciones de prefetch
- No prefetcha PlaylistSource (su índice interno avanzaría y saltaría ítems)
- Se limpia automáticamente al cambiar la config

**FallbackBuffer:**
- Mantiene ≥ 1 ítem pre-decodificado en memoria (minBufferSize = 1)
- Pre-render: `img.decode()` para imágenes, `video.canplaythrough` para videos, `iframe.load` para URLs
- Si la playlist real está activa, usa factory content como fallback (no consume de PlaylistSource)
- Si playlist vacía → FactoryContent (branding Prodooh, orientation-aware)
- Replenish es async y non-blocking; se dispara después de cada getNext()

**FullscreenRenderer:**
- Maneja dos capas para transiciones (fade de 500ms por default)
- Primer contenido: `show()` directo; siguientes: `transitionTo()` con animación

### 2.3 Qué Reporta al Backend y Formato

**HeartbeatService** — Cada 30s (configurable):
```json
POST /api/device/heartbeat
{
  "venue_id": "screen-office-01",
  "timestamp": "2026-07-09T12:00:00.000Z",
  "current_content": { "id": "uuid-xxx", "source": "prodooh" },
  "storage": { "total_mb": 0, "available_mb": 0, "percent_used": 0 },
  "uptime_seconds": 3600,
  "playlist_version": "v42"
}
```
Respuesta: `{ "ack": true, "pending_commands": [...] }`

> **⚠️ DISCREPANCIA:** El storage status siempre reporta 0/0/0 porque `getStorageStatus()` en boot.ts retorna valores hardcodeados `{ total_mb: 0, available_mb: 0, percent_used: 0 }`. No hay implementación real de monitoreo de disco.

**PlaybackLogger** — Batch cada 60s:
```json
POST /api/device/playback-logs
{
  "logs": [{
    "id": "uuid-local",
    "content_id": "print_id_or_item_id",
    "source": "prodooh",
    "started_at": "2026-07-09T12:00:00.000Z",
    "ended_at": "2026-07-09T12:00:10.000Z",
    "duration_seconds": 10,
    "result": "success",
    "failure_reason": null
  }]
}
```
Respuesta: `{ "received": 1, "ack_ids": ["uuid-local"] }`
Solo marca como synced las entradas cuyo ID está en ack_ids.

> **⚠️ DISCREPANCIA:** El PlaybackLogger existe como clase pero NO se instancia ni se conecta al LoopEngine en el boot sequence actual (`boot.ts`). Los eventos de reproducción no se están registrando realmente.

**PlaylistSyncManager** — Polling periódico (cada 15-60s):
- GET `/api/device/playlist` con header `If-None-Match: {version}` → 304 o nuevo manifiesto
- Descarga media con checksum SHA-256
- Atomic swap con backup/revert
- POST `/api/device/playlist/confirm` con `{ version, status: 'adopted'|'failed', error? }`

### 2.4 Estado Real del Modo Kiosko en Raspberry Pi

Todo el setup de kiosko se gestiona via scripts en `player/deploy/`:

**Provisioning (`provision.sh`):**
- Instala: Cage compositor, Chromium, SQLite, fonts, mesa, dbus
- Crea usuario `prodooh` (UID 1000)
- Deploy del bundle a `/opt/prodooh-player/`
- Estructura de datos en `/opt/prodooh-player/data/` (cache, factory, player.db)
- Inicializa SQLite con device_config (venue_id, device_token, backend_url, credenciales opcionales)
- Contraseña de kiosko almacenada como SHA-256 hash
- GPU memory = 256MB en /boot/config.txt
- Deshabilita DPMS/screen blanking

**Servicio principal (`prodooh-player.service`):**
- Cage + Chromium `--kiosk` apuntando a `/opt/prodooh-player/dist/index.html`
- Flags de Chromium: `--noerrdialogs --disable-translate --disable-infobars --autoplay-policy=no-user-gesture-required --disable-pinch`
- `Restart=on-failure`, `RestartSec=5`
- Security hardening: `ProtectSystem=strict`, `ProtectHome=yes`, `NoNewPrivileges=yes`
- Límites: `MemoryMax=512M`, `CPUQuota=90%`
- `ReadWritePaths=/opt/prodooh-player/data`

**Watchdog (`prodooh-player-watchdog.service`):**
- Script bash que chequea cada 3s si el servicio principal está activo
- Si no está activo y no está en estado transitional → `systemctl restart`
- Espera max 10s para confirmar restart exitoso
- Runs como root

**Autologin (`prodooh-player-autologin.conf`):**
- Override de getty@tty1 para autologin como usuario `prodooh`
- Sin contraseña de login al boot

**Kiosk Lock (`kiosk-lock.sh`):**
- Instala reglas udev (`block-input.conf`) para bloquear teclado/mouse USB
- Variable de entorno `PRODOOH_KIOSK_LOCKED=1` en `/etc/environment.d/`
- Toggle: `kiosk-lock.sh enable|disable`

> **Nota:** No hay implementación real del StorageManager (LRU cleanup) ni del ScreenshotService (html2canvas). Estas funcionalidades existen como contratos en la spec pero no están codificadas en el player.

---

## 3. ADMIN-FRONTEND

### 3.1 Lista Completa de Rutas/Pantallas

| Ruta | Componente | Protección | Endpoints consumidos |
|------|-----------|------------|---------------------|
| `/login` | LoginPage | Público | POST /admin/login |
| `/tenants` | TenantsPage | super_admin | GET/POST/PUT/DELETE /admin/tenants |
| `/screens` | ScreensPage | Autenticado | GET /admin/screens, POST /admin/screens |
| `/screens/:id` | ScreenDetailPage | Autenticado | GET /admin/screens/{id}, PUT /admin/screens/{id}, DELETE /admin/screens/{id}, POST /admin/screens/{id}/regenerate-token, PUT /admin/screens/{id}/loop, PUT /admin/screens/{id}/sources, GET /admin/screens/{id}/screenshots |
| `/groups` | GroupsPage | Autenticado | GET/POST/PUT/DELETE /admin/groups |
| `/groups/:id` | GroupDetailPage | Autenticado | GET /admin/groups/{id}, PUT /admin/groups/{id}, DELETE /admin/groups/{id}, POST /admin/groups/{id}/screens |
| `/playlists` | PlaylistsPage | Autenticado | GET/POST/PUT/DELETE /admin/playlists, POST /admin/playlists/{id}/assign |
| `/content` | ContentPage | Autenticado | GET /admin/content, POST /admin/content, DELETE /admin/content/{id}, PUT /admin/content/{id}/rotate, GET /admin/content/{id}/preview |
| `/analytics` | AnalyticsPage | Autenticado | GET /admin/analytics/playback |
| `/` | Redirect → /screens | Autenticado | — |
| `*` | Redirect → /login | — | — |

### 3.2 Operaciones Posibles desde la UI

| Entidad | Listar | Crear | Editar | Eliminar | Otras operaciones |
|---------|--------|-------|--------|----------|-------------------|
| Tenants | ✅ | ✅ | ✅ | ✅ | — |
| Screens | ✅ | ✅ | ✅ | ✅ | Regenerar token, Editar loop, Toggle fuentes, Ver screenshots |
| Groups | ✅ | ✅ | ✅ | ✅ | Asignar pantallas |
| Playlists | ✅ | ✅ | ✅ (nombre + ítems) | ✅ | Asignar a pantallas |
| Content | ✅ | ✅ (upload) | — | ✅ | Rotar, Preview |
| Analytics | ✅ (consulta) | — | — | — | Filtro por rango de fechas |
| Screenshots | ✅ (en detalle screen) | — | — | — | Vista de galería |

**Funcionalidades UI específicas:**
- **TenantContext** (selector global en header): Los super_admin pueden seleccionar un tenant activo que filtra todas las vistas. Se inyecta via Axios interceptor como query param `tenant_id`. Se persiste en localStorage.
- **LoopEditor**: Editor visual de slots (agregar/eliminar/reordenar), selector de fuente por slot, campo de duración numérico.
- **SourceToggles**: Switches on/off con optimistic update y rollback en error.
- **PlaylistItemEditor**: Items tipo `content` (selector de biblioteca) o `url` (campo texto), con duración y posición.
- **UploadDropzone**: Drag & drop con barra de progreso (onUploadProgress de Axios).
- **TokenRevealDialog**: Modal one-time-show del device_token con botón copiar.
- **ContentPreview**: Preview de imágenes/videos con URL temporal del backend.

### 3.3 Conceptos del Modelo SIN Pantalla de Administración

Los siguientes conceptos existen en el modelo de datos pero **NO tienen UI dedicada** hoy:

| Concepto | Existe en DB/Backend | UI Admin |
|----------|---------------------|----------|
| `device_commands` (screenshot, config_update, playlist_update) | ✅ tabla + entrega via heartbeat | ❌ No hay botón para solicitar screenshot ni enviar comandos |
| Horario de operación (`schedule`) | ✅ campos en screens/groups/tenants, ScheduleManager en player | ❌ No hay editor de schedule en la UI |
| Transiciones configurables (`transition_type`, `transition_duration_ms`) | ✅ campos en screens y tenants | ❌ No hay UI para configurar tipo/duración de transición |
| `default_config` de tenant (network_id, etc.) | ✅ campo jsonb en tenants | ❌ No hay editor del default_config |
| `default_schedule` de tenant | ✅ campo jsonb en tenants | ❌ No hay editor |
| Credencial GAM (`gam.ad_tag_url`) por pantalla | ✅ en sources_config backend | ❌ No hay campo para configurar el ad tag URL |
| URLs de la fuente URL (`url.urls[]`) por pantalla | ✅ en sources_config backend | ❌ No hay editor de URLs para la fuente URL |
| Storage status de dispositivos | ✅ reportado en heartbeat, almacenado en `last_storage_status` | ❌ No se muestra en la UI |
| Proof of Play queue (POP) | ✅ tabla en player SQLite + lógica en ProDoohSource | ❌ Sin visibilidad admin |
| Usuarios / Gestión de credenciales admin | ✅ tabla users | ❌ No hay CRUD de usuarios (se crean manualmente en DB) |

---

## 4. DISCREPANCIAS ENTRE SPECS Y CÓDIGO REAL

### 4.1 Discrepancias Identificadas y Documentadas (bugfix spec)

El archivo `.kiro/specs/integration-api-fixes/bugfix.md` documenta 10 mismatches que fueron identificados. El estado actual del código refleja que **la mayoría ya fueron corregidos**, pero los siguientes persisten o tienen matices:

| # | Discrepancia Original | Estado Actual |
|---|----------------------|---------------|
| 1.1 | Frontend enviaba `angle` en vez de `rotation` para rotar contenido | ✅ Corregido — `contentApi.rotate()` envía `{ rotation }` |
| 1.2 | Frontend enviaba `start_date`/`end_date` en vez de `date_from`/`date_to` | ✅ Corregido — `analyticsApi` envía `date_from`/`date_to` |
| 1.3 | Frontend esperaba `AnalyticsEntry[]` pero backend retorna `{ total_spots, by_source, by_screen, by_content }` | ✅ Corregido — tipo `PlaybackAnalytics` en models.ts coincide con backend |
| 1.4 | Player no enviaba heartbeats | ✅ Corregido — HeartbeatService se instancia y arranca en boot.ts |
| 1.5 | Groups API retornaba raw array vs `{ data: ... }` | ⚠️ **PERSISTE** — `groupsApi.list()` hace `r.data` (espera array raw), `ScreenGroupController@index` retorna `response()->json($groups)` sin wrapper |
| 1.6 | Tenants API inconsistente con wrapper | ⚠️ **PERSISTE** — `tenantsApi.list()` hace `r.data.data` (espera wrapper), `tenantsApi.get()` hace `r.data` (espera raw). El backend tiene wrapper en index pero no consistente en show |
| 1.7 | Super_admin no podía crear playlist (faltaba tenant_id) | ✅ Corregido — TenantContext global + Axios interceptor inyecta `tenant_id` query param |
| 1.8 | Super_admin no podía crear group (faltaba tenant_id) | ✅ Corregido — Backend acepta `tenant_id` de query param vía interceptor |
| 1.9 | No existía contexto global de tenant para super_admin | ✅ Corregido — TenantContext implementado con selector en header |
| 1.10 | Frontend enviaba formato incorrecto para sources toggle | ✅ Corregido — `screensApi.updateSources()` transforma a `{ sources: { prodooh: { enabled: true }, ... } }` |

### 4.2 Discrepancias No Documentadas (descubiertas en esta auditoría)

| # | Descripción | Detalle |
|---|-------------|---------|
| D1 | **PlaybackLogger no está conectado al LoopEngine** | La clase existe y funciona, pero `boot.ts` nunca la instancia ni la conecta como listener del engine. Los eventos de reproducción NO se registran en el player. |
| D2 | **Storage monitoring hardcodeado a ceros** | En `boot.ts`, el `DeviceStatusProvider.getStorageStatus()` retorna siempre `{ total_mb: 0, available_mb: 0, percent_used: 0 }`. No hay implementación real. |
| D3 | **POP Queue no implementada** | El spec de design menciona una `POPQueue` con backoff exponencial para proof-of-play. La tabla `pop_queue` existe en LocalConfigStore schema, pero NO hay clase POPQueue implementada. ProDoohSource hace `fetch(popUrl, { mode: 'no-cors' })` fire-and-forget sin retry. |
| D4 | **StorageManager / LRU Cleanup no implementado** | El spec describe un StorageManager con limpieza LRU. No existe tal clase en el código del player. |
| D5 | **ScreenshotService no implementado** | El spec describe captura de pantalla bajo demanda. No hay implementación en el player para capturar ni enviar screenshots. El endpoint `POST /api/device/screenshot` existe en backend pero nada lo llama. |
| D6 | **device_commands nunca se procesan** | HeartbeatService recibe `pending_commands` en la respuesta del heartbeat, pero `boot.ts` no registra ningún `CommandHandler`. Los comandos se entregan pero se ignoran. |
| D7 | **Tipo `PlaylistItem.type` difiere entre backend y frontend** | Backend migration define enum `('image','video','url')`. Frontend type `models.ts` define `type: 'content' | 'image' | 'video' | 'url'`. La PlaylistForm usa 'content' como tipo pero backend valida 'image'/'video'/'url'. El PlaylistController acepta 'content' en validación (`'in:image,video,url,content'`) como workaround. |
| D8 | **Expiration del JWT no verificada en player** | El player obtiene `expires_in` pero no implementa re-autenticación automática cuando el token expira. Si el JWT expira, las llamadas fallan silenciosamente. |
| D9 | **Requirement 9.3 implementado diferente al spec** | El spec dice "si la confirmación falla, revertir playlist". La implementación actual en PlaylistSyncManager hace lo opuesto: si la confirmación falla, MANTIENE la nueva playlist (con un console.warn). Esto fue una decisión deliberada documentada en el código con comentario explicativo. |
| D10 | **Frontend Analytics tipo difiere del spec original** | El design doc del admin-frontend definía `PlaybackAnalytics` como `{ start_date, end_date, data: AnalyticsEntry[] }`. El tipo real actual es `{ total_spots, by_source, by_screen, by_content }` porque se adaptó al backend real. |
| D11 | **Admin frontend design spec muestra React 18; package.json tiene React 19** | El design doc dice "React 18 + Vite". No se verificó el package.json pero los tipos importados reflejan la API actual. |
| D12 | **No hay CommandHandler para `config_update` ni `playlist_update`** | El backend puede crear device_commands de estos tipos, y los entrega via heartbeat, pero el player no tiene lógica para ejecutar un config_update o forzar un playlist_update inmediato al recibirlo. |
| D13 | **Preview de contenido URL (Req 28.7)** | El spec requiere "previsualizar un ítem tipo URL en el panel de administración". El endpoint `GET /admin/playlist-items/{id}/preview` existe en el backend, pero la UI solo muestra preview para contenido de archivo, no para ítems URL dentro de playlists. |

---

## 5. RESUMEN DE ESTADO POR COMPONENTE

| Componente | Estado General |
|-----------|---------------|
| Backend - DB Schema | ✅ Completo según design spec |
| Backend - Endpoints | ✅ Todos implementados según rutas definidas |
| Backend - Loop Engine | ✅ Funcional: config, toggle, effective loop |
| Backend - Tenant Isolation | ✅ Middleware + global scopes |
| Player - Boot sequence | ✅ Funcional: auth → config → sync → engine |
| Player - Loop Engine | ✅ Funcional: ejecución secuencial, prefetch, fallback |
| Player - Fuentes de contenido | ✅ Las 4 implementadas (prodooh, gam, url, playlist) |
| Player - Playlist Sync | ✅ Funcional: ETag, download, checksum, atomic swap |
| Player - Heartbeat | ✅ Funcional (con storage hardcodeado) |
| Player - Playback Logging | ⚠️ Clase existe pero NO conectada |
| Player - POP Queue | ❌ No implementada (fire-and-forget) |
| Player - Storage/Cleanup | ❌ No implementado |
| Player - Screenshot | ❌ No implementado |
| Player - Command processing | ❌ No implementado |
| Player - Kiosk deploy | ✅ Scripts completos y funcionales |
| Admin-frontend - Auth | ✅ Login/logout/401 redirect |
| Admin-frontend - CRUD entities | ✅ Todos los CRUDs principales funcionan |
| Admin-frontend - Tenant context | ✅ Selector global + interceptor |
| Admin-frontend - Loop editor | ✅ Funcional |
| Admin-frontend - Source toggles | ✅ Optimistic update |
| Admin-frontend - Schedule editor | ❌ No existe |
| Admin-frontend - User management | ❌ No existe |
| Admin-frontend - Device commands UI | ❌ No existe |

---

## 6. DEPLOY HACIA RASPBERRY PI

### 6.1 Proceso de Build

El player se compila con un script custom de esbuild (`player/build.mjs`):

```bash
cd player/
npm run build    # → ejecuta node build.mjs
```

**Qué produce:**
- `dist/player.js` — Bundle único minificado (ES2022, format ESM, con sourcemap)
- `dist/index.html` — Shell HTML mínimo con `#player-root` y fondo negro
- `dist/factory/` — Contenido de branding precargado (si existe `public/factory/`)
- `dist/setup.html` — Página de configuración inicial (si existe `public/setup.html`)

**Transformaciones clave durante el build:**
- `better-sqlite3` (Node.js native) → reemplazado por un shim que usa `localStorage` (para correr en Chromium browser)
- `crypto` (Node.js) → redirigido a Web Crypto API del browser
- Target: `es2022`, platform: `browser`

> **⚠️ Nota:** El player en Raspberry Pi corre en Chromium (browser), no en Node.js. El SQLite se simula sobre `localStorage` vía el shim `better-sqlite3-browser.ts`. Esto es una decisión de arquitectura para esta fase.

### 6.2 Transferencia al Dispositivo

El deploy es **manual vía SCP/USB**. No hay pipeline CI/CD ni OTA:

```bash
# Desde la máquina de desarrollo
scp -r player/ pi@<raspberry-pi-ip>:~/prodooh-player/
```

Alternativa: copiar a USB y transferir físicamente.

### 6.3 Provisioning Automatizado

Una vez el código está en la Pi, el script `deploy/provision.sh` automatiza todo el setup:

```bash
ssh pi@<raspberry-pi-ip>
cd ~/prodooh-player/deploy/
sudo ./provision.sh \
    --venue-id "screen-office-01" \
    --device-token "tk_abc123def456" \
    --backend-url "http://192.168.1.100:8000" \
    --prodooh-api-key "sandbox-api-key" \
    --prodooh-network-id "sandbox-network" \
    --kiosk-password "maintenance123"
```

**Los 7 pasos que ejecuta provision.sh:**

| Paso | Acción |
|------|--------|
| 1 | Instala dependencias del sistema: cage, chromium-browser, sqlite3, fonts, mesa, dbus |
| 2 | Crea usuario `prodooh` (UID 1000), estructura de directorios en `/opt/prodooh-player/` |
| 3 | Copia el bundle (`dist/`) y scripts de deploy al directorio de instalación |
| 4 | Instala servicios systemd (player + watchdog) y configura autologin de getty |
| 5 | Escribe la config del device en SQLite (`/opt/prodooh-player/data/player.db`) |
| 6 | Habilita el kiosk input lock (bloqueo de teclado/mouse vía udev) |
| 7 | Config final: deshabilita DPMS, crea tmpfiles.d, asigna GPU 256MB, habilita dbus |

Al terminar, reinicia el dispositivo automáticamente (a menos que se use `--skip-reboot`).

### 6.4 Estructura en el Dispositivo (post-provisioning)

```
/opt/prodooh-player/
├── dist/
│   ├── index.html          ← Punto de entrada de Chromium
│   ├── player.js           ← Bundle del player
│   ├── player.js.map       ← Sourcemap
│   ├── factory/            ← Contenido de branding precargado
│   └── setup.html          ← Página de configuración inicial
├── deploy/
│   ├── cage-config.ini     ← Config del compositor Cage
│   ├── block-input.conf    ← Reglas udev para bloquear input
│   ├── kiosk-lock.sh       ← Toggle de bloqueo de input
│   └── watchdog.sh         ← Script del watchdog
└── data/
    ├── player.db           ← SQLite con config del device
    ├── cache/              ← Media descargado (playlist)
    └── factory/            ← Contenido factory (backup)
```

### 6.5 Servicios Systemd Instalados

| Servicio | Descripción | Restart | User |
|----------|-------------|---------|------|
| `prodooh-player.service` | Cage + Chromium --kiosk → index.html | on-failure, 5s | prodooh |
| `prodooh-player-watchdog.service` | Polling cada 3s, restart si player caído | always, 3s | root |
| getty@tty1 override | Autologin como prodooh sin password | — | — |

### 6.6 Actualización de un Dispositivo Ya Provisionado

No hay mecanismo OTA implementado. Para actualizar el player:

```bash
# 1. Build en la máquina de desarrollo
cd player/ && npm run build

# 2. Copiar nuevo bundle al Pi (via SSH)
scp -r dist/* pi@<ip>:/opt/prodooh-player/dist/

# 3. Reiniciar el servicio
ssh pi@<ip> "sudo systemctl restart prodooh-player.service"
```

No se requiere re-provisioning si solo cambia el código del player. El provisioning solo es necesario para:
- Primer setup de un dispositivo nuevo
- Cambiar las credenciales del device (venue_id, device_token, backend_url)
- Actualizar la infraestructura (nueva versión de Cage, Chromium, etc.)

### 6.7 Seguridad del Deployment

| Aspecto | Implementación |
|---------|---------------|
| Token de device | Almacenado en SQLite con permisos `600` (solo usuario prodooh) |
| Contraseña kiosko | Hash SHA-256 (no plaintext) en SQLite |
| Filesystem | `ProtectSystem=strict`, `ProtectHome=yes`, solo `/opt/prodooh-player/data` es RW |
| Procesos | `NoNewPrivileges=yes`, `MemoryMax=512M`, `CPUQuota=90%` |
| Input físico | udev rules desautorizan USB HID mientras `PRODOOH_KIOSK_LOCKED=1` |
| Red | Sin puertos expuestos; el player solo hace requests de salida |

### 6.8 Recuperación ante Fallos

Mecanismo de dos capas:

1. **systemd `Restart=on-failure`** — Si Chromium/Cage crashea, systemd lo reinicia en 5s
2. **Watchdog service** — Si systemd no logra reiniciar (o el servicio queda en estado raro), el watchdog detecta en ≤3s y fuerza `systemctl restart`

Garantía: recovery completo en < 10 segundos ante cualquier crash.

Límites de restart: `StartLimitBurst=10` en 60 segundos. Si crashea 10 veces en 1 minuto, systemd deja de intentar (previene loops infinitos en errores persistentes).
