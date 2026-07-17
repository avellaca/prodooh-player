# Requirements Document

## Introduction

Este documento define los requisitos para las mejoras en la experiencia de asignación de creativos en el sistema de gestión de publicidad DOOH (Digital Out-Of-Home). El alcance cubre: carga masiva con auto-matching por resolución, vistas tabuladas (resolución/grupo/pantalla), orden de reproducción secuencial con drag & drop, eliminación granular por pantalla, edición inline de peso, tracking pixels, validación de duración de video, mejoras al selector de biblioteca, preview de loop, copia de creativos entre líneas, y validación inteligente de cobertura.

## Glossary

- **Sistema**: El sistema de gestión de publicidad DOOH (backend Laravel + frontend React)
- **Biblioteca**: Repositorio centralizado de contenido multimedia (modelo Content) del tenant
- **Creative**: Registro que vincula un Content a un OrderLineTarget con peso y resolución
- **Content**: Archivo multimedia (imagen o video) con metadata (dimensiones, duración, mime_type, checksum)
- **OrderLine**: Línea de pedido publicitaria dentro de una Order
- **OrderLineTarget**: Asociación entre una OrderLine y una pantalla individual o grupo de pantallas
- **ResolutionGroup**: Agrupación virtual de pantallas que comparten las mismas dimensiones de resolución
- **ScreenGroup**: Agrupación lógica de pantallas definida por el usuario
- **Manifest**: Loop Template JSON generado por el LoopTemplateGenerator y entregado al player
- **Player**: Aplicación cliente que reproduce el contenido en la pantalla física
- **Tag**: Etiqueta textual asignada a un Content para facilitar búsqueda y organización
- **Tracking_Pixel**: URL de seguimiento que se dispara al registrar una impresión o reproducción
- **Playback_Mode**: Modo de reproducción de creativos: round_robin (rotación equitativa) o sequential (orden fijo)
- **Slot_Duration**: Duración en segundos de cada slot de reproducción configurado por jerarquía tenant/grupo/pantalla
- **Peso**: Valor numérico (weight) que determina la frecuencia relativa de aparición de un creativo
- **Usuario administrador**: Cualquier usuario con rol trafficker, tenant_admin o super_admin que tiene acceso a la gestión de pedidos, creativos y contenido

## Requirements

### Requisito 1: Carga masiva a Biblioteca con etiquetas

**User Story:** Como usuario administrador (trafficker, tenant_admin o super_admin), quiero subir múltiples archivos a la Biblioteca asignándoles tags, para poder organizarlos y encontrarlos fácilmente después.

#### Criterios de Aceptación

1. WHEN el usuario selecciona múltiples archivos en el diálogo de carga de la Biblioteca, THE Sistema SHALL aceptar la carga simultánea de hasta 50 archivos por lote
2. WHEN el usuario carga archivos a la Biblioteca, THE Sistema SHALL permitir asignar uno o más Tags a todos los archivos del lote durante la carga
3. WHEN un archivo se carga exitosamente, THE Sistema SHALL extraer y almacenar la metadata: dimensiones (width, height), duración (para video), tamaño de archivo, mime_type y checksum_sha256
4. IF un archivo falla durante la carga, THEN THE Sistema SHALL continuar procesando los archivos restantes del lote y mostrar un resumen indicando archivos exitosos y fallidos con el motivo del error
5. WHEN el usuario navega a la Biblioteca, THE Sistema SHALL permitir agregar o editar Tags en contenidos existentes

---

### Requisito 2: Selección masiva desde Biblioteca con auto-matching por resolución

**User Story:** Como usuario administrador (trafficker, tenant_admin o super_admin), quiero seleccionar múltiples archivos de la Biblioteca y que se asignen automáticamente a los grupos de resolución correctos, para agilizar la asignación de creativos a una línea de pedido.

#### Criterios de Aceptación

1. WHEN el usuario abre el selector de Biblioteca desde una OrderLine, THE Sistema SHALL mostrar todos los Content del tenant con capacidad de búsqueda por Tags, nombre de archivo y dimensiones
2. WHEN el usuario selecciona múltiples Content del selector, THE Sistema SHALL crear un Creative individual por cada pantalla cuya resolución coincida con las dimensiones del Content seleccionado
3. WHEN un Content seleccionado no coincide con ninguna resolución de las pantallas asignadas a la OrderLine, THE Sistema SHALL mostrar una advertencia indicando que el archivo permanece en la Biblioteca sin asignar y especificando la resolución del archivo versus las resoluciones requeridas
4. WHEN se crean Creatives por auto-matching, THE Sistema SHALL asignar un peso por defecto de 100 a cada Creative creado
5. WHEN el auto-matching se completa, THE Sistema SHALL mostrar un resumen con: cantidad de creativos creados, pantallas cubiertas, y archivos no coincidentes

---

### Requisito 3: Carga directa desde OrderLine con auto-matching

**User Story:** Como usuario administrador (trafficker, tenant_admin o super_admin), quiero subir archivos directamente desde la vista de detalle de una OrderLine y que se asignen automáticamente por resolución, para no tener que ir primero a la Biblioteca.

#### Criterios de Aceptación

1. WHEN el usuario sube archivos desde la página de detalle de OrderLine, THE Sistema SHALL almacenar los archivos en la Biblioteca y crear Creatives en las pantallas cuya resolución coincida con las dimensiones de cada archivo
2. WHEN se suben múltiples archivos con diferentes resoluciones, THE Sistema SHALL distribuir cada archivo al grupo de resolución correspondiente de forma independiente
3. WHEN un archivo subido no coincide con ninguna resolución de la OrderLine, THE Sistema SHALL almacenar el archivo en la Biblioteca y mostrar una advertencia indicando la falta de coincidencia
4. WHEN la carga directa se completa, THE Sistema SHALL actualizar la vista de grupos de resolución reflejando los nuevos creativos asignados

---

### Requisito 4: Vista tabulada Por Resolución

**User Story:** Como usuario administrador (trafficker, tenant_admin o super_admin), quiero ver los creativos agrupados por resolución de pantalla (comportamiento actual), para gestionar contenido por dimensiones.

#### Criterios de Aceptación

1. THE Sistema SHALL mostrar la pestaña "Por Resolución" como la vista activa por defecto en la sección de creativos de una OrderLine
2. WHEN el usuario está en la pestaña "Por Resolución", THE Sistema SHALL agrupar las pantallas asignadas por sus dimensiones (width × height) mostrando una ResolutionGroupCard por cada grupo único
3. WHEN el usuario expande una ResolutionGroupCard, THE Sistema SHALL mostrar la lista de pantallas individuales del grupo con sus creativos asignados y controles de gestión

---

### Requisito 5: Vista tabulada Por Grupo

**User Story:** Como usuario administrador (trafficker, tenant_admin o super_admin), quiero ver los creativos organizados por ScreenGroup, para gestionar contenido según la agrupación lógica de mis pantallas.

#### Criterios de Aceptación

1. WHEN el usuario selecciona la pestaña "Por Grupo", THE Sistema SHALL mostrar las pantallas asignadas a la OrderLine agrupadas por su ScreenGroup
2. WHEN una pantalla no pertenece a ningún ScreenGroup, THE Sistema SHALL mostrarla bajo una sección "Sin grupo"
3. WHEN el usuario está en la vista "Por Grupo", THE Sistema SHALL permitir agregar, eliminar y reordenar creativos a nivel de cada ScreenGroup
4. WHEN el usuario modifica creativos en la vista "Por Grupo", THE Sistema SHALL aplicar los cambios a los Creatives individuales de cada pantalla del grupo afectado

---

### Requisito 6: Vista tabulada Por Pantalla

**User Story:** Como usuario administrador (trafficker, tenant_admin o super_admin), quiero ver una lista plana de todas las pantallas asignadas con gestión directa de creativos por pantalla, para tener control granular total.

#### Criterios de Aceptación

1. WHEN el usuario selecciona la pestaña "Por Pantalla", THE Sistema SHALL mostrar una lista plana de todas las pantallas individuales asignadas a la OrderLine
2. WHEN el usuario está en la vista "Por Pantalla", THE Sistema SHALL mostrar los creativos asignados a cada pantalla con controles para agregar, eliminar y reordenar
3. WHEN la OrderLine tiene más de 20 pantallas asignadas, THE Sistema SHALL paginar o virtualizar la lista para mantener el rendimiento de la interfaz
4. THE Sistema SHALL permitir ordenar la lista de pantallas por nombre (alfabético) y por resolución (width × height)
5. THE Sistema SHALL incluir un campo de búsqueda inline que filtre las pantallas por nombre en tiempo real conforme el usuario escribe

---

### Requisito 7: Modo de reproducción a nivel de OrderLine

**User Story:** Como usuario administrador (trafficker, tenant_admin o super_admin), quiero configurar el modo de reproducción (round_robin o sequential) a nivel de la línea de pedido, para controlar cómo el player selecciona los creativos.

#### Criterios de Aceptación

1. THE Sistema SHALL soportar dos valores de Playback_Mode para una OrderLine: "round_robin" (por defecto) y "sequential"
2. WHEN se crea una nueva OrderLine, THE Sistema SHALL asignar Playback_Mode "round_robin" como valor por defecto
3. WHEN el usuario cambia el Playback_Mode de una OrderLine a "sequential", THE Sistema SHALL habilitar la funcionalidad de ordenamiento por posición en los creativos de la línea
4. WHEN el Playback_Mode es "round_robin", THE Sistema SHALL continuar con el comportamiento actual de rotación por peso

---

### Requisito 8: Override de modo de reproducción por pantalla

**User Story:** Como usuario administrador (trafficker, tenant_admin o super_admin), quiero poder establecer un modo de reproducción diferente en pantallas individuales, para casos donde una pantalla necesita un comportamiento distinto al resto de la línea.

#### Criterios de Aceptación

1. WHEN el usuario configura un Playback_Mode override en un OrderLineTarget específico, THE Sistema SHALL usar ese modo para la pantalla correspondiente en lugar del modo de la OrderLine
2. WHILE un OrderLineTarget no tiene override de Playback_Mode, THE Sistema SHALL heredar el Playback_Mode de la OrderLine padre
3. WHEN el usuario elimina el override de un OrderLineTarget, THE Sistema SHALL revertir al Playback_Mode de la OrderLine padre

---

### Requisito 9: Ordenamiento por drag & drop en modo secuencial

**User Story:** Como usuario administrador (trafficker, tenant_admin o super_admin), quiero reordenar los creativos mediante drag & drop cuando el modo es secuencial, para definir el orden exacto de reproducción.

#### Criterios de Aceptación

1. WHILE el Playback_Mode es "sequential" para una pantalla o línea, THE Sistema SHALL mostrar los creativos en orden ascendente por su campo "position" y habilitar reordenamiento por drag & drop
2. WHEN el usuario reordena creativos mediante drag & drop, THE Sistema SHALL actualizar el campo "position" de los creativos afectados para reflejar el nuevo orden
3. WHEN se agrega un nuevo Creative en modo secuencial, THE Sistema SHALL asignarle la siguiente posición disponible (última posición + 1)
4. WHILE el Playback_Mode es "round_robin", THE Sistema SHALL ocultar la funcionalidad de drag & drop y no mostrar indicadores de posición

---

### Requisito 10: Manifest con orden secuencial

**User Story:** Como operador del sistema, quiero que el manifest incluya candidatos ordenados cuando el modo es secuencial, para que el player reproduzca en el orden definido.

#### Criterios de Aceptación

1. WHEN el LoopTemplateGenerator genera un manifest para una pantalla con Playback_Mode "sequential", THE Sistema SHALL incluir los candidatos del slot ordenados por el campo "position" de los Creatives
2. WHEN el Playback_Mode es "sequential", THE Sistema SHALL establecer la estrategia del slot como "sequential" en lugar de "round_robin" en el manifest
3. WHEN un Creative no tiene valor de "position" asignado en modo secuencial, THE Sistema SHALL colocarlo al final de la lista de candidatos

---

### Requisito 11: Creativos a nivel de pantalla individual (explosión de grupo)

**User Story:** Como usuario administrador (trafficker, tenant_admin o super_admin), quiero que eliminar un creativo de una pantalla no afecte a las demás pantallas, para tener control granular sobre las asignaciones.

#### Criterios de Aceptación

1. WHEN se asignan creativos mediante cualquier flujo (bulk, selector, carga directa), THE Sistema SHALL crear un registro Creative individual por cada pantalla afectada, vinculado al OrderLineTarget de esa pantalla específica
2. WHEN el usuario elimina un Creative de una pantalla, THE Sistema SHALL eliminar únicamente el registro Creative de esa pantalla sin afectar los registros de otras pantallas
3. WHEN existen creativos heredados de OrderLineTargets de tipo grupo (datos históricos), THE Sistema SHALL migrar esos registros a creativos individuales por pantalla mediante una migración de base de datos

---

### Requisito 12: Edición inline de peso

**User Story:** Como usuario administrador (trafficker, tenant_admin o super_admin), quiero editar el peso de un creativo directamente en su tarjeta sin navegar a otra vista, para agilizar los ajustes de distribución.

#### Criterios de Aceptación

1. THE Sistema SHALL mostrar el valor del Peso de cada Creative visible en la tarjeta/thumbnail del creativo a nivel de ResolutionGroupCard
2. WHEN el usuario hace clic en el valor del Peso, THE Sistema SHALL transformar el display en un campo numérico editable inline
3. WHEN el usuario confirma el nuevo valor (presionando Enter o desenfocando el campo), THE Sistema SHALL persistir el nuevo Peso y actualizar la vista sin recargar la página
4. IF el usuario ingresa un valor de Peso menor a 1 o no numérico, THEN THE Sistema SHALL rechazar el cambio y mostrar un mensaje de validación
5. WHILE el Playback_Mode es "sequential" para la pantalla, THE Sistema SHALL ocultar el control de edición de Peso dado que en modo secuencial el peso no aplica

---

### Requisito 13: Tracking Pixels a nivel de Order

**User Story:** Como usuario administrador (trafficker, tenant_admin o super_admin), quiero configurar tracking pixels a nivel de Order que se disparen para todas las impresiones de esa orden, para reportar métricas al anunciante.

#### Criterios de Aceptación

1. WHEN el usuario agrega un Tracking_Pixel a una Order, THE Sistema SHALL almacenar la URL, el trigger_type (play o impression) y el multiplier (aplicable solo cuando trigger_type es impression)
2. WHEN el backend registra una impresión de cualquier Creative perteneciente a esa Order, THE Sistema SHALL disparar todos los Tracking_Pixels configurados a nivel Order con trigger_type coincidente
3. THE Sistema SHALL permitir configurar múltiples Tracking_Pixels por Order sin límite máximo

---

### Requisito 14: Tracking Pixels a nivel de OrderLine

**User Story:** Como usuario administrador (trafficker, tenant_admin o super_admin), quiero configurar tracking pixels a nivel de OrderLine para reportes específicos por línea de pedido.

#### Criterios de Aceptación

1. WHEN el usuario agrega un Tracking_Pixel a una OrderLine, THE Sistema SHALL almacenar la URL, el trigger_type y el multiplier
2. WHEN el backend registra una impresión de un Creative perteneciente a esa OrderLine, THE Sistema SHALL disparar los Tracking_Pixels del nivel Order y los del nivel OrderLine correspondiente
3. WHEN el trigger_type es "impression" y el multiplier es mayor a 1, THE Sistema SHALL disparar el pixel tantas veces como indique el multiplier por cada impresión registrada

---

### Requisito 15: Tracking Pixels a nivel de Creative

**User Story:** Como usuario administrador (trafficker, tenant_admin o super_admin), quiero configurar tracking pixels en creativos individuales para tracking granular por pieza creativa.

#### Criterios de Aceptación

1. WHEN el usuario agrega un Tracking_Pixel a un Creative, THE Sistema SHALL almacenar la URL, el trigger_type y el multiplier
2. WHEN el backend registra una impresión de un Creative específico, THE Sistema SHALL disparar los Tracking_Pixels de los tres niveles: Order, OrderLine y Creative
3. THE Sistema SHALL disparar los pixels de forma acumulativa (todos los niveles aplican, no se sobreescriben)

---

### Requisito 16: Disparo server-side de Tracking Pixels con reintentos

**User Story:** Como operador del sistema, quiero que los tracking pixels se disparen desde el backend con lógica de reintentos, para garantizar la entrega confiable de datos de seguimiento.

#### Criterios de Aceptación

1. WHEN el backend debe disparar un Tracking_Pixel, THE Sistema SHALL enviar una petición HTTP GET a la URL del pixel desde el servidor (server-side)
2. IF el disparo de un Tracking_Pixel falla (respuesta HTTP no-2xx o timeout), THEN THE Sistema SHALL encolar el reintento con backoff exponencial hasta un máximo de 3 reintentos
3. WHEN todos los reintentos de un Tracking_Pixel fallan, THE Sistema SHALL registrar el fallo en un log con la URL, timestamp, código de error y Creative asociado
4. THE Sistema SHALL procesar los disparos de Tracking_Pixels mediante una cola de trabajos asíncrona para no bloquear el registro de impresiones

---

### Requisito 17: Validación de duración de video vs slot

**User Story:** Como usuario administrador (trafficker, tenant_admin o super_admin), quiero recibir una advertencia cuando un video excede la duración del slot, para tomar decisiones informadas sobre la asignación.

#### Criterios de Aceptación

1. WHEN se asigna un Content de tipo video a una pantalla, THE Sistema SHALL comparar la duración del video con la Slot_Duration configurada para esa pantalla (resuelta por jerarquía: grupo → tenant → 10s)
2. IF la duración del video excede la Slot_Duration de al menos una pantalla destino, THEN THE Sistema SHALL mostrar una advertencia visual no-bloqueante indicando la duración del video y la Slot_Duration del slot
3. WHEN se muestra la advertencia de duración, THE Sistema SHALL permitir al usuario confirmar la asignación de todos modos (la advertencia no bloquea la operación)
4. WHILE se visualiza un Creative cuyo Content es un video que excede la Slot_Duration, THE Sistema SHALL mostrar un indicador persistente de advertencia en la tarjeta del creativo

---

### Requisito 18: Selector de Biblioteca mejorado con metadata

**User Story:** Como usuario administrador (trafficker, tenant_admin o super_admin), quiero buscar contenido por tags y ver metadata relevante en el selector, para tomar mejores decisiones de asignación.

#### Criterios de Aceptación

1. WHEN el usuario abre el LibrarySelector, THE Sistema SHALL mostrar para cada Content: thumbnail, nombre de archivo, dimensiones, duración (si es video), tamaño de archivo y fecha de carga
2. WHEN el usuario escribe en el campo de búsqueda del LibrarySelector, THE Sistema SHALL filtrar resultados por coincidencia en Tags, nombre de archivo y dimensiones
3. WHEN un Content ya está asignado a la OrderLine actual, THE Sistema SHALL mostrarlo con un indicador visual "Ya asignado" para evitar duplicados involuntarios
4. THE Sistema SHALL permitir selección múltiple de Content en el LibrarySelector para asignación por lote

---

### Requisito 19: Preview de Loop por pantalla

**User Story:** Como usuario administrador (trafficker, tenant_admin o super_admin), quiero previsualizar cómo se verá la secuencia completa del loop en una pantalla específica, para verificar la experiencia final antes de activar.

#### Criterios de Aceptación

1. WHEN el usuario presiona el botón "Preview" en una pantalla específica, THE Sistema SHALL mostrar una simulación visual del loop mostrando la secuencia de creativos en sus slots asignados
2. WHEN se muestra el preview, THE Sistema SHALL incluir información de timing: duración de cada slot, posición en el loop, y tipo de slot (ad, ssp, playlist)
3. WHEN el Playback_Mode es "sequential", THE Sistema SHALL mostrar los creativos en su orden de posición definido
4. WHEN el Playback_Mode es "round_robin", THE Sistema SHALL mostrar los creativos indicando la frecuencia de rotación basada en pesos

---

### Requisito 20: Copiar creativos entre OrderLines

**User Story:** Como usuario administrador (trafficker, tenant_admin o super_admin), quiero copiar las asignaciones de creativos de una OrderLine a otra, para reutilizar configuraciones sin recrearlas manualmente.

#### Criterios de Aceptación

1. WHEN el usuario inicia la acción "Copiar creativos" en una OrderLine, THE Sistema SHALL mostrar un selector de OrderLine destino (de la misma orden o de otra orden del mismo tenant)
2. WHEN se ejecuta la copia, THE Sistema SHALL crear nuevos registros Creative en la OrderLine destino para cada Content cuyas dimensiones coincidan con alguna resolución de pantalla asignada en la línea destino
3. IF un Content de la línea origen no coincide con ninguna resolución de la línea destino, THEN THE Sistema SHALL omitir ese Content y reportarlo en el resumen final
4. WHEN la copia se completa, THE Sistema SHALL mostrar un resumen indicando: creativos copiados, creativos omitidos por falta de coincidencia de resolución, y pantallas cubiertas

---

### Requisito 21: Migración de creativos grupo a pantalla

**User Story:** Como operador del sistema, quiero que los creativos existentes vinculados a OrderLineTargets de tipo grupo se migren a registros individuales por pantalla, para habilitar la eliminación granular.

#### Criterios de Aceptación

1. WHEN se ejecuta la migración, THE Sistema SHALL identificar todos los Creative vinculados a OrderLineTargets que tienen screen_group_id (no screen_id)
2. WHEN se procesa un Creative de grupo, THE Sistema SHALL crear un Creative individual para cada pantalla del ScreenGroup, copiando content_id, weight, resolution_width y resolution_height del original
3. WHEN la migración se completa para un Creative de grupo, THE Sistema SHALL eliminar el Creative original de grupo y marcar el OrderLineTarget de grupo como procesado
4. IF la migración falla para un Creative específico, THEN THE Sistema SHALL registrar el error y continuar con los demás sin afectar los registros ya migrados
5. WHEN un Creative existente tiene resolution_width o resolution_height con valor NULL, THE Sistema SHALL asignar los valores de width y height del Content asociado para corregir datos legados
