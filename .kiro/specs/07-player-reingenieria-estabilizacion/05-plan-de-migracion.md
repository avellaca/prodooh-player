# 05 — Plan de Migración

## Punto de partida: esto no es una migración de datos en producción real

Dato clave que simplifica todo este plan: según la auditoría (D1), **nunca se ha registrado una sola impresión real** con el sistema actual — `PlaybackLogger` nunca estuvo conectado. Esto significa que no hay historial de reproducciones que preservar ni reconciliar. La migración es de **esquema y código**, no de datos de negocio. No se necesita un período de "corrida en paralelo" entre el sistema viejo y el nuevo, ni un plan de reconciliación de reportes históricos — porque no existen.

## Orden de ejecución (ya establecido con Kiro, se confirma aquí como parte del plan)

```
1. player-reingenieria-fundacion   (modelo de datos: Pedido/Línea de pedido/Creativo/Impressions)
2. player-reingenieria-motor       (motor de prioridad + manifiesto/sincronización)
3. player-reingenieria-estabilizacion (correcciones D3 + este plan de migración)
```

Estrictamente secuencial — no se inicia un spec hasta que el anterior esté implementado y probado por Carlos en los dispositivos de piloto (2 tótems de oficina + Raspberries de prueba).

## Gate de validación entre cada spec (puntos de parada explícitos)

**Después de `fundacion`:** las migraciones corren sin error, las tablas nuevas existen con las relaciones correctas, y es posible crear manualmente (via Tinker o SQL directo, igual que se hizo al inicio del proyecto) un Pedido de prueba con una Línea de pedido y un Creativo, respetando las restricciones de fechas anidadas. No se avanza a `motor` sin esto confirmado.

**Después de `motor`:** el motor de prioridad resuelve correctamente un caso de prueba manual (ej. una Línea de pedido Patrocinio + una Estándar compitiendo por la misma pantalla) y genera un manifiesto con el entrelazado esperado — verificable inspeccionando el JSON del manifiesto directamente. El player en un tótem de oficina debe reproducir ese manifiesto correctamente, incluyendo el slot `prodooh_ssp_call` con su prefetch adelantado. Adicionalmente, el Pedido de prueba usado para esta validación debe crearse a través de la UI de administración (no manualmente en base de datos), confirmando que el flujo completo de creación es operable de principio a fin.

**Después de `estabilizacion`:** la cola de reintentos de proof-of-play funciona ante una desconexión simulada (apagar WiFi del tótem, verificar que se encola, reconectar, verificar que se procesa) — mismo tipo de prueba que ya se había planteado hacer desde el inicio del proyecto para la playlist local, ahora extendida a esta cola.

## Administración de Pedidos/Líneas de pedido/Creativos — integrada al spec `motor`

El spec `player-reingenieria-motor` incluye, además del motor de prioridad y el manifiesto/sincronización (documentos 02 y 03), la UI mínima de administración en el admin-frontend para:

- CRUD de Pedidos (nombre, anunciante, fechas, estado).
- CRUD de Líneas de pedido dentro de un Pedido (nombre, nivel de prioridad, fechas, `target_spots`, `delivery_pace`, `share_weight`, asignación a pantallas o grupos).
- CRUD de Creativos dentro de una Línea de pedido (selección de contenido de la librería ya existente, `weight`, `active_dates` mediante selector de calendario con selección libre de días/rangos/multi-rangos).

Reutiliza los mismos patrones ya establecidos en el admin-frontend actual (Tailwind + shadcn/ui, tablas HTML simples, formularios controlados nativos) — no se introduce ninguna librería nueva para esto.

## Retiro de componentes obsoletos (limpieza, no solo adición)

Esto se ejecuta como parte de `fundacion`/`motor`, no se deja como deuda "por si acaso":

| Componente a retirar | Reemplazado por |
|---|---|
| `screens.loop_config`, `screens.sources_config`, `screens.duration_seconds` (override individual) | Modelo de Pedido/Línea de pedido + duración estandarizada a nivel Network/Grupo (documento 01) |
| `LoopConfigController`, `SourceToggleController`, `LoopConfigService`, `SourceToggleService` (backend) | Motor de prioridad (documento 02) + endpoints nuevos de manifiesto (documento 03) |
| `LoopEngine`, `PrefetchManager`, `SlotConfigManager` (player) | Nuevo motor de ejecución de secuencia consumiendo el manifiesto ya resuelto |
| `LoopEditor`, `SourceToggles` (admin-frontend) | UI de Pedidos/Líneas de pedido/Creativos, construida dentro del mismo spec `motor` (ver sección de administración arriba) — se retiran en el mismo despliegue, no quedan huérfanas. |
| `GET /api/device/playlist`, `POST /api/device/playlist/confirm` | `GET /api/device/manifest`, `POST /api/device/manifest/confirm` (documento 03) |
| `playback_logs` (tabla) | `impressions` (documento 01) — se elimina la tabla vieja, no coexiste, ya decidido. |

**Lo que NO se retira:** `GamVastSource` y su código asociado permanecen en el repositorio, inactivos (documento 00) — no se borran por si se retoma la integración con GAM más adelante.

## Reprovisionamiento de dispositivos — no es necesario

Los tótems de oficina y las Raspberries de prueba ya provisionadas (con su `venue_id` y `device_token`) **no requieren re-provisioning** para esta migración. El cambio de JWT (corrección D8) y el nuevo endpoint de manifiesto son actualizaciones de software del lado del player y del backend — se despliegan con el mismo mecanismo ya usado (`npm run build` + copia del bundle nuevo + restart del servicio), sin tocar la configuración de autenticación del dispositivo ya almacenada en cada Pi.

## Orden recomendado de despliegue dentro de cada spec

Para minimizar tiempo con el sistema en un estado inconsistente entre backend y player:
1. Desplegar el backend primero (migraciones + endpoints nuevos), manteniendo temporalmente los endpoints viejos activos si es técnicamente sencillo (no obligatorio, pero reduce la ventana de player-viejo-hablando-con-backend-nuevo).
2. Desplegar el player actualizado a los dispositivos de piloto.
3. Confirmar el gate de validación correspondiente (arriba) antes de retirar los endpoints/componentes viejos del backend.

## Qué hacer si algo falla a medio camino

Dado que no hay datos de producción reales en juego, el "rollback" más simple y suficiente para esta etapa es: mantener el código del bundle anterior del player disponible (ya es el flujo de deploy manual actual — copiar `dist/` viejo de vuelta y reiniciar el servicio) y no eliminar las tablas/columnas viejas del backend hasta que el gate de validación de cada spec esté confirmado. No se necesita un mecanismo de rollback automatizado para esta fase.