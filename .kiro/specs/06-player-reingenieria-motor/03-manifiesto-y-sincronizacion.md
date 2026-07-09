# 03 — Manifiesto y Sincronización

## Principio general

El player nunca decide qué reproducir. Pregunta "¿qué hay para mí?", recibe una secuencia ya resuelta y concreta (no reglas, no pesos, no prioridades — eso ya se resolvió del lado del backend según el documento 02), la descarga a almacenamiento local, la reproduce en loop, y reporta impresiones. Si pierde conexión, sigue reproduciendo el último manifiesto válido indefinidamente.

## Contrato del manifiesto

`GET /api/device/manifest` (reemplaza al actual `GET /api/device/playlist`), mismo mecanismo de ETag/versión ya existente y funcional — se reutiliza esa tubería, no se reinventa.

```json
{
  "version": "abc123",
  "generated_at": "2026-07-09T06:00:00-06:00",
  "items": [
    {
      "position": 0,
      "type": "order_line_creative",
      "asset_url": "https://.../content/xyz.mp4",
      "checksum_sha256": "...",
      "duration_seconds": 10,
      "order_line_id": "uuid-...",
      "creative_id": "uuid-..."
    },
    {
      "position": 1,
      "type": "prodooh_ssp_call",
      "duration_seconds": 10
    },
    {
      "position": 2,
      "type": "playlist_item",
      "asset_url": "https://.../content/abc.jpg",
      "checksum_sha256": "...",
      "duration_seconds": 10,
      "playlist_item_id": "uuid-..."
    }
  ]
}
```

Tres tipos de ítem, cada uno con implicación distinta para el player:

| `type` | Contenido resuelto de antemano | Reporta impresión con | Requiere llamada en vivo |
|---|---|---|---|
| `order_line_creative` | Sí — `asset_url` concreto | `order_line_id` + `creative_id` | No |
| `playlist_item` | Sí — `asset_url` concreto | Ninguna (playlist local no se reporta al backend, ya establecido en fases previas) | No |
| `prodooh_ssp_call` | No — es una instrucción de "llama al SSP en vivo en este turno" | Nada al backend propio (el SSP ya lleva su propio conteo) | Sí, ver sección siguiente |

## Slot `prodooh_ssp_call` — llamada en vivo con prefetch adelantado

Este tipo de ítem no tiene `asset_url` porque el contenido no se puede resolver por adelantado — lo decide el SSP de Prodooh en el momento de la petición. El player es quien hace la llamada (reutilizando el cliente `ProDoohSource` ya existente: `POST /public/v1/ad`, proof_of_play, expiration), no el backend propio.

**Regla de prefetch — más margen que el resto de ítems:** a diferencia de un `order_line_creative` (donde el archivo ya existe y descargarlo es solo transferencia), este slot requiere primero la llamada al SSP (latencia de red + decisión del lado de Prodooh) y *después* la descarga del archivo que esa respuesta indica — dos latencias en cascada, no una. El player debe disparar la llamada al SSP **al entrar al ítem anterior en la secuencia**, no esperar a que falten unos segundos como con el resto de ítems.

**Si el arte del SSP no está listo cuando le toca su turno:** el ciclo se rellena con el siguiente ítem de playlist local disponible (mismo mecanismo de respaldo ya usado en todo el sistema), y el SSP simplemente reintenta en su siguiente turno programado — nunca bloquea.

**Si el arte fue pedido pero el manifiesto cambia antes de reproducirlo** (se recibió un `print_id` pero la actualización de manifiesto ya quitó ese slot): el player debe llamar `expiration` sobre ese `print_id`, no dejarlo sin resolver — de lo contrario el SSP lo contaría como entregado sin haberse mostrado nunca.

**Limpieza de almacenamiento:** el archivo de un arte del SSP se borra inmediatamente después de confirmar su reproducción o su expiración. A diferencia del contenido de la librería/playlist (que es persistente y se reutiliza), el contenido del SSP es de un solo uso — no tiene sentido acumularlo, y no participa del mecanismo de limpieza LRU que sí aplica a la librería propia (ver documento 04, corrección de storage management).

## Sincronización — polling de "¿sigo igual o hay cambios?"

Se conserva el mecanismo ya existente y funcional: el player pregunta periódicamente (`sync_interval_seconds`, ya configurable) con el header `If-None-Match: {version}`. Si no hay cambios, `304`. Si hay manifiesto nuevo, se descarga completo, se valida checksum de cada asset nuevo, se hace swap atómico (mismo patrón ya implementado: descarga → valida → swap con backup/revert ante fallo), y se confirma adopción con `POST /api/device/manifest/confirm`.

**Aclaración sobre la corrección D9 detectada en la auditoría:** el comportamiento actual del código (mantener el manifiesto nuevo aunque falle el POST de confirmación, con un `console.warn`) fue una decisión deliberada documentada en el código, no un bug. Se mantiene esa decisión en la reingeniería — no se revierte a la especificación original que pedía rollback ante fallo de confirmación.

## Reporte de impresiones — ligado a Línea de pedido y Creativo

Reemplaza al `PlaybackLogController` actual (que hoy no está conectado a nada — corrección D1). Formato:

```json
POST /api/device/impressions
{
  "impressions": [
    {
      "id": "uuid-local",
      "order_line_id": "uuid-...",
      "creative_id": "uuid-...",
      "started_at": "2026-07-09T12:00:00.000Z",
      "ended_at": "2026-07-09T12:00:10.000Z",
      "duration_seconds": 10,
      "result": "success",
      "failure_reason": null
    }
  ]
}
```

Solo se reportan impresiones de ítems `type: order_line_creative`. Los ítems `playlist_item` y `prodooh_ssp_call` no generan una fila en `impressions` (el primero por decisión ya tomada en fases previas, el segundo porque el SSP lleva su propio conteo, sección anterior).

**Conexión real al motor de ejecución (corrección D1):** el player debe emitir el evento de impresión completada como parte del ciclo normal de reproducción del nuevo motor de secuencia (el reemplazo del `LoopEngine`), no como una clase aislada que alguien podría olvidar instanciar en el boot — la emisión de impresiones debe ser parte del contrato central de "reproducir un ítem", no un listener opcional.

## Almacenamiento local ante pérdida de conexión — sin cambios de fondo, solo dos adiciones

- El comportamiento base (seguir reproduciendo el último manifiesto válido indefinidamente, con assets ya descargados) no cambia.
- **Cola de impresiones pendientes**: si no hay red al momento de reportar, las impresiones se acumulan localmente (ya existía este patrón para `playback_logs`, se reutiliza para `impressions`) y se reintentan con backoff exponencial al recuperar conexión — mismo patrón que se define para proof-of-play en el documento 04 (corrección D3), consistente entre ambos.
- Sin límite de tiempo para esta cola: si pasan varios días sin red, se acumula todo y se sincroniza de una vez al recuperar conexión — no se descarta nada por antigüedad.

## Renovación de JWT del dispositivo (corrección D8, resuelta aquí por ser parte del mismo ciclo de comunicación)

El player debe detectar una respuesta `401` de cualquier endpoint (`manifest`, `heartbeat`, `impressions`) como señal de JWT expirado, y ejecutar automáticamente el flujo de `POST /api/device/auth` (ya existente) para obtener un token nuevo antes de reintentar la petición original — sin intervención manual y sin que esto se manifieste como una falla silenciosa como ocurre hoy.