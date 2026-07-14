# Design Document

## Introduction

This document describes the technical design for migrating the `active_dates` scheduling field from the Creative model to the OrderLine model. The change centralizes schedule management at the order line level, simplifying the creative assignment workflow and aligning the ManifestGenerator's filtering logic with the new data ownership.

## Architecture Overview

The migration touches three layers:

1. **Database layer** — Add `active_dates` jsonb column to `order_lines`, migrate existing data, then drop the column from `creatives`.
2. **Backend logic** — Move filtering from `Creative.active_dates` to `OrderLine.active_dates` in the ManifestGenerator, update validation in the OrderLineObserver/DateContainmentValidator, and strip `active_dates` from creative controllers.
3. **Frontend** — Integrate `ActiveDatesPicker` into `OrderLineForm`, remove date logic from creative assignment flows.

```
┌───────────────────────────────────────────────────────────┐
│  OrderLineForm (React)                                     │
│  ┌──────────────────┐  ┌──────────────────────────────┐   │
│  │ Date fields       │  │ ActiveDatesPicker             │   │
│  │ starts_at/ends_at │──▶ minDate / maxDate props       │   │
│  └──────────────────┘  └──────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
         │ POST/PUT /api/admin/order-lines
         ▼
┌───────────────────────────────────────────────────────────┐
│  OrderLineController (Laravel)                             │
│  validates: active_dates.* => date_format:Y-m-d           │
└───────────────────────────────────────────────────────────┘
         │ OrderLine::create / update
         ▼
┌───────────────────────────────────────────────────────────┐
│  OrderLineObserver                                         │
│  creating/updating → validateOrderLineActiveDates()        │
│  updated (active_dates dirty) → RecalculateManifestJob     │
└───────────────────────────────────────────────────────────┘
         │
         ▼
┌───────────────────────────────────────────────────────────┐
│  ManifestGenerator::buildOrderLineItems()                   │
│  Filter: OrderLine.active_dates contains $today            │
│  (or null/empty → fall back to starts_at/ends_at range)    │
└───────────────────────────────────────────────────────────┘
```

## Components

### 1. Database Migration

A single migration file handles the full lifecycle:

```php
// database/migrations/xxxx_xx_xx_move_active_dates_to_order_lines.php

public function up(): void
{
    // Step 1: Add column to order_lines
    Schema::table('order_lines', function (Blueprint $table) {
        $table->jsonb('active_dates')->nullable()->default(null)->after('ends_at');
    });

    // Step 2: Migrate data — union of all creative active_dates per order line
    DB::statement("
        UPDATE order_lines
        SET active_dates = sub.merged_dates
        FROM (
            SELECT olt.order_line_id,
                   jsonb_agg(DISTINCT elem ORDER BY elem) AS merged_dates
            FROM order_line_targets olt
            JOIN creatives c ON c.order_line_target_id = olt.id
            CROSS JOIN LATERAL jsonb_array_elements_text(c.active_dates) AS elem
            WHERE c.active_dates IS NOT NULL
              AND jsonb_array_length(c.active_dates) > 0
            GROUP BY olt.order_line_id
        ) sub
        WHERE order_lines.id = sub.order_line_id
    ");

    // Step 3: Remove column from creatives
    Schema::table('creatives', function (Blueprint $table) {
        $table->dropColumn('active_dates');
    });
}

public function down(): void
{
    // Restore column on creatives
    Schema::table('creatives', function (Blueprint $table) {
        $table->jsonb('active_dates')->nullable()->after('weight');
    });

    // Remove column from order_lines
    Schema::table('order_lines', function (Blueprint $table) {
        $table->dropColumn('active_dates');
    });
}
```

### 2. OrderLine Model Changes

```php
// app/Models/OrderLine.php — additions

protected $fillable = [
    // ... existing fields ...
    'active_dates',  // NEW
];

protected function casts(): array
{
    return [
        'starts_at' => 'date',
        'ends_at' => 'date',
        'time_window' => 'array',
        'active_dates' => 'array',  // NEW
    ];
}
```

### 3. Creative Model Changes

Remove `active_dates` from `$fillable` and `casts()`.

```php
// app/Models/Creative.php — removals

protected $fillable = [
    'order_line_target_id',
    'order_line_id',
    'content_id',
    'weight',
    // 'active_dates' REMOVED
];

protected function casts(): array
{
    return [
        // 'active_dates' => 'array' REMOVED
    ];
}
```

### 4. DateContainmentValidator Changes

```php
// app/Services/DateContainmentValidator.php

/**
 * NEW: Validate that an OrderLine's active_dates are within its parent Order's range.
 */
public function validateOrderLineActiveDates(OrderLine $orderLine): void
{
    if (empty($orderLine->active_dates)) {
        return; // null or empty is valid (means "all days in range")
    }

    $order = $orderLine->order ?? Order::findOrFail($orderLine->order_id);
    $startsAt = $order->starts_at->toDateString();
    $endsAt = $order->ends_at->toDateString();

    $invalidDates = collect($orderLine->active_dates)->filter(
        fn(string $date) => $date < $startsAt || $date > $endsAt
    );

    if ($invalidDates->isNotEmpty()) {
        throw ValidationException::withMessages([
            'active_dates' => "Las fechas activas deben estar dentro del rango del pedido ({$startsAt} a {$endsAt}). Inválidas: " . $invalidDates->implode(', '),
        ]);
    }
}

// REMOVE: validateCreativeActiveDates() method
```

### 5. OrderLineObserver Changes

```php
// app/Observers/OrderLineObserver.php — additions

private const RECALCULATE_FIELDS = ['status', 'starts_at', 'ends_at', 'target_spots', 'active_dates']; // ADD active_dates

public function creating(OrderLine $orderLine): void
{
    $this->validator->validateOrderLineDates($orderLine);
    $this->validator->validateOrderLineActiveDates($orderLine); // NEW
}

public function updating(OrderLine $orderLine): void
{
    if ($orderLine->isDirty(['starts_at', 'ends_at'])) {
        $this->validator->validateOrderLineDates($orderLine);
    }
    if ($orderLine->isDirty('active_dates')) {
        $this->validator->validateOrderLineActiveDates($orderLine); // NEW
    }
}
```

### 6. CreativeObserver Changes

Remove `validateCreativeActiveDates` calls and `'active_dates'` from `RECALCULATE_FIELDS`:

```php
// app/Observers/CreativeObserver.php

private const RECALCULATE_FIELDS = ['content_id', 'weight']; // REMOVE 'active_dates'

public function creating(Creative $creative): void
{
    // REMOVE: $this->validator->validateCreativeActiveDates($creative);
}

public function updating(Creative $creative): void
{
    // REMOVE: active_dates validation
}
```

### 7. ManifestGenerator Changes

The key change in `buildOrderLineItems()`:

```php
// app/Services/ManifestGenerator.php — buildOrderLineItems()

// BEFORE:
// $creativesByOrderLine = Creative::with(['content', 'orderLineTarget'])
//     ->whereIn('order_line_target_id', $screenTargetIds)
//     ->whereJsonContains('active_dates', $today)
//     ->get()
//     ->groupBy(fn($c) => $c->orderLineTarget->order_line_id);

// AFTER:
$today = now()->toDateString();

// Load order lines that are active today via their active_dates (or null = always active in range)
$activeOrderLineIds = OrderLine::whereHas('targets', fn($q) => $q->whereIn('id', $screenTargetIds))
    ->where('status', 'active')
    ->where('starts_at', '<=', $today)
    ->where('ends_at', '>=', $today)
    ->where(function ($query) use ($today) {
        $query->whereNull('active_dates')
              ->orWhereJsonLength('active_dates', 0)
              ->orWhereJsonContains('active_dates', $today);
    })
    ->pluck('id')
    ->toArray();

// Load creatives from active order lines' targets
$creativesByOrderLine = Creative::with(['content', 'orderLineTarget'])
    ->whereIn('order_line_target_id', $screenTargetIds)
    ->whereHas('orderLineTarget', fn($q) => $q->whereIn('order_line_id', $activeOrderLineIds))
    ->get()
    ->groupBy(fn($creative) => $creative->orderLineTarget->order_line_id);
```

### 8. OrderLineController Changes

Add `active_dates` validation to store and update:

```php
// store validation rules — add:
'active_dates' => ['nullable', 'array'],
'active_dates.*' => ['required', 'string', 'date_format:Y-m-d'],

// update validation rules — add:
'active_dates' => ['sometimes', 'nullable', 'array'],
'active_dates.*' => ['required', 'string', 'date_format:Y-m-d'],
```

### 9. CreativeController & BulkCreativeController Changes

Remove `active_dates` from validation rules in both controllers' `store`/`update`/`bulkByResolution` methods.

### 10. Frontend: OrderLineForm Integration

```tsx
// OrderLineForm.tsx — add ActiveDatesPicker

import { ActiveDatesPicker } from "./ActiveDatesPicker";

// Inside the form, after ends_at field:
const startsAt = watch("starts_at");
const endsAt = watch("ends_at");

<div className="space-y-2">
  <Label>Fechas activas</Label>
  <Controller
    name="active_dates"
    control={control}
    render={({ field }) => (
      <ActiveDatesPicker
        value={field.value ?? []}
        onChange={field.onChange}
        minDate={startsAt || undefined}
        maxDate={endsAt || undefined}
        disabled={isSubmitting}
      />
    )}
  />
  <p className="text-xs text-muted-foreground">
    Dejar vacío para activar todos los días del rango.
  </p>
  {errors.active_dates?.message && (
    <p className="text-sm text-red-500">{errors.active_dates.message as string}</p>
  )}
</div>
```

### 11. Frontend: Schema Changes

```typescript
// schemas.ts

export const orderLineSchema = z.object({
  // ... existing fields ...
  active_dates: z.array(
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido (YYYY-MM-DD)')
  ).nullable().optional().default(null),
});

// Remove active_dates from:
export const creativeSchema = z.object({
  content_id: z.string().min(1, 'Seleccione un contenido'),
  weight: z.coerce.number().int().min(1, 'El peso debe ser al menos 1'),
  // active_dates REMOVED
});

export const creativeForTargetSchema = z.object({
  content_id: z.string().min(1, 'El contenido es requerido'),
  weight: z.number().int().min(1, 'El peso debe ser un entero mayor o igual a 1'),
  // active_dates REMOVED
});

export const bulkByResolutionSchema = z.object({
  content_id: z.string().min(1, 'El contenido es requerido'),
  resolution_width: z.number().int().min(1),
  resolution_height: z.number().int().min(1),
  weight: z.number().int().min(1),
  // active_dates REMOVED
});
```

### 12. Frontend: Remove Date Generation from Creative Flows

In `ResolutionGroupCard.tsx`, `ScreenCreativeList.tsx`, and `DirectUploadDialog.tsx`:
- Remove the `generateDateRange()` helper function
- Remove `active_dates` from mutation payloads
- Remove `ActiveDatesPicker` from `CreativeRow` edit mode in `ScreenCreativeList`
- Remove `orderLineDates` prop where it was only used for date generation

## Data Models

### OrderLine (after migration)

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| id | uuid | no | Primary key |
| order_id | uuid | no | FK to orders |
| name | string | no | Display name |
| priority_tier | enum | no | patrocinio/estandar/red_interna |
| starts_at | date | no | Start of line range |
| ends_at | date | no | End of line range |
| **active_dates** | **jsonb** | **yes** | **Array of YYYY-MM-DD strings; null = every day in range** |
| target_spots | integer | yes | Spot delivery goal |
| delivery_pace | enum | no | asap/uniform |
| share_weight | integer | no | Rotation weight |
| time_window | jsonb | yes | Time-of-day constraints |
| status | enum | no | draft/active/paused/finished |

### Creative (after migration)

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| id | uuid | no | Primary key |
| order_line_target_id | uuid | no | FK to order_line_targets |
| order_line_id | uuid | yes | Deprecated, for rollback |
| content_id | uuid | no | FK to content |
| weight | integer | no | Rotation weight |
| ~~active_dates~~ | ~~jsonb~~ | — | **REMOVED** |

## Interfaces

### OrderLineController API

**POST** `/api/admin/orders/{orderId}/order-lines`

Request body (additions):
```json
{
  "active_dates": ["2025-01-15", "2025-01-16", "2025-01-17"] // or null
}
```

**PUT** `/api/admin/order-lines/{id}`

Request body (additions):
```json
{
  "active_dates": ["2025-02-01", "2025-02-02"]
}
```

### CreativeController API (removals)

**POST** `/api/admin/order-line-targets/{targetId}/creatives`

Remove from request body:
```json
{
  "active_dates": "REMOVED"
}
```

**PUT** `/api/admin/creatives/{id}`

Remove from request body:
```json
{
  "active_dates": "REMOVED"
}
```

### BulkCreativeController API (removals)

**POST** `/api/admin/order-lines/{orderLineId}/creatives/bulk-by-resolution`

Remove from request body:
```json
{
  "active_dates": "REMOVED"
}
```

## Error Handling

| Scenario | HTTP Status | Error Message |
|----------|-------------|---------------|
| active_dates contains non-YYYY-MM-DD string | 422 | "El formato de fecha debe ser YYYY-MM-DD." |
| active_dates contains date outside Order range | 422 | "Las fechas activas deben estar dentro del rango del pedido ({starts_at} a {ends_at}). Inválidas: {dates}" |
| OrderLine starts_at/ends_at outside Order range | 422 | Existing behavior (unchanged) |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Date containment validation

*For any* OrderLine with a non-empty `active_dates` array and its parent Order with range [starts_at, ends_at], `validateOrderLineActiveDates` SHALL pass if and only if every date in `active_dates` satisfies `Order.starts_at <= date <= Order.ends_at`.

**Validates: Requirements 1.3, 1.4, 5.3**

### Property 2: ManifestGenerator inclusion logic

*For any* screen, *for any* day `d`, and *for any* OrderLine targeting that screen: the ManifestGenerator includes the OrderLine's creatives if and only if (a) `active_dates` is null/empty and `starts_at <= d <= ends_at`, or (b) `active_dates` is non-empty and `d` is present in `active_dates`.

**Validates: Requirements 1.5, 2.1, 2.2, 2.3**

### Property 3: Manifest recalculation dispatch on active_dates change

*For any* OrderLine update where `active_dates` is dirty, the system SHALL dispatch exactly one `RecalculateManifestJob` per screen targeted by that OrderLine (via direct screen targets and screen group targets).

**Validates: Requirements 2.4**

### Property 4: ActiveDatesPicker bounds reactivity

*For any* `starts_at` and `ends_at` values entered in the OrderLineForm, the `ActiveDatesPicker` component's `minDate` prop SHALL equal `starts_at` and its `maxDate` prop SHALL equal `ends_at` at all times, including after reactive changes.

**Validates: Requirements 3.2, 3.3**

### Property 5: OrderLine active_dates format validation

*For any* array of strings submitted as `active_dates`, the OrderLineController SHALL accept the request if and only if every string matches the format `YYYY-MM-DD` (or the array is null/empty).

**Validates: Requirements 1.2, 3.4**

### Property 6: Data migration union correctness

*For any* OrderLine, after running the migration, its `active_dates` field SHALL equal the sorted array of distinct dates from the union of all `active_dates` arrays of creatives belonging to that OrderLine's targets. If no creatives have active_dates, the OrderLine's `active_dates` SHALL be null.

**Validates: Requirements 7.2, 7.3**
