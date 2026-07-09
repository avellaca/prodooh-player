# 00 — Contexto y Alcance de la Reingeniería

## Por qué esta reingeniería

El sistema actual distribuye contenido mediante un **Loop de slots fijos** (N slots con una fuente asignada a cada uno, duración fija, sin conocimiento de campañas comerciales). Este modelo no puede representar la forma real en que Prodooh vende inventario DOOH: **Pedidos** con fechas de vigencia, que contienen una o más **Líneas de pedido** dirigidas a pantallas/grupos específicos, con **prioridad de entrega** (Patrocinio > Estándar > Red interna) — replicando, en la medida de lo razonable para un equipo de 3 personas, los principios de un ad server real (inspirado en Google Ad Manager), sin intentar igualar 20 años de desarrollo.

Esta reingeniería **reemplaza por completo** el motor de Loop de slots fijos. No es una extensión — el `LoopEngine` actual y su lógica de `loop_config`/`sources_config` quedan obsoletos y se sustituyen por el motor de prioridad descrito en los documentos 02 y 03.

Adicionalmente, esta reingeniería resuelve tres deficiencias detectadas en la auditoría del estado actual (independientes del motor de Loop, pero que se integran naturalmente aquí porque tocan las mismas piezas que se están reconstruyendo):
- El registro de reproducciones (`PlaybackLogger`) existe como clase pero nunca se conectó al motor de ejecución — ninguna reproducción se ha registrado nunca.
- La confirmación de proof-of-play al SSP de Prodooh es "fire and forget" sin reintentos ante fallo de red.
- El JWT de autenticación del dispositivo no se renueva automáticamente al expirar, causando fallos silenciosos (incluido el propio heartbeat).

## Terminología (reemplaza términos anteriores)

| Término anterior | Término nuevo | Nota |
|---|---|---|
| Campaña / Circuito | **Pedido** / **Línea de pedido** | Terminología cerrada con el CTO, no se usa "Circuito" ni "Campaña" como nivel de dato. |
| Tenant (en UI) | **Network** | Solo relabel de interfaz. La tabla `tenants` y el modelo de datos NO cambian de nombre. |
| Loop de slots fijos | **Motor de prioridad** | Ver documento 02. |

## Jerarquía de entidades nueva

```
Pedido (fecha inicio/fin general)
  └── Línea de pedido (fechas dentro del rango del Pedido; prioridad: Patrocinio/Estándar/Red interna; 
      pantallas o grupos objetivo; meta de spots; ritmo de entrega)
        └── Creativo (fechas dentro del rango de la Línea de pedido; conjunto explícito de días activos, 
            no un patrón de recurrencia — soporta selección libre tipo calendario: fines de semana, 
            jueves-domingo, rangos múltiples, etc.; peso/porcentaje de rotación entre creativos de la 
            misma línea)
```

Regla estricta de fechas: **cada nivel puede acotar más al nivel superior, nunca expandirlo.** Un Creativo no puede tener fechas fuera del rango de su Línea de pedido; una Línea de pedido no puede tener fechas fuera del rango de su Pedido.

## Fuera de alcance de esta reingeniería

- **GAM/VAST**: se pausa por completo. El código de `GamVastSource` no se elimina, pero queda fuera de la cascada de prioridad activa. No se decide todavía dónde encajaría — se retomará en una iteración futura dedicada, una vez su integración esté mejor entendida.
- **Subastas privadas / múltiples SSPs programáticos reales (Vistar, Broadsign, etc.)**: fuera de alcance, es una fase de negocio posterior.
- **Compra por audiencia/impactos (Kido/Infinia)** en vez de spots: fuera de alcance, fase posterior.
- **Plataforma de creativos dinámicos**: es un proyecto separado (en desarrollo por el CTO en paralelo), no se integra al player en esta reingeniería.
- **Sub-niveles de prioridad dentro de Estándar** (alto/normal/bajo, como en GAM): se arranca solo con tres niveles planos — Patrocinio / Estándar / Red interna. Sub-niveles quedan para una iteración posterior si se necesitan.
- **Franjas horarias específicas por Línea de pedido** (ej. una campaña ligada a un evento como un partido de fútbol, que debe correr solo en una ventana de horas determinada en vez de distribuirse parejo en todo el día). Se deja un stub de arquitectura en el modelo de datos (`order_lines.time_window`, documento 01) para no requerir una migración dolorosa después, pero el algoritmo de esta fase (documento 02) no implementa ninguna restricción horaria — todas las líneas se tratan como si aplicaran a todo el horario operativo.
- **Pacing sofisticado** ("uniforme" vs. "lo antes posible" con curvas de entrega): la primera versión del motor de prioridad usa una regla determinística simple (ver documento 02), sin optimización de ritmo de entrega todavía.
- **Duración configurable por pantalla o por creativo individual**: la duración de contenido estático se estandariza como máximo a nivel Network o Grupo de pantallas. No se permite override a nivel pantalla ni a nivel creativo (excepto la duración natural intrínseca de video, que siempre se respeta tal cual).

## Qué SÍ sigue vigente sin cambios de esta reingeniería

- El mecanismo de "nunca pantalla en negro": fallback a playlist local pre-bufferizada, doble buffer con prefetch.
- La integración con el SSP de Ad Serving de Prodooh (`POST /public/v1/ad`, proof_of_play, expiration) — se reutiliza tal cual, pero ahora vive dentro de la prioridad "Red interna" como fallback de último nivel, no como fuente de nivel fijo garantizado.
- El aislamiento multi-tenant (Network/tenant_admin vs. super_admin) ya construido.
- El modelo de aprovisionamiento de pantalla (venue_id, token, autenticación de dispositivo).
- Los scripts de deploy/kiosko en Raspberry Pi (provisioning, systemd, watchdog) — no forman parte de esta reingeniería de software, son un tema de infraestructura aparte.

## Decisión pendiente de resolución en el documento 02

Dónde queda GAM dentro de la nueva cascada de prioridad: por ahora, **no se incluye en ningún nivel** (ni Patrocinio, ni Estándar, ni Red interna). El código existente se conserva intacto pero inactivo.