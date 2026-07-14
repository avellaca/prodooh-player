# Design Document — Mejoras UX en OrderLine

## Overview

Este documento describe la arquitectura y los cambios técnicos necesarios para implementar las mejoras de UX en el formulario de OrderLine. Los cambios se centran en: (1) eliminar campos manuales de fecha y derivar `starts_at`/`ends_at` del array `active_dates`, (2) agregar un selector de modo de spots con cálculo automático, (3) mostrar el total de spots en la tarjeta de información del pedido, y (4) unificar etiquetas en español refactorizando `CreateOrderLineDialog` para usar `OrderLineForm`.

## Architecture

### Principio de diseño

Todos los valores derivados (`starts_at`, `ends_at`, `target_spots` total) se calculan en tiempo de render o en el event handler de submit — nunca con `useEffect`. Esto sigue la regla del proyecto: estado derivado = variable calculada en render.

## Components and Interfaces

### 1. Funciones de cálculo puras (utils)

Se crean funciones puras exportables para facilitar testeo:

```typescript
// features/orders/utils/orderline-calculations.ts

/**
 * Deriva starts_at y ends_at del array de fechas activas.
 * Retorna { starts_at, ends_at } o null si el array está vacío.
 */
export function deriveDateRange(activeDates: string[]): { starts_at: string; ends_at: string } | null {
  if (activeDates.length === 0) return null;
  const sorted = [...activeDates].sort();
  return {
    starts_at: sorted[0],
    ends_at: sorted[sorted.length - 1],
  };
}

/**
 * Calcula el total de spots según el modo seleccionado.
 */
export function calculateTotalSpots(
  mode: 'spots_por_dia' | 'spots_por_linea',
  inputValue: number,
  activeDatesCount: number
): number {
  if (mode === 'spots_por_dia') {
    return inputValue * activeDatesCount;
  }
  return inputValue;
}

/**
 * Suma target_spots de un array de order lines, tratando null como 0.
 */
export function sumOrderLineSpots(orderLines: Array<{ target_spots: number | null }>): number {
  return orderLines.reduce((sum, line) => sum + (line.target_spots ?? 0), 0);
}
```

### 2. Schema actualizado

```typescript
// features/orders/schemas.ts

export const orderLineSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido').max(255),
  priority_tier: z.enum(['patrocinio', 'estandar', 'red_interna'], {
    errorMap: () => ({ message: 'Seleccione un nivel de prioridad' }),
  }),
  active_dates: z.array(
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido')
  ).min(1, 'Seleccione al menos una fecha activa'),
  spots_mode: z.enum(['spots_por_dia', 'spots_por_linea']).default('spots_por_linea'),
  spots_input: z.coerce.number().int('Debe ser un número entero').min(1, 'Debe ser al menos 1'),
  delivery_pace: z.enum(['asap', 'uniform'], {
    errorMap: () => ({ message: 'Seleccione un ritmo de entrega' }),
  }),
  share_weight: z.coerce.number({ invalid_type_error: 'Debe ser un número' })
    .int('Debe ser un número entero').min(1, 'El peso debe ser al menos 1'),
  status: z.enum(['draft', 'active', 'paused', 'finished']).default('draft'),
});
```

Nota: `starts_at`, `ends_at` y `target_spots` se eliminan del schema de formulario. Se calculan en el handler de submit antes de enviar al backend.

### 3. OrderLineForm refactorizado

El componente `OrderLineForm` se modifica para:

- **Eliminar** los `<Input type="date">` de `starts_at` y `ends_at`.
- **Recibir** `parentOrder: { starts_at: string; ends_at: string }` como prop obligatoria (para limitar el ActiveDatesPicker).
- **Agregar** un `<Select>` para `spots_mode` con opciones "Spots por día" / "Spots por línea".
- **Mostrar** un campo de entrada numérica para `spots_input`.
- **Derivar en render** el total de spots cuando el modo es "spots_por_dia": `const totalSpots = calculateTotalSpots(spotsMode, spotsInput, activeDates.length)`.
- **Mostrar** un texto informativo con el total calculado cuando el modo es "spots_por_dia".
- **En `onSubmit`**: construir el payload con `starts_at`, `ends_at` (de `deriveDateRange`) y `target_spots` (de `calculateTotalSpots`), luego llamar al callback.

```typescript
interface OrderLineFormProps {
  defaultValues?: Partial<OrderLineFormValues>;
  onSubmit: (data: OrderLineSubmitPayload) => void;
  isSubmitting?: boolean;
  parentOrder: { starts_at: string; ends_at: string };
}

// Payload que se envía al backend (diferente al schema del form)
export interface OrderLineSubmitPayload {
  name: string;
  priority_tier: 'patrocinio' | 'estandar' | 'red_interna';
  starts_at: string;
  ends_at: string;
  active_dates: string[];
  target_spots: number;
  delivery_pace: 'asap' | 'uniform';
  share_weight: number;
  status: 'draft' | 'active' | 'paused' | 'finished';
}
```

### 4. Refactorización de CreateOrderLineDialog

El componente `CreateOrderLineDialog` en `OrderDetailPage.tsx` se simplifica para usar `OrderLineForm` directamente dentro del `<DialogContent>`, eliminando la duplicación de lógica de formulario:

```typescript
function CreateOrderLineDialog({ open, onOpenChange, onSubmit, isSubmitting, parentOrder }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>Crear línea de pedido</DialogTitle>
          <DialogDescription>Agrega una nueva línea al pedido</DialogDescription>
        </DialogHeader>
        <OrderLineForm
          onSubmit={(data) => {
            onSubmit(data);
          }}
          isSubmitting={isSubmitting}
          parentOrder={parentOrder}
        />
      </DialogContent>
    </Dialog>
  );
}
```

### 5. Total de spots en Order_Detail_Card

En `OrderDetailPage.tsx`, se agrega una fila al grid de información del pedido:

```typescript
// Derivado en render (no useEffect)
const totalSpots = orderLines ? sumOrderLineSpots(orderLines) : 0;

// En el JSX de la card:
<div>
  <p className="text-sm font-medium text-muted-foreground">Total spots</p>
  <p className="text-sm">{totalSpots.toLocaleString()}</p>
</div>
```

### 6. Cambio de etiqueta en tabla

En `OrderDetailPage.tsx`, la columna de la tabla cambia:

```diff
- <TableHead>Pace</TableHead>
+ <TableHead>Ritmo de entrega</TableHead>
```

### 7. Backend: target_spots obligatorio

En `OrderLineController.php`, se cambia la regla de validación:

```diff
- 'target_spots' => ['nullable', 'integer', 'min:1'],
+ 'target_spots' => ['required', 'integer', 'min:1'],
```

Este cambio aplica tanto en `store` como en `update`.

## Data Models

### Tipo del formulario (frontend-only)

```typescript
interface OrderLineFormValues {
  name: string;
  priority_tier: 'patrocinio' | 'estandar' | 'red_interna';
  active_dates: string[];          // requerido, mínimo 1
  spots_mode: 'spots_por_dia' | 'spots_por_linea';  // frontend-only
  spots_input: number;             // el valor ingresado por el usuario
  delivery_pace: 'asap' | 'uniform';
  share_weight: number;
  status: 'draft' | 'active' | 'paused' | 'finished';
}
```

### Payload de API (lo que se envía al backend)

```typescript
interface OrderLineApiPayload {
  name: string;
  priority_tier: 'patrocinio' | 'estandar' | 'red_interna';
  starts_at: string;               // derivado de min(active_dates)
  ends_at: string;                 // derivado de max(active_dates)
  active_dates: string[];
  target_spots: number;            // ahora obligatorio
  delivery_pace: 'asap' | 'uniform';
  share_weight: number;
  status: 'draft' | 'active' | 'paused' | 'finished';
}
```

### Modelo backend (sin cambios estructurales)

El modelo `OrderLine` en Laravel mantiene los mismos campos. Solo cambia la regla de validación de `target_spots` de `nullable` a `required`.

## Error Handling

| Escenario | Comportamiento |
|---|---|
| `active_dates` vacío al submit | Zod rechaza con mensaje "Seleccione al menos una fecha activa" |
| `spots_input` < 1 o no entero | Zod rechaza con mensaje "Debe ser al menos 1" |
| `spots_input` vacío | Zod rechaza con error de coerción |
| Backend rechaza `target_spots` | Axios error capturado por TanStack Query, toast de error |
| `spots_mode = spots_por_dia` y 0 fechas seleccionadas | Total muestra 0, pero validación de `active_dates` bloquea submit |

## Testing Strategy

### Estrategia de testing dual

- **Tests unitarios (ejemplo):** Verificar renderizado de campos, etiquetas correctas, flujo de submit con valores específicos.
- **Tests de propiedad (PBT):** Verificar las funciones puras de cálculo (`deriveDateRange`, `calculateTotalSpots`, `sumOrderLineSpots`) y la validación del schema con entradas generadas.

### Framework

- **Vitest** como test runner
- **fast-check** para property-based testing (ya instalado como dependencia de dev)
- **@testing-library/react** para tests de componente

### Configuración PBT

- Mínimo 100 iteraciones por propiedad
- Cada test de propiedad referencia su propiedad del documento de diseño

## Consideraciones de rendimiento

- Las funciones `deriveDateRange` y `calculateTotalSpots` son O(n) donde n es el número de fechas. Para un máximo realista de ~365 fechas, el costo es negligible.
- `sumOrderLineSpots` es O(m) donde m es el número de order lines. Típicamente < 50.
- No se requiere `useMemo` para estos cálculos dado el tamaño esperado de los datos.

## Correctness Properties

*Una propiedad es una característica o comportamiento que debe cumplirse en todas las ejecuciones válidas del sistema. Las propiedades sirven como puente entre especificaciones legibles por humanos y garantías de corrección verificables por máquinas.*

### Property 1: Derivación de rango de fechas

*Para cualquier* array no vacío de fechas en formato YYYY-MM-DD, `deriveDateRange` debe retornar un `starts_at` igual a la fecha mínima del array y un `ends_at` igual a la fecha máxima del array, independientemente del orden de los elementos.

**Validates: Requirements 1.2**

### Property 2: Cálculo de total de spots según modo

*Para cualquier* modo de spots, valor de entrada entero ≥ 1, y cantidad de fechas activas ≥ 1: si el modo es "spots_por_dia", el resultado de `calculateTotalSpots` debe ser igual a `inputValue × activeDatesCount`; si el modo es "spots_por_linea", el resultado debe ser igual a `inputValue` sin modificación.

**Validates: Requirements 2.4, 2.7**

### Property 3: Suma de spots con nulos

*Para cualquier* array de objetos con campo `target_spots` (que puede ser un entero positivo o null), `sumOrderLineSpots` debe retornar la suma de todos los valores no nulos, tratando cada null como 0. Para un array vacío, debe retornar 0.

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 4: Validación de spots rechaza valores inválidos

*Para cualquier* valor numérico que sea menor a 1, no entero, o vacío, el schema de validación de `spots_input` debe rechazarlo. *Para cualquier* entero ≥ 1, debe aceptarlo.

**Validates: Requirements 2.2**
