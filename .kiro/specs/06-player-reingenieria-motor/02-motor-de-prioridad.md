# 02 — Motor de Prioridad

## Dónde vive esta lógica

100% en el backend. El player nunca decide prioridad — solo ejecuta lo que el backend ya resolvió y reporta impresiones. Ver documento 03 para el contrato de sincronización con el player; este documento cubre únicamente el algoritmo de resolución del lado del backend.

## Entrada del algoritmo

Para una pantalla dada, en el momento de generar/actualizar su manifiesto, el motor necesita resolver:

1. Todas las `order_lines` con `status = active` cuyo rango de fechas (`starts_at`/`ends_at`) incluye la fecha actual, y cuyo `order` padre también está `active` y vigente en fecha.
2. De esas, filtrar las que aplican a esta pantalla — directamente (`order_line_targets.screen_id`) o vía su grupo (`order_line_targets.screen_group_id` = `screens.group_id` de esta pantalla).
3. De cada Línea de pedido resultante, sus `creatives` cuyo `active_dates` incluye la fecha de hoy.
4. El conteo de `impressions` ya entregadas por cada Línea de pedido (para respetar `target_spots` si está definido).

## Dos mecanismos que trabajan juntos: Pacing y Peso

Son conceptos distintos que resuelven preguntas distintas, y hay que no confundirlos:

- **`delivery_pace` (asap / uniform) responde: ¿cuánto quiere entregar ESTA línea HOY?** Define el presupuesto diario individual de una Línea de pedido, calculado a partir de lo que le falta por entregar y los días que le quedan de vigencia.
- **`share_weight` responde: cuando VARIAS líneas del mismo nivel de prioridad compiten por la misma pantalla al mismo tiempo, ¿cómo se reparte la capacidad disponible entre ellas?** Es proporcional, igual que ya funciona `creatives.weight` un nivel abajo.

### Cálculo del presupuesto diario por Línea de pedido

Se recalcula una vez al día (o al regenerar el manifiesto tras un cambio relevante):

```
remaining_target = target_spots - spots_ya_entregados   (si target_spots es null, no aplica presupuesto diario — 
                                                            la línea participa sin límite propio, solo acotada 
                                                            por su fecha de fin)
remaining_days = días entre hoy y ends_at de la línea (inclusive)

SI delivery_pace = 'uniform':
    daily_budget = ceil(remaining_target / remaining_days)
    → Objetivo: llegar exactamente al target_spots repartido parejo entre los días que quedan.

SI delivery_pace = 'asap':
    daily_budget = remaining_target
    → Objetivo: entregar todo lo que se pueda hoy, sin límite propio — solo lo detiene la 
      capacidad real disponible en la pantalla o el agotamiento del target.
```

### Capacidad total disponible por pantalla y por día

`total_daily_spots` = capacidad total del día para una pantalla, derivada de la duración estandarizada (Network o Grupo, documento 00/01) y el horario de operación configurado. Esto ya es calculable con lo que existe hoy (mismo cálculo de referencia que se usaba para el Loop antiguo, ej. duración de 10s × horas de operación).

### Algoritmo de asignación diaria (waterfall con reparto proporcional dentro de cada nivel)

```
capacidad_restante = total_daily_spots

PASO 1 — Patrocinio:
  líneas_activas = Líneas de pedido con priority_tier='patrocinio', vigentes hoy, con 
                    creativos activos hoy, target no agotado, aplicables a esta pantalla.
  demanda_total = suma de daily_budget de todas las líneas_activas
  
  SI demanda_total <= capacidad_restante:
      cada línea recibe exactamente su daily_budget.
      capacidad_restante -= demanda_total   (el sobrante cae en cascada al Paso 2)
  SI demanda_total > capacidad_restante (sobreventa en Patrocinio):
      cada línea recibe: capacidad_restante × (share_weight_línea / suma_de_share_weight_de_todas)
      capacidad_restante = 0

PASO 2 — Estándar (mismo algoritmo, usando lo que quedó de capacidad_restante tras Patrocinio):
  [idéntica lógica que Paso 1, con las líneas de priority_tier='estandar']

PASO 3 — Red interna:
  Lo que sobre de capacidad_restante tras los dos pasos anteriores se reparte entre:
  líneas explícitas con priority_tier='red_interna' (si existen, mismo algoritmo de peso), 
  y el remanente final se divide entre el slot en vivo del SSP de Prodooh y la playlist 
  local (ver documento 03 para el detalle de cómo se intercalan estos dos en la secuencia 
  final del manifiesto).

PASO 4 — Si no hay ninguna Línea de pedido en ningún nivel:
  100% playlist local, igual que antes.
```

### Reparto de creativos dentro de cada Línea de pedido

Una vez que una Línea de pedido tiene asignada su porción de `capacidad_restante` (su número de spots del día), esos spots se reparten entre sus `creatives` activos hoy proporcional a `creatives.weight` — esto ya estaba definido en el documento 01, sin cambios aquí.

### Recálculo: cadencia normal vs. eventos que disparan recálculo inmediato

El presupuesto diario (`daily_budget`) se recalcula en dos circunstancias distintas, y es importante no confundirlas:

**Cadencia normal (rollover de medianoche):** al iniciar cada día, se recalculan los `daily_budget` de todas las Líneas de pedido activas usando `total_daily_spots` completo del día que empieza.

**Evento disparador dentro del día (ej. se activa una nueva Línea de pedido en Patrocinio a las 3pm):** esto NO espera al día siguiente. Dispara un recálculo inmediato, pero usando **capacidad restante del día en curso**, no el total del día:

```
capacidad_restante_hoy = total_daily_spots - impresiones_ya_entregadas_hoy (de cualquier fuente/nivel)
```

A partir de ese momento, el waterfall completo (Patrocinio → Estándar → Red interna) se vuelve a correr usando `capacidad_restante_hoy` como punto de partida, con el conjunto de Líneas de pedido activas actualizado (incluyendo la nueva). Lo que ya se entregó hoy antes del evento **no se revierte ni se recalcula retroactivamente** — solo lo que queda del día se redistribuye bajo las nuevas reglas.

Para la nueva Línea de pedido activada a medio día, su propio `daily_budget` se calcula igual que cualquier otra (`remaining_target / remaining_days`), donde el día de hoy cuenta como un día completo de su rango aunque se haya activado tarde — es una simplificación consciente (no se prorratea por fracción de día), coherente con el resto del algoritmo que ya opera a granularidad de "día", no de hora.

**Resumen de disparadores de recálculo inmediato** (ya listados en la sección de "Regeneración del manifiesto" de este documento, se confirman aquí explícitamente): creación/activación de una Línea de pedido, pausa o edición de una existente, cruce de fecha de inicio/fin, y alcance de `target_spots`. Cualquiera de estos dispara recálculo con `capacidad_restante_hoy`, no espera al rollover de medianoche.

### Nota de simplificación consciente — caso distinto al anterior

Lo de arriba cubre eventos que *agregan o quitan* una Línea de pedido del conjunto activo. Hay un caso distinto que sigue siendo una simplificación deliberada: si una línea `uniform` simplemente **agota su propio `daily_budget`** a media tarde (sin que nada más haya cambiado), cede su lugar el resto del día a la siguiente prioridad disponible — no hay redistribución en tiempo real que le devuelva capacidad extra si otra línea entregó menos de lo esperado. El ajuste ocurre al día siguiente, con el `daily_budget` recalculado sobre lo que realmente falta. Esto es más simple que un pacing continuo tipo GAM real, y se documenta como decisión consciente, no como omisión.

## Entrelazado de impresiones a lo largo del día (anti-bloque)

El algoritmo de asignación diaria (arriba) resuelve **cuántos spots** le tocan hoy a cada Línea de pedido. Pero no basta con saber "la línea A tiene 50 y la línea B tiene 2" — si simplemente se reproducen los 50 de A seguidos y luego los 2 de B, el resultado se siente roto y no representa bien a ninguna de las dos marcas. Esto necesita un algoritmo de **entrelazado proporcional**, no solo un conteo.

### Paso 1 — Orden de entrada de las Líneas de pedido (distribución tipo "Bresenham")

Dado el conjunto de Líneas de pedido activas hoy en un mismo nivel de prioridad, con sus conteos ya resueltos (`count_i` = spots asignados hoy a la línea i, del algoritmo de arriba) y `T` = suma total de todos los `count_i` de ese nivel:

```
Para cada línea i:
    paso_i = T / count_i   (cada cuántas posiciones, en promedio, le toca turno a esta línea)
    Para k = 0 hasta count_i - 1:
        posición_objetivo = round(k × paso_i)
        Colocar un turno de la línea i en esa posición de la secuencia de T slots
        (si la posición ya está ocupada, usar la siguiente posición libre)
```

Esto reparte automáticamente: una línea con 50 de 52 spots totales del día aparece en casi todos los turnos; una línea con 2 de 52 aparece intercalada de forma pareja a lo largo del día, no comprimida al final ni al principio. Es el mismo principio que un scheduler de red usa para repartir ancho de banda entre conexiones de distinto peso sin que una acapare turnos consecutivos.

### Paso 2 — Qué creativo específico se muestra en cada turno de una línea

Cuando le toca turno a una Línea de pedido con múltiples creativos, la selección del creativo específico ya usaba `creatives.weight` (documento 01) para el reparto proporcional — pero hace falta una regla adicional para el caso que describes (activación con 40-50 creativos dinámicos):

- Selección aleatoria ponderada por `weight` entre los creativos activos hoy de esa línea.
- **Regla anti-repetición**: un creativo no puede repetirse en dos turnos consecutivos de la misma línea, y — si el pool de creativos de esa línea tiene más de, digamos, 5 elementos — tampoco debería repetirse dentro de una ventana corta (ej. no repetir hasta que hayan pasado al menos `min(pool_size - 1, 5)` turnos distintos de esa misma línea). Esto es exactamente el comportamiento de "shuffle" real de Spotify: aleatorio, pero con memoria corta para evitar que el azar repita lo mismo demasiado pronto.

### Dónde vive esto y qué genera

Este entrelazado se calcula **una sola vez por ventana de recálculo** (mismo disparador que ya definimos: rollover diario o evento inmediato con `capacidad_restante_hoy`) y su resultado es precisamente la secuencia concreta que se convierte en el manifiesto que consume el player (documento 03) — no es una regla que el player interprete en vivo, es una lista ya resuelta y ordenada, consistente con la decisión de que el manifiesto sea "secuencia concreta, no reglas abstractas".

### Corrección de diseño: la garantía de prioridad es sobre el TOTAL del día, no sobre el ORDEN de consumo dentro del día

Esta es una distinción crítica que las secciones anteriores no dejaban explícita, y que cambia el comportamiento de forma importante: **"Patrocinio tiene prioridad" significa que se le garantiza cumplir su cuota de spots del día, no que se sirve primero y en bloque hasta agotarse.** Si una pantalla opera 16 horas (ej. 6am–10pm) y Patrocinio tiene 40 spots de cupo hoy, esos 40 deben repartirse a lo largo de las 16 horas — no consumirse en las primeras 4 horas dejando el resto del día sin ese contenido.

Esto significa que el entrelazado tipo Bresenham (ya diseñado arriba para repartir creativos dentro de una línea) **se aplica también entre niveles de prioridad, no solo dentro de un mismo nivel** — corrijo lo que decía la sección anterior de "Nota de alcance", que quedaba mal.

### Algoritmo corregido: un solo entrelazado global por día, ponderado por prioridad y cupo

En vez de generar bloques separados por nivel de prioridad y concatenarlos, se genera **una sola secuencia entrelazada** para las `total_daily_spots` posiciones del día, usando el mismo principio de reparto proporcional (Bresenham), pero ahora la "línea" de entrada al algoritmo es cada Línea de pedido individual (de cualquier nivel de prioridad) más el cupo remanente de Red interna:

```
Insumos: lista de (order_line, count_i) para TODAS las líneas activas hoy en TODOS los niveles 
         (Patrocinio + Estándar + Red interna), donde count_i ya viene resuelto por el 
         algoritmo de asignación diaria (waterfall que primero garantiza Patrocinio, 
         luego Estándar con lo que sobra, luego Red interna con el resto).
T = total_daily_spots (todas las posiciones del día)

Para cada línea i (sin importar su nivel de prioridad):
    paso_i = T / count_i
    Para k = 0 hasta count_i - 1:
        posición_objetivo = round(k × paso_i)
        Colocar un turno de la línea i en esa posición
        (si ya está ocupada, usar la siguiente posición libre)
```

La diferencia con el diseño anterior: el **cupo** de cada línea (cuántos spots le tocan hoy) sigue determinándose por el waterfall de prioridad (Patrocinio se sirve primero al momento de *calcular cuántos* le tocan a cada quien) — eso no cambia, Patrocinio sigue teniendo garantizada su entrega completa por encima de Estándar y Red interna. Lo que cambia es que, una vez calculados los cupos, el **orden de aparición a lo largo del día** ya no respeta bloques por nivel — se entrelaza todo junto, proporcional a los conteos de cada línea, sin importar de qué nivel de prioridad viene cada una.

Con tu ejemplo: Patrocinio con 40 spots de cupo y Estándar con 12, en un día de 52 posiciones totales, el resultado es que Patrocinio aparece aproximadamente cada 1.3 turnos y Estándar aparece intercalado cada ~4.3 turnos, distribuidos parejo de las 6am a las 10pm — nunca "se acaba" Patrocinio a media mañana dejando el resto del día solo con Estándar.

### Qué NO cambia de las secciones anteriores

- El cálculo de **cuántos spots** le tocan a cada línea (`daily_budget`, waterfall Patrocinio→Estándar→Red interna, reparto por `share_weight` cuando compiten varias del mismo nivel) sigue exactamente igual — esa lógica de *cupo* no se toca.
- El reparto de creativos dentro de una línea (`weight` + regla anti-repetición) sigue igual, ahora simplemente ocurre en cada turno que le toca a esa línea dentro de la secuencia entrelazada global, en vez de dentro de un bloque separado por nivel.
- Sigue habiendo un único recálculo por evento disparador (rollover diario o cambio inmediato con `capacidad_restante_hoy`) — no se vuelve continuo.

### Nota de alcance — franjas horarias por Línea de pedido (`time_window`)

El campo `order_lines.time_window` (documento 01) es un stub de arquitectura para una necesidad futura ya identificada (ej. campañas ligadas a eventos como partidos de fútbol, que deben correr en una franja horaria específica en vez de distribuirse parejo en todo el día). **El algoritmo descrito en este documento NO implementa esta restricción todavía** — trata a todas las Líneas de pedido como si aplicaran a todo el horario operativo, sin importar si `time_window` viene poblado o no.

Cuando se implemente en una iteración futura, el cambio necesario sería: en vez de que `total_daily_spots` sea un solo pool entrelazado para todo el día, las líneas con `time_window` definido deberían resolverse dentro de un sub-pool acotado a esa franja (su propio cálculo de posiciones Bresenham dentro de ese rango de horas, no del día completo), mientras el resto de líneas sin restricción siguen usando el pool completo del día descontando las posiciones ya tomadas por las franjas específicas. Esto es un cambio real al algoritmo de entrelazado, no trivial — se documenta aquí como ruta de extensión conocida, no se construye ahora.

## Consumo de `target_spots`

Cada vez que se registra una `impression` con `result = success` ligada a un `order_line_id`, cuenta contra el `target_spots` de esa línea (si tiene uno definido) y contra su `daily_budget` del día en curso (ver algoritmo arriba). Cuando una Línea de pedido alcanza su `target_spots` total, deja de participar en la resolución (se excluye de `líneas_activas` en cualquier paso del algoritmo), aunque sus fechas sigan vigentes — se considera "cumplida". A diferencia de la versión anterior de este documento, el ritmo al que se llega a ese total ya no es "lo que sobre" sino gobernado activamente por `delivery_pace` — una línea `uniform` reparte su entrega a lo largo de todos sus días de vigencia; una línea `asap` intenta agotar su target lo antes posible.

Nota de riesgo aceptado (ya discutida y aceptada): si una pantalla estuvo offline y no ha reportado impresiones recientes, el motor puede sobre-asignar temporalmente turnos a una línea que en realidad ya iba más entregada de lo que el backend cree. Se acepta este riesgo para el volumen actual de pantallas; no se construye reconciliación retroactiva en esta fase.

## Regeneración del manifiesto

El motor no corre "en vivo" por cada request del player — se recalcula el manifiesto vigente de una pantalla cuando:
- Cambia algo relevante (se crea/edita/pausa una Línea de pedido o Pedido que aplica a esa pantalla o su grupo).
- Se cruza una fecha límite (una Línea de pedido empieza o termina su vigencia).
- Se alcanza un `target_spots` (la línea deja de participar, hay que recalcular sin ella).

El player, por su parte, hace polling periódico preguntando si hay una versión nueva (ver documento 03) — el cálculo mismo del manifiesto ocurre del lado del backend de forma reactiva a estos eventos, no en cada polling.

## Sobre GAM

No participa en ningún nivel de esta cascada. Ver documento 00 — pausado por completo en esta reingeniería.