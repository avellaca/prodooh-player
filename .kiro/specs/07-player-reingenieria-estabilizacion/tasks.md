# Implementation Plan: Player Reingeniería Estabilización — SspRetryQueue

## Overview

Implementar `SspRetryQueue`, una cola de reintentos local (SQLite + backoff exponencial) para las llamadas `proof_of_play` y `expiration` del SSP de Prodooh. Se extiende la interfaz `SspClient`, se agrega `popUrl`/`expireUrl` a `SspContent`, y se reemplaza el comportamiento fire-and-forget actual por un mecanismo resiliente.

## Tasks

- [x] 1. Extender interfaces y tipos base
  - [x] 1.1 Extender `SspClient` con `proofOfPlay` y `SspContent` con `popUrl`/`expireUrl`
    - Agregar `proofOfPlay(printId: string): Promise<void>` a la interfaz `SspClient` en `player/src/engine/SspPrefetcher.ts`
    - Agregar campos `popUrl: string` y `expireUrl: string` a la interfaz `SspContent`
    - Actualizar cualquier referencia existente que construya objetos `SspContent` para incluir los nuevos campos
    - _Requisitos: 7.1_

- [x] 2. Implementar clase `SspRetryQueue`
  - [x] 2.1 Crear el archivo `player/src/sync/SspRetryQueue.ts` con tipos e inicialización de tabla
    - Definir tipos `SspOperationType`, `SspRetryQueueOptions`, `SspRetryRow`, `SspCallResult`
    - Implementar constructor que reciba `Database`, `SspClient` y opciones
    - Crear tabla `ssp_retry_queue` con campos: `id`, `print_id`, `operation_type`, `url`, `created_at`, `last_attempt_at`, `attempts`
    - Crear índice `idx_ssp_retry_queue_created_at`
    - Implementar `getPendingCount()` y `calculateBackoffMs(attempts)`
    - _Requisitos: 1.3, 2.1, 2.2_

  - [x] 2.2 Implementar métodos `proofOfPlay` y `expire` con intento inmediato
    - Implementar `proofOfPlay(printId, popUrl)`: intento inmediato vía `SspClient.proofOfPlay`, si falla transitorio → INSERT en SQLite, si falla permanente → descartar
    - Implementar `expire(printId, expireUrl)`: intento inmediato vía `SspClient.expireAd`, si falla transitorio → INSERT en SQLite, si falla permanente → descartar
    - Implementar función auxiliar `classifyHttpError(statusCode)` para distinguir transitorio vs permanente
    - _Requisitos: 1.1, 1.2, 4.1, 4.2, 4.3, 4.4, 6.1, 6.2, 6.3_

  - [x] 2.3 Implementar método `flush` con backoff y procesamiento FIFO
    - SELECT registros ordenados por `created_at ASC`
    - Para cada registro cuyo backoff haya transcurrido: ejecutar llamada, en éxito → DELETE, en fallo transitorio → UPDATE attempts+1, en fallo permanente → DELETE
    - Respetar backoff: `min(2^(attempts-1) × baseBackoffMs, maxBackoffMs)`
    - _Requisitos: 2.1, 2.2, 2.3, 2.4, 3.1, 5.1, 5.2_

  - [x] 2.4 Implementar `startPeriodicFlush` y `stopPeriodicFlush`
    - Arrancar `setInterval` que llama a `flush()` cada `flushIntervalMs` (default 5000ms)
    - Implementar `stopPeriodicFlush` para limpiar el timer
    - _Requisitos: 3.2_

  - [x] 2.5 Escribir property test: Propiedad 1 — Encolado ante fallo transitorio persiste datos correctos
    - **Propiedad 1: Enqueue on transient failure persists correct data**
    - **Valida: Requisito 1.1**

  - [x] 2.6 Escribir property test: Propiedad 2 — Primer intento exitoso no produce entradas en cola
    - **Propiedad 2: Successful first attempt produces no queue entries**
    - **Valida: Requisito 1.2**

  - [x] 2.7 Escribir property test: Propiedad 3 — Fórmula de backoff con cap
    - **Propiedad 3: Backoff formula with cap**
    - **Valida: Requisitos 2.1, 2.2**

  - [x] 2.8 Escribir property test: Propiedad 4 — Reintento exitoso elimina entrada
    - **Propiedad 4: Successful retry removes entry**
    - **Valida: Requisito 2.3**

  - [x] 2.9 Escribir property test: Propiedad 5 — Fallo de reintento incrementa attempts
    - **Propiedad 5: Failed retry increments attempts**
    - **Valida: Requisito 2.4**

  - [x] 2.10 Escribir property test: Propiedad 6 — Sin TTL, entradas persisten indefinidamente
    - **Propiedad 6: No TTL — entries persist indefinitely**
    - **Valida: Requisitos 3.1, 3.3**

  - [x] 2.11 Escribir property test: Propiedad 7 — Cola sobrevive reinicio (round-trip persistence)
    - **Propiedad 7: Queue survives restart (round-trip persistence)**
    - **Valida: Requisito 3.2**

  - [x] 2.12 Escribir property test: Propiedad 8 — Cualquier 4xx descarta sin reintentar
    - **Propiedad 8: Any 4xx response discards entry without retry**
    - **Valida: Requisitos 4.1, 4.2, 4.3, 4.4**

  - [x] 2.13 Escribir property test: Propiedad 9 — Procesamiento FIFO por timestamp sin importar tipo
    - **Propiedad 9: FIFO processing by timestamp regardless of type**
    - **Valida: Requisitos 5.1, 5.2**

- [x] 3. Checkpoint — Verificar que SspRetryQueue funciona aisladamente
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Unit tests de SspRetryQueue
  - [x] 4.1 Escribir unit tests para constructor, proofOfPlay, expire y flush
    - Test: constructor crea tabla `ssp_retry_queue` si no existe
    - Test: `proofOfPlay` exitoso no persiste nada
    - Test: `expire` exitoso no persiste nada
    - Test: `proofOfPlay` falla con 503 → persiste con attempts=1
    - Test: `flush` con cola vacía → no-op
    - Test: `flush` respeta backoff (no procesa entry cuyo delay no ha transcurrido)
    - Test: `calculateBackoffMs` para múltiples valores
    - _Requisitos: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 6.1, 6.2, 6.3_

- [x] 5. Integrar SspRetryQueue con SspPrefetcher
  - [x] 5.1 Modificar `SspPrefetcher.expire` para delegar al `SspRetryQueue`
    - Agregar dependencia opcional de `SspRetryQueue` al constructor de `SspPrefetcher`
    - En `expire(printId)`: si hay `SspRetryQueue`, llamar `retryQueue.expire(printId, expireUrl)` en vez del try/catch fire-and-forget actual
    - Obtener `expireUrl` del `currentContent` almacenado
    - _Requisitos: 7.4_

  - [x] 5.2 Modificar `SspPrefetcher.prefetch` para preservar `popUrl`/`expireUrl`
    - Actualizar la lógica de prefetch para que el `SspContent` retornado incluya `popUrl` y `expireUrl` del response del SSP
    - Cuando se expira contenido anterior en prefetch, usar el retry queue si está disponible
    - _Requisitos: 6.2, 7.4_

- [x] 6. Integrar con ManifestEngine y boot.ts
  - [x] 6.1 Actualizar la implementación de `SspClient` en `boot.ts` para incluir `proofOfPlay`
    - Agregar método `proofOfPlay(printId)` al objeto `sspClient` literal en boot.ts
    - La implementación debe hacer GET a la `pop_url` almacenada para ese `printId`
    - Actualizar `requestAd` para extraer `pop_url` y `expire_url` del response del SSP y retornarlos en `SspContent`
    - _Requisitos: 7.1, 7.2_

  - [x] 6.2 Instanciar `SspRetryQueue` en boot.ts y conectar con el flujo
    - Crear instancia de `SspRetryQueue` pasando la DB compartida y el `sspClient`
    - Pasar `SspRetryQueue` al `SspPrefetcher`
    - Conectar `onItemComplete` del ManifestEngine para que invoque `sspRetryQueue.proofOfPlay(printId, popUrl)` cuando un item SSP se reproduzca exitosamente
    - Iniciar `startPeriodicFlush` del SspRetryQueue
    - _Requisitos: 7.2, 7.3_

- [x] 7. Checkpoint — Verificar integración completa
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Tests de integración
  - [x] 8.1 Escribir tests de integración end-to-end
    - Test: Ciclo completo proof_of_play: prefetch → reproducción → proofOfPlay falla → enqueue → flush → éxito → entry eliminada
    - Test: Ciclo completo expiration: prefetch → cambio manifiesto → expire falla → enqueue → flush → éxito → entry eliminada
    - Test: Reinicio del player: encolar entries → destruir instancia → crear nueva → verificar recovery
    - Test: Error permanente en flush: encolar entries → flush con mock 404 → verificar entries eliminadas
    - _Requisitos: 1.1, 1.2, 2.3, 3.2, 4.1, 6.1, 6.2, 7.2, 7.3_

- [x] 9. Checkpoint final — Todo integrado y funcionando
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Las tareas marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido
- Cada tarea referencia requisitos específicos para trazabilidad
- Los checkpoints aseguran validación incremental
- Los property tests validan propiedades universales de correctness definidas en el diseño
- Los unit tests validan ejemplos específicos y casos borde
- Se reutiliza la misma base de datos SQLite que `ImpressionReporter` (tabla separada)
- El patrón de `ImpressionReporter` (constructor con ensureTable, flush periódico, backoff) sirve de referencia

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4"] },
    { "id": 3, "tasks": ["2.5", "2.6", "2.7", "2.8", "2.9", "2.10", "2.11", "2.12", "2.13", "4.1"] },
    { "id": 4, "tasks": ["5.1", "5.2"] },
    { "id": 5, "tasks": ["6.1"] },
    { "id": 6, "tasks": ["6.2"] },
    { "id": 7, "tasks": ["8.1"] }
  ]
}
```
