# Documento de Requisitos — Mejoras UX en OrderLine

## Introducción

Este documento especifica los requisitos para mejorar la experiencia de usuario en la gestión de líneas de pedido (OrderLine) del panel administrativo. Los cambios incluyen: eliminar la entrada manual de fechas de inicio/fin en favor de cálculo automático desde las fechas activas, hacer obligatorio el campo de spots objetivo con un nuevo modo de entrada (por día o por línea), mostrar el total de spots del pedido, y estandarizar las etiquetas en español entre las vistas de creación y edición.

## Glosario

- **Sistema_Frontend**: La aplicación web de administración (admin-frontend) construida con React.
- **OrderLine_Form**: El formulario de creación y edición de líneas de pedido, presente tanto en el diálogo de creación rápida (CreateOrderLineDialog) como en el componente OrderLineForm reutilizable.
- **ActiveDatesPicker**: El componente selector de fechas activas que permite elegir días individuales dentro de un rango.
- **Order_Detail_Card**: La tarjeta "Información del pedido" mostrada en la página de detalle del pedido (OrderDetailPage).
- **Order**: La entidad padre que contiene starts_at y ends_at como rango de fechas del pedido.
- **OrderLine**: La entidad hija de un Order que define una línea de entrega con fechas activas, spots objetivo y otros parámetros.
- **spots_mode**: Campo de selección en el frontend que determina el modo de entrada de spots: "spots_por_dia" (spots por día) o "spots_por_linea" (total directo).
- **active_dates**: Array JSON de fechas (formato YYYY-MM-DD) en las que la línea de pedido está activa.
- **target_spots**: Número entero que representa la cantidad total de spots objetivo almacenada en backend.

## Requisitos

### Requisito 1: Eliminación de entrada manual de starts_at/ends_at

**User Story:** Como operador del sistema, quiero que las fechas de inicio y fin de una línea de pedido se calculen automáticamente a partir de las fechas activas seleccionadas, para evitar inconsistencias entre los campos.

#### Criterios de Aceptación

1. THE OrderLine_Form SHALL omitir los campos de entrada manual de starts_at y ends_at del formulario de línea de pedido.
2. WHEN el usuario selecciona fechas en el ActiveDatesPicker, THE Sistema_Frontend SHALL calcular starts_at como el valor mínimo del array active_dates y ends_at como el valor máximo del array active_dates.
3. WHEN el usuario envía el formulario de línea de pedido, THE Sistema_Frontend SHALL incluir starts_at y ends_at calculados en el payload enviado al backend de forma transparente.
4. THE ActiveDatesPicker SHALL utilizar las fechas starts_at y ends_at del Order padre como límites mínimo y máximo del rango seleccionable.
5. WHEN el array active_dates está vacío, THE OrderLine_Form SHALL impedir el envío del formulario y mostrar un mensaje de validación indicando que se requiere al menos una fecha activa.

### Requisito 2: Target spots obligatorio con modo de entrada

**User Story:** Como operador del sistema, quiero poder ingresar los spots objetivo de forma total o por día, para facilitar la planificación de campañas con múltiples fechas activas.

#### Criterios de Aceptación

1. THE OrderLine_Form SHALL incluir un campo selector spots_mode con las opciones "Spots por día" y "Spots por línea".
2. THE OrderLine_Form SHALL requerir un valor numérico entero mayor o igual a 1 en el campo de spots objetivo en ambos modos.
3. WHILE spots_mode tiene el valor "spots_por_dia", THE OrderLine_Form SHALL mostrar un campo de entrada para la cantidad de spots por día.
4. WHILE spots_mode tiene el valor "spots_por_dia", THE Sistema_Frontend SHALL calcular el total de spots como spots_per_day multiplicado por la cantidad de elementos en active_dates.
5. WHILE spots_mode tiene el valor "spots_por_dia", THE OrderLine_Form SHALL mostrar el total calculado como texto informativo debajo del campo de entrada.
6. WHILE spots_mode tiene el valor "spots_por_linea", THE OrderLine_Form SHALL mostrar un campo de entrada para la cantidad total de spots directamente.
7. WHEN el usuario envía el formulario, THE Sistema_Frontend SHALL enviar al backend el valor total calculado como target_spots, independientemente del modo seleccionado.
8. WHEN el modo es "spots_por_dia" y el array active_dates cambia, THE Sistema_Frontend SHALL recalcular y actualizar el total mostrado de forma inmediata.

### Requisito 3: Total de spots por pedido en la vista de detalle

**User Story:** Como operador del sistema, quiero ver el total de spots de todas las líneas de un pedido en la tarjeta de información, para tener visibilidad rápida del volumen total de la campaña.

#### Criterios de Aceptación

1. THE Order_Detail_Card SHALL mostrar una fila con la etiqueta "Total spots" que muestre la suma de target_spots de todas las líneas de pedido del Order.
2. WHEN una línea de pedido tiene target_spots con valor nulo, THE Sistema_Frontend SHALL tratar ese valor como cero en la suma total.
3. WHEN no existen líneas de pedido para el Order, THE Order_Detail_Card SHALL mostrar "0" como valor del total de spots.

### Requisito 4: Estandarización de etiquetas en español

**User Story:** Como operador del sistema, quiero que las etiquetas sean consistentes y estén en español en todas las vistas, para una experiencia de usuario coherente.

#### Criterios de Aceptación

1. THE Sistema_Frontend SHALL mostrar "Ritmo de entrega" como encabezado de columna de la tabla de líneas de pedido en la página de detalle, reemplazando "Pace".
2. THE Sistema_Frontend SHALL mostrar "Lo antes posible" como texto de la opción de ritmo de entrega con valor "asap" en el diálogo CreateOrderLineDialog.
3. THE Sistema_Frontend SHALL mostrar "Spots objetivo" como etiqueta del campo target_spots en todos los formularios, sin la indicación "(opcional)".
4. THE Sistema_Frontend SHALL mostrar "Peso de reparto" como etiqueta del campo share_weight en todos los formularios, reemplazando "Peso (share_weight)".
5. THE Sistema_Frontend SHALL utilizar etiquetas idénticas para todos los campos que aparecen tanto en la vista de creación (CreateOrderLineDialog) como en la vista de edición (OrderLineForm).
