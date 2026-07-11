# Requirements Document

## Introduction

Este documento define los requerimientos para la corrección D3 identificada en la auditoría del player: implementar una cola de reintentos local para las llamadas `proof_of_play` y `expiration` del SSP de Prodooh. Actualmente estas llamadas se realizan como fire-and-forget, lo que significa que ante conectividad inestable (escenario aeropuerto) las confirmaciones se pierden silenciosamente y el SSP nunca registra la impresión como entregada.

La solución reutiliza el patrón ya establecido por `ImpressionReporter` (SQLite + backoff exponencial + flush periódico) adaptado a las particularidades del protocolo SSP (respuestas permanentes 404/409/401, backoff máximo de 60s).

### Decisiones de diseño tomadas

1. **Extensión de SspClient**: Se agrega `proofOfPlay(printId): Promise<void>` a la interfaz existente `SspClient`. No es una redefinición sino completar algo que el documento 04 ya asumía que existía — no se abre el resto del contrato a discusión.
2. **Autenticación separada**: Las llamadas al SSP usan `api_key` + `network_id` en el cuerpo del request (API externo de Prodooh), NO el JWT de dispositivo. Un 401 del SSP indica credenciales SSP mal configuradas — error permanente, no transitorio.
3. **Payload mínimo**: `proof_of_play` es un GET a la URL que vino en la respuesta original del SSP — el `print_id` va embebido en esa URL. No se requiere cuerpo adicional. La cola solo necesita persistir la URL completa y el tipo de operación.

## Glossary

- **SspRetryQueue**: Componente del player responsable de persistir y reintentar llamadas fallidas de `proof_of_play` y `expiration` hacia el SSP de Prodooh.
- **SSP**: Supply-Side Platform — plataforma de Ad Serving de Prodooh que gestiona el inventario publicitario programático.
- **proof_of_play**: Llamada GET al SSP (URL recibida en la respuesta original del ad request) que confirma que un arte fue efectivamente reproducido en pantalla.
- **expiration**: Llamada al SSP que notifica que un arte prefetcheado no fue reproducido y debe liberarse.
- **print_id**: Identificador único asignado por el SSP a cada arte prefetcheado, embebido en las URLs de confirmación/expiración.
- **Backoff_Exponencial**: Estrategia de reintento donde el intervalo entre intentos se duplica progresivamente (1s → 2s → 4s → ...) hasta un máximo configurado.
- **Error_Transitorio**: Fallo de red, timeout, o respuesta HTTP 5xx — condiciones que pueden resolverse con el tiempo.
- **Error_Permanente**: Respuesta HTTP 4xx (incluyendo 401, 404, 409) — estados que no cambiarán al reintentar dado que la autenticación SSP usa credenciales estáticas (api_key + network_id), no JWT renovable.
- **Player**: Aplicación TypeScript ejecutándose en el dispositivo (tótem/Raspberry Pi) que reproduce contenido publicitario.
- **SspClient**: Interfaz que abstrae la comunicación con el SSP, extendida con `proofOfPlay(printId)` como parte de este spec.
- **pop_url**: URL completa proporcionada por el SSP en la respuesta al ad request, utilizada para confirmar reproducción mediante GET.

## Requirements

### Requirement 1: Encolado local ante fallo de llamada SSP

**User Story:** Como operador de red, quiero que las confirmaciones de reproducción y expiraciones al SSP se persistan localmente ante fallos de red, para que no se pierdan impresiones por conectividad inestable.

#### Acceptance Criteria

1. WHEN una llamada de `proof_of_play` o `expiration` al SSP falla con un Error_Transitorio, THE SspRetryQueue SHALL persistir el intento en SQLite con los campos: print_id, tipo (proof_of_play | expiration), URL de la llamada, timestamp del intento original, y número de intentos inicializado en 1.
2. WHEN una llamada de `proof_of_play` o `expiration` al SSP responde exitosamente en el primer intento, THE SspRetryQueue SHALL completar la operación sin persistir nada en la cola.
3. THE SspRetryQueue SHALL crear la tabla de almacenamiento en SQLite al inicializarse si la tabla no existe previamente.

### Requirement 2: Reintento con backoff exponencial

**User Story:** Como operador de red, quiero que los reintentos al SSP usen backoff exponencial, para que el player no sature el endpoint durante períodos de conectividad degradada.

#### Acceptance Criteria

1. WHEN un elemento existe en la cola de reintentos, THE SspRetryQueue SHALL reintentar la llamada con un intervalo de backoff exponencial comenzando en 1 segundo y duplicándose en cada intento fallido consecutivo.
2. WHILE el intervalo de backoff calculado supere 60 segundos, THE SspRetryQueue SHALL limitar el intervalo entre reintentos a un máximo de 60 segundos.
3. WHEN un reintento tiene éxito (respuesta 2xx del SSP), THE SspRetryQueue SHALL eliminar el registro de la cola y resetear el backoff para el siguiente elemento.
4. WHEN un reintento falla con un Error_Transitorio, THE SspRetryQueue SHALL incrementar el contador de intentos del registro y recalcular el intervalo de backoff.

### Requirement 3: Persistencia sin límite temporal

**User Story:** Como operador de red, quiero que la cola sobreviva a reinicios del player y períodos prolongados sin conectividad, para que las confirmaciones se procesen eventualmente al recuperar red.

#### Acceptance Criteria

1. THE SspRetryQueue SHALL mantener los registros en la cola sin límite de tiempo total ni de número máximo de intentos para Error_Transitorio.
2. WHEN el Player se reinicia, THE SspRetryQueue SHALL recuperar todos los registros pendientes de la base de datos SQLite y reanudar el procesamiento de la cola.
3. WHILE el dispositivo permanezca sin conectividad durante días, THE SspRetryQueue SHALL preservar la cola completa en SQLite hasta que se recupere la conexión.

### Requirement 4: Descarte de errores permanentes

**User Story:** Como operador de red, quiero que la cola descarte intentos cuyo resultado es permanente, para que no se acumulen registros imposibles de procesar.

#### Acceptance Criteria

1. WHEN el SSP responde con HTTP 404 (print_id no encontrado), THE SspRetryQueue SHALL eliminar el registro de la cola sin reintentar.
2. WHEN el SSP responde con HTTP 409 (print_id ya procesado o ya expirado), THE SspRetryQueue SHALL eliminar el registro de la cola sin reintentar.
3. WHEN el SSP responde con HTTP 401 (credenciales SSP inválidas), THE SspRetryQueue SHALL eliminar el registro de la cola sin reintentar.
4. WHEN el SSP responde con cualquier otro código HTTP 4xx, THE SspRetryQueue SHALL tratar la respuesta como Error_Permanente y eliminar el registro de la cola sin reintentar.

### Requirement 5: Orden de procesamiento FIFO

**User Story:** Como operador de red, quiero que la cola procese los reintentos en orden cronológico, para que las confirmaciones se entreguen al SSP en la secuencia en que ocurrieron.

#### Acceptance Criteria

1. THE SspRetryQueue SHALL procesar los registros de la cola en orden FIFO por timestamp de encolado original.
2. THE SspRetryQueue SHALL procesar los registros de tipo `proof_of_play` y `expiration` en la misma cola sin priorización diferenciada entre tipos.

### Requirement 6: Intento inmediato antes de encolar

**User Story:** Como operador de red, quiero que el player intente la llamada inmediatamente antes de encolarla, para que en condiciones normales de red la confirmación llegue al SSP sin demora.

#### Acceptance Criteria

1. WHEN el SspPrefetcher completa la reproducción de un arte SSP, THE SspRetryQueue SHALL intentar la llamada de `proof_of_play` de forma inmediata antes de considerar el encolado.
2. WHEN el SspPrefetcher necesita expirar un arte no reproducido, THE SspRetryQueue SHALL intentar la llamada de `expiration` de forma inmediata antes de considerar el encolado.
3. WHEN el intento inmediato falla con un Error_Transitorio, THE SspRetryQueue SHALL encolar el registro para reintento según el Requerimiento 2.

### Requirement 7: Extensión de la interfaz SspClient

**User Story:** Como desarrollador, quiero que la interfaz SspClient se extienda con el método de proof_of_play faltante, para que la cola de reintentos pueda ejecutar ambas operaciones a través de un único contrato.

#### Acceptance Criteria

1. THE SspClient SHALL exponer un método `proofOfPlay(printId: string): Promise<void>` para confirmar la reproducción de un arte al SSP.
2. THE SspRetryQueue SHALL utilizar la interfaz SspClient para ejecutar tanto las llamadas de `proof_of_play` como de `expiration`.
3. THE SspRetryQueue SHALL reutilizar la misma base de datos SQLite utilizada por el ImpressionReporter, en una tabla separada.
4. WHEN el SspPrefetcher invoca `expire(printId)`, THE SspRetryQueue SHALL garantizar el reintento en caso de fallo, reemplazando el comportamiento fire-and-forget actual.
