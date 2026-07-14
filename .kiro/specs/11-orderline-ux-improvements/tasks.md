# Plan de Implementación: Mejoras UX en OrderLine

## Overview

Implementación de las mejoras de experiencia de usuario en el formulario de OrderLine. Se divide en: funciones puras de cálculo, actualización del schema Zod, refactorización del formulario con selector de spots, integración del total de spots en la tarjeta del pedido, estandarización de etiquetas, y cambio de validación en el backend.

## Tasks

- [x] 1. Crear funciones de cálculo puras y tests de propiedad
  - [x] 1.1 Crear el módulo de utilidades `orderline-calculations.ts`
    - Crear archivo `admin-frontend/src/features/orders/utils/orderline-calculations.ts`
    - Implementar `deriveDateRange(activeDates: string[])` que retorna `{ starts_at, ends_at }` o null
    - Implementar `calculateTotalSpots(mode, inputValue, activeDatesCount)` con lógica condicional según modo
    - Implementar `sumOrderLineSpots(orderLines)` que suma target_spots tratando null como 0
    - _Requirements: 1.2, 2.4, 3.1_

  - [x] 1.2 Write property test: derivación de rango de fechas
    - **Property 1: Derivación de rango de fechas**
    - Crear archivo `admin-frontend/src/features/orders/__tests__/orderline-calculations.property.test.ts`
    - Generar arrays no vacíos de fechas YYYY-MM-DD con fast-check y verificar que starts_at = min, ends_at = max
    - **Validates: Requirements 1.2**

  - [x] 1.3 Write property test: cálculo de total de spots según modo
    - **Property 2: Cálculo de total de spots según modo**
    - Para modo "spots_por_dia": resultado = inputValue × activeDatesCount
    - Para modo "spots_por_linea": resultado = inputValue
    - **Validates: Requirements 2.4, 2.7**

  - [x] 1.4 Write property test: suma de spots con nulos
    - **Property 3: Suma de spots con nulos**
    - Generar arrays de `{ target_spots: number | null }` y verificar suma correcta con nulos como 0
    - Array vacío retorna 0
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [x] 1.5 Write property test: validación de spots rechaza valores inválidos
    - **Property 4: Validación de spots rechaza valores inválidos**
    - Verificar que valores < 1, no enteros, o vacíos son rechazados por el schema
    - Verificar que enteros ≥ 1 son aceptados
    - **Validates: Requirements 2.2**

- [x] 2. Actualizar schema Zod del formulario
  - [x] 2.1 Modificar `admin-frontend/src/features/orders/schemas.ts`
    - Eliminar campos `starts_at` y `ends_at` del schema de formulario de OrderLine
    - Agregar campo `spots_mode` con enum `['spots_por_dia', 'spots_por_linea']` y default `'spots_por_linea'`
    - Reemplazar `target_spots` por `spots_input` con validación `z.coerce.number().int().min(1)`
    - Mantener `active_dates` con `.min(1, 'Seleccione al menos una fecha activa')`
    - _Requirements: 1.1, 1.5, 2.1, 2.2_

- [x] 3. Checkpoint - Verificar funciones puras y schema
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Refactorizar OrderLineForm con selector de spots
  - [x] 4.1 Modificar `admin-frontend/src/features/orders/components/OrderLineForm.tsx`
    - Eliminar inputs de `starts_at` y `ends_at`
    - Agregar prop `parentOrder: { starts_at: string; ends_at: string }` como obligatoria
    - Agregar `<Select>` para `spots_mode` con opciones "Spots por día" / "Spots por línea"
    - Agregar input numérico para `spots_input`
    - Derivar en render: `const totalSpots = calculateTotalSpots(spotsMode, spotsInput, activeDates.length)`
    - Mostrar texto informativo con total calculado cuando modo es "spots_por_dia"
    - En `onSubmit`: construir payload con `starts_at`/`ends_at` de `deriveDateRange` y `target_spots` de `calculateTotalSpots`
    - Usar etiqueta "Spots objetivo" sin indicación "(opcional)"
    - Usar etiqueta "Peso de reparto" en lugar de "Peso (share_weight)"
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 4.3, 4.4, 4.5_

  - [x] 4.2 Definir y exportar `OrderLineSubmitPayload` interface
    - Agregar en el archivo de tipos o en el propio componente la interfaz del payload que se envía al backend
    - Incluir: name, priority_tier, starts_at, ends_at, active_dates, target_spots, delivery_pace, share_weight, status
    - _Requirements: 1.3, 2.7_

- [x] 5. Refactorizar CreateOrderLineDialog para usar OrderLineForm
  - [x] 5.1 Modificar `CreateOrderLineDialog` en `admin-frontend/src/features/orders/pages/OrderDetailPage.tsx`
    - Reemplazar la lógica de formulario duplicada por el componente `OrderLineForm`
    - Pasar `parentOrder` con las fechas del pedido padre
    - Mantener `DialogHeader` con título "Crear línea de pedido"
    - Usar etiqueta "Lo antes posible" para la opción "asap" de delivery_pace
    - Asegurar etiquetas idénticas a las del OrderLineForm de edición
    - _Requirements: 4.1, 4.2, 4.5_

- [x] 6. Mostrar total de spots y estandarizar etiquetas en OrderDetailPage
  - [x] 6.1 Agregar total de spots a la tarjeta de información del pedido
    - En `admin-frontend/src/features/orders/pages/OrderDetailPage.tsx`
    - Usar `sumOrderLineSpots(orderLines)` derivado en render
    - Agregar fila con etiqueta "Total spots" y valor formateado con `toLocaleString()`
    - Mostrar "0" cuando no hay líneas de pedido
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 6.2 Cambiar etiqueta de columna "Pace" a "Ritmo de entrega"
    - En la tabla de líneas de pedido de `OrderDetailPage.tsx`
    - _Requirements: 4.1_

- [x] 7. Backend: hacer target_spots obligatorio
  - [x] 7.1 Modificar validación en `backend/app/Http/Controllers/Admin/OrderLineController.php`
    - Cambiar regla de `target_spots` de `['nullable', 'integer', 'min:1']` a `['required', 'integer', 'min:1']`
    - Aplicar cambio tanto en método `store` como en `update`
    - _Requirements: 2.2, 2.7_

- [x] 8. Checkpoint final - Verificar integración completa
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marcadas con `*` son opcionales y pueden omitirse para un MVP rápido
- Cada task referencia requisitos específicos para trazabilidad
- Los checkpoints aseguran validación incremental
- Los property tests validan propiedades universales de corrección
- El diseño no usa useEffect para estado derivado — todo se calcula en render o en submit

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "4.1", "4.2"] },
    { "id": 2, "tasks": ["5.1", "6.1", "6.2", "7.1"] }
  ]
}
```
