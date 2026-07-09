# 04 — Correcciones Pendientes

## Estado de las tres correcciones identificadas en la auditoría

| Corrección | Dónde se resuelve |
|---|---|
| D1 — Registro de reproducciones no conectado | Ya resuelta en el documento 03 (tabla `impressions`, conectada como parte del contrato central de "reproducir un ítem", no como listener opcional). No se repite aquí. |
| D3 — Proof-of-play sin reintentos | Se detalla completo en este documento. |
| D8 — JWT sin renovación automática | Ya resuelta en el documento 03 (detección de `401` + flujo automático de re-auth). No se repite aquí. |

## D3 — Cola de reintentos para proof-of-play y expiration del SSP de Prodooh

### El problema tal como quedó documentado en la auditoría

`ProDoohSource` hoy hace la confirmación de reproducción (`proof_of_play`) como *fire-and-forget*: `fetch(popUrl, { mode: 'no-cors' })` sin verificar respuesta ni reintentar ante fallo. Con la conectividad ya identificada como frágil (especialmente en el escenario de aeropuerto), cada confirmación perdida es una impresión que el SSP nunca cuenta como entregada del lado de Prodooh — esto afecta directamente cualquier reporte o compromiso comercial que dependa de esos datos, sin que el player tenga ninguna señal de que algo se perdió.

### Diseño: cola local con reintento y backoff exponencial

Se reutiliza el mismo patrón de almacenamiento local ya establecido para la cola de impresiones (documento 03) y para el propio manifiesto — no se introduce un mecanismo de persistencia nuevo.

**Al confirmar reproducción o expirar un arte del SSP:**
1. Se intenta la llamada (`proof_of_play` o `expiration`) de inmediato.
2. Si falla (timeout, error de red, `5xx`), se encola localmente con: `print_id`, tipo (`proof_of_play` | `expiration`), timestamp del intento original, número de intentos.
3. Reintento con backoff exponencial: 1s → 2s → 4s → ... hasta un máximo de 60s entre intentos — mismos incrementos ya definidos en la documentación del API de Ad Serving de Prodooh para el manejo de `429`, se reutiliza la misma constante en vez de definir una nueva.
4. Sin límite de tiempo total ni de número de intentos para errores transitorios — si el dispositivo pasa varios días sin red, la cola se mantiene completa y se procesa al recuperar conexión, mismo principio ya aceptado para la cola de impresiones.

### Manejo de respuestas que NO deben reintentarse

No todos los fallos son transitorios. Si la respuesta del SSP es `404` (print_id no encontrado) o `409` (print_id ya registrado o ya expirado previamente — respuestas documentadas del API de Ad Serving), el intento se descarta de la cola sin más reintentos: son estados permanentes, reintentar no cambiaría el resultado. Solo se reintenta ante fallos de red, timeout, o `5xx` (errores que sí pueden resolverse con el tiempo).

### Orden de procesamineto

FIFO simple por timestamp de encolado — no hay priorización entre `proof_of_play` y `expiration`, ambos compiten por el mismo procesamiento en el orden en que ocurrieron.

### Qué NO se construye en esta corrección

No se implementa un dashboard ni visibilidad administrativa de esta cola en el admin-frontend — es un mecanismo interno del player, invisible para el operador salvo que se decida agregarlo más adelante como necesidad de diagnóstico (no identificada como necesaria por ahora).