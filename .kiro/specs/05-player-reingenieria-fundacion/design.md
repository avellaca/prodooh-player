# Design — Player Reingeniería: Fundación (Modelo de Datos)

## Overview

Este documento describe la arquitectura de la capa de datos para el modelo de Pedido → Línea de pedido → Creativo, incluyendo migraciones, modelos Eloquent, validaciones, y la estrategia de eliminación de campos obsoletos del Loop de slots fijos.

El proyecto usa Laravel con migraciones secuenciales, UUID como PK en todas las tablas, el trait `BelongsToTenant` para aislamiento multi-tenant, y `HasUuids` de Laravel para generación automática de UUIDs.

## Database Schema

### Diagrama de Relaciones (ERD parcial — nuevas tablas)

```
tenants (existente)
  │
  ├──< orders
  │      │
  │      └──< order_lines
  │             │
  │             ├──< order_line_targets ──> screens (existente)
  │             │                      ──> screen_groups (existente)
  │             │
  │             ├──< creatives ──> content (existente)
  │             │
  │             └──< impressions ──> screens (existente)
  │
  └──< screens (existente, se retiran 3 columnas)
```

### Migración 1: `create_orders_table`

**Archivo:** `database/migrations/2026_07_09_000001_create_orders_table.php`

```php
Schema::create('orders', function (Blueprint $table) {
    $table->uuid('id')->primary();
    $table->uuid('tenant_id');
    $table->string('name');
    $table->string('advertiser_name')->nullable();
    $table->date('starts_at');
    $table->date('ends_at');
    $table->enum('status', ['draft', 'active', 'paused', 'finished'])->default('draft');
    $table->timestamps();

    $table->foreign('tenant_id')->references('id')->on('tenants')->onDelete('cascade');

    $table->index('tenant_id');
    $table->index('status');
    $table->index(['starts_at', 'ends_at']);
});

// Constraint: ends_at >= starts_at
DB::statement('ALTER TABLE orders ADD CONSTRAINT orders_dates_check CHECK (ends_at >= starts_at)');
```

### Migración 2: `create_order_lines_table`

**Archivo:** `database/migrations/2026_07_09_000002_create_order_lines_table.php`

```php
Schema::create('order_lines', function (Blueprint $table) {
    $table->uuid('id')->primary();
    $table->uuid('order_id');
    $table->string('name');
    $table->enum('priority_tier', ['patrocinio', 'estandar', 'red_interna']);
    $table->date('starts_at');
    $table->date('ends_at');
    $table->integer('target_spots')->nullable();
    $table->enum('delivery_pace', ['asap', 'uniform'])->default('uniform');
    $table->integer('share_weight')->default(100);
    $table->jsonb('time_window')->nullable();
    $table->enum('status', ['draft', 'active', 'paused', 'finished'])->default('draft');
    $table->timestamps();

    $table->foreign('order_id')->references('id')->on('orders')->onDelete('cascade');

    $table->index('order_id');
    $table->index('priority_tier');
    $table->index('status');
    $table->index(['starts_at', 'ends_at']);
});

DB::statement('ALTER TABLE order_lines ADD CONSTRAINT order_lines_dates_check CHECK (ends_at >= starts_at)');
```

### Migración 3: `create_order_line_targets_table`

**Archivo:** `database/migrations/2026_07_09_000003_create_order_line_targets_table.php`

```php
Schema::create('order_line_targets', function (Blueprint $table) {
    $table->uuid('id')->primary();
    $table->uuid('order_line_id');
    $table->uuid('screen_id')->nullable();
    $table->uuid('screen_group_id')->nullable();
    $table->timestamp('created_at')->useCurrent();

    $table->foreign('order_line_id')->references('id')->on('order_lines')->onDelete('cascade');
    $table->foreign('screen_id')->references('id')->on('screens')->onDelete('cascade');
    $table->foreign('screen_group_id')->references('id')->on('screen_groups')->onDelete('cascade');

    $table->index('order_line_id');
    $table->index('screen_id');
    $table->index('screen_group_id');
});

// XOR constraint: exactly one of screen_id/screen_group_id must be non-null
DB::statement('ALTER TABLE order_line_targets ADD CONSTRAINT order_line_targets_xor_check 
    CHECK ((screen_id IS NOT NULL AND screen_group_id IS NULL) OR (screen_id IS NULL AND screen_group_id IS NOT NULL))');
```

### Migración 4: `create_creatives_table`

**Archivo:** `database/migrations/2026_07_09_000004_create_creatives_table.php`

```php
Schema::create('creatives', function (Blueprint $table) {
    $table->uuid('id')->primary();
    $table->uuid('order_line_id');
    $table->uuid('content_id');
    $table->integer('weight')->default(100);
    $table->jsonb('active_dates');
    $table->timestamps();

    $table->foreign('order_line_id')->references('id')->on('order_lines')->onDelete('cascade');
    $table->foreign('content_id')->references('id')->on('content')->onDelete('restrict');

    $table->index('order_line_id');
    $table->index('content_id');
});
```

### Migración 5: `create_impressions_table`

**Archivo:** `database/migrations/2026_07_09_000005_create_impressions_table.php`

Esta migración elimina `playback_logs` y crea `impressions`.

```php
public function up(): void
{
    Schema::dropIfExists('playback_logs');

    Schema::create('impressions', function (Blueprint $table) {
        $table->uuid('id')->primary();
        $table->uuid('screen_id');
        $table->uuid('creative_id')->nullable();
        $table->uuid('order_line_id')->nullable();
        $table->enum('source', ['order_line', 'playlist', 'prodooh_ssp']);
        $table->timestamp('started_at');
        $table->timestamp('ended_at')->nullable();
        $table->decimal('duration_seconds', 10, 2)->nullable();
        $table->enum('result', ['success', 'failed']);
        $table->string('failure_reason')->nullable();
        $table->timestamp('synced_at')->nullable();
        $table->timestamp('created_at')->useCurrent();

        $table->foreign('screen_id')->references('id')->on('screens')->onDelete('cascade');
        $table->foreign('creative_id')->references('id')->on('creatives')->onDelete('set null');
        $table->foreign('order_line_id')->references('id')->on('order_lines')->onDelete('set null');

        $table->index('screen_id');
        $table->index('creative_id');
        $table->index('order_line_id');
        $table->index('source');
        $table->index('started_at');
        $table->index('synced_at');
    });
}

public function down(): void
{
    Schema::dropIfExists('impressions');

    // Recreate playback_logs with original structure
    Schema::create('playback_logs', function (Blueprint $table) {
        $table->uuid('id')->primary();
        $table->uuid('screen_id');
        $table->uuid('tenant_id');
        $table->string('content_id');
        $table->enum('source', ['prodooh', 'gam', 'url', 'playlist']);
        $table->timestamp('started_at');
        $table->timestamp('ended_at')->nullable();
        $table->decimal('duration_seconds', 10, 2)->nullable();
        $table->enum('result', ['success', 'failed']);
        $table->string('failure_reason')->nullable();
        $table->timestamp('synced_at')->nullable();
        $table->timestamps();

        $table->foreign('screen_id')->references('id')->on('screens')->onDelete('cascade');
        $table->foreign('tenant_id')->references('id')->on('tenants')->onDelete('cascade');

        $table->index('screen_id');
        $table->index('tenant_id');
        $table->index('started_at');
        $table->index('source');
    });
}
```

### Migración 6: `remove_loop_columns_from_screens`

**Archivo:** `database/migrations/2026_07_09_000006_remove_loop_columns_from_screens.php`

```php
public function up(): void
{
    Schema::table('screens', function (Blueprint $table) {
        $table->dropColumn(['loop_config', 'sources_config', 'duration_seconds']);
    });
}

public function down(): void
{
    Schema::table('screens', function (Blueprint $table) {
        $table->jsonb('loop_config')->nullable();
        $table->jsonb('sources_config')->nullable();
        $table->integer('duration_seconds')->nullable();
    });
}
```

**Nota sobre el rollback:** La migración down recrea las columnas como nullable (no con su default original de `jsonb NOT NULL`) porque no podemos inferir valores por defecto coherentes para datos que ya no existen. Cualquier código que dependa de estas columnas fallará visiblemente, lo cual es intencional.

---

## Models

### Modelo: `Order`

**Archivo:** `app/Models/Order.php`

```php
<?php

namespace App\Models;

use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class Order extends Model
{
    use BelongsToTenant, HasUuids;

    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'tenant_id',
        'name',
        'advertiser_name',
        'starts_at',
        'ends_at',
        'status',
    ];

    protected function casts(): array
    {
        return [
            'starts_at' => 'date',
            'ends_at' => 'date',
        ];
    }

    public function orderLines()
    {
        return $this->hasMany(OrderLine::class);
    }
}
```

### Modelo: `OrderLine`

**Archivo:** `app/Models/OrderLine.php`

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class OrderLine extends Model
{
    use HasUuids;

    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'order_id',
        'name',
        'priority_tier',
        'starts_at',
        'ends_at',
        'target_spots',
        'delivery_pace',
        'share_weight',
        'time_window',
        'status',
    ];

    protected function casts(): array
    {
        return [
            'starts_at' => 'date',
            'ends_at' => 'date',
            'time_window' => 'array',
        ];
    }

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function creatives()
    {
        return $this->hasMany(Creative::class);
    }

    public function targets()
    {
        return $this->hasMany(OrderLineTarget::class);
    }

    public function impressions()
    {
        return $this->hasMany(Impression::class);
    }

    /**
     * Resolve all screens targeted by this line (direct + via group).
     */
    public function resolveTargetScreens(): \Illuminate\Database\Eloquent\Collection
    {
        $directScreenIds = $this->targets()
            ->whereNotNull('screen_id')
            ->pluck('screen_id');

        $groupIds = $this->targets()
            ->whereNotNull('screen_group_id')
            ->pluck('screen_group_id');

        $groupScreenIds = Screen::whereIn('group_id', $groupIds)->pluck('id');

        return Screen::whereIn('id', $directScreenIds->merge($groupScreenIds)->unique())->get();
    }
}
```

### Modelo: `OrderLineTarget`

**Archivo:** `app/Models/OrderLineTarget.php`

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class OrderLineTarget extends Model
{
    use HasUuids;

    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;
    const CREATED_AT = 'created_at';

    protected $fillable = [
        'order_line_id',
        'screen_id',
        'screen_group_id',
    ];

    protected static function booted(): void
    {
        static::saving(function (OrderLineTarget $target) {
            $hasScreen = !is_null($target->screen_id);
            $hasGroup = !is_null($target->screen_group_id);

            if ($hasScreen === $hasGroup) {
                throw new \Illuminate\Validation\ValidationException(
                    validator([], []),
                    new \Illuminate\Http\JsonResponse([
                        'message' => 'Exactly one of screen_id or screen_group_id must be provided.',
                    ], 422)
                );
            }
        });
    }

    public function orderLine()
    {
        return $this->belongsTo(OrderLine::class);
    }

    public function screen()
    {
        return $this->belongsTo(Screen::class);
    }

    public function screenGroup()
    {
        return $this->belongsTo(ScreenGroup::class);
    }
}
```

### Modelo: `Creative`

**Archivo:** `app/Models/Creative.php`

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class Creative extends Model
{
    use HasUuids;

    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'order_line_id',
        'content_id',
        'weight',
        'active_dates',
    ];

    protected function casts(): array
    {
        return [
            'active_dates' => 'array',
        ];
    }

    public function orderLine()
    {
        return $this->belongsTo(OrderLine::class);
    }

    public function content()
    {
        return $this->belongsTo(Content::class);
    }

    public function impressions()
    {
        return $this->hasMany(Impression::class);
    }
}
```

### Modelo: `Impression`

**Archivo:** `app/Models/Impression.php`

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class Impression extends Model
{
    use HasUuids;

    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;
    const CREATED_AT = 'created_at';
    const UPDATED_AT = null;

    protected $fillable = [
        'screen_id',
        'creative_id',
        'order_line_id',
        'source',
        'started_at',
        'ended_at',
        'duration_seconds',
        'result',
        'failure_reason',
        'synced_at',
    ];

    protected function casts(): array
    {
        return [
            'started_at' => 'datetime',
            'ended_at' => 'datetime',
            'synced_at' => 'datetime',
            'duration_seconds' => 'decimal:2',
        ];
    }

    public function screen()
    {
        return $this->belongsTo(Screen::class);
    }

    public function creative()
    {
        return $this->belongsTo(Creative::class);
    }

    public function orderLine()
    {
        return $this->belongsTo(OrderLine::class);
    }
}
```

---

## Validation Logic

### DateContainmentValidator (Service / Trait)

**Archivo:** `app/Services/DateContainmentValidator.php`

Encapsula la lógica de validación de containment de fechas entre niveles jerárquicos. Se invoca desde model observers o form requests (en specs futuros con CRUD).

```php
<?php

namespace App\Services;

use App\Models\Order;
use App\Models\OrderLine;
use App\Models\Creative;
use Illuminate\Validation\ValidationException;

class DateContainmentValidator
{
    /**
     * Validate that an OrderLine's dates are within its parent Order's range.
     */
    public function validateOrderLineDates(OrderLine $orderLine): void
    {
        $order = $orderLine->order ?? Order::findOrFail($orderLine->order_id);

        if ($orderLine->starts_at->lt($order->starts_at) || $orderLine->ends_at->gt($order->ends_at)) {
            throw ValidationException::withMessages([
                'starts_at' => "Order line dates must be within the parent order range ({$order->starts_at->toDateString()} to {$order->ends_at->toDateString()}).",
            ]);
        }
    }

    /**
     * Validate that a Creative's active_dates are within its parent OrderLine's range.
     */
    public function validateCreativeActiveDates(Creative $creative): void
    {
        $orderLine = $creative->orderLine ?? OrderLine::findOrFail($creative->order_line_id);

        $invalidDates = collect($creative->active_dates)->filter(function ($dateStr) use ($orderLine) {
            $date = \Carbon\Carbon::parse($dateStr);
            return $date->lt($orderLine->starts_at) || $date->gt($orderLine->ends_at);
        });

        if ($invalidDates->isNotEmpty()) {
            throw ValidationException::withMessages([
                'active_dates' => "Creative active dates must be within the parent order line range ({$orderLine->starts_at->toDateString()} to {$orderLine->ends_at->toDateString()}). Invalid: " . $invalidDates->implode(', '),
            ]);
        }
    }

    /**
     * Validate that an Order's date range change doesn't orphan children.
     */
    public function validateOrderDateShrink(Order $order): void
    {
        $orphanedLines = $order->orderLines()
            ->where(function ($q) use ($order) {
                $q->where('starts_at', '<', $order->starts_at)
                  ->orWhere('ends_at', '>', $order->ends_at);
            })
            ->exists();

        if ($orphanedLines) {
            throw ValidationException::withMessages([
                'starts_at' => 'Cannot shrink order date range: some order lines have dates outside the new range.',
            ]);
        }
    }
}
```

### Model Observers

**Archivo:** `app/Observers/OrderLineObserver.php`

```php
<?php

namespace App\Observers;

use App\Models\OrderLine;
use App\Services\DateContainmentValidator;

class OrderLineObserver
{
    public function __construct(private DateContainmentValidator $validator) {}

    public function creating(OrderLine $orderLine): void
    {
        $this->validator->validateOrderLineDates($orderLine);
    }

    public function updating(OrderLine $orderLine): void
    {
        if ($orderLine->isDirty(['starts_at', 'ends_at'])) {
            $this->validator->validateOrderLineDates($orderLine);
        }
    }
}
```

**Archivo:** `app/Observers/CreativeObserver.php`

```php
<?php

namespace App\Observers;

use App\Models\Creative;
use App\Services\DateContainmentValidator;

class CreativeObserver
{
    public function __construct(private DateContainmentValidator $validator) {}

    public function creating(Creative $creative): void
    {
        $this->validator->validateCreativeActiveDates($creative);
    }

    public function updating(Creative $creative): void
    {
        if ($creative->isDirty('active_dates')) {
            $this->validator->validateCreativeActiveDates($creative);
        }
    }
}
```

**Archivo:** `app/Observers/OrderObserver.php`

```php
<?php

namespace App\Observers;

use App\Models\Order;
use App\Services\DateContainmentValidator;

class OrderObserver
{
    public function __construct(private DateContainmentValidator $validator) {}

    public function updating(Order $order): void
    {
        if ($order->isDirty(['starts_at', 'ends_at'])) {
            $this->validator->validateOrderDateShrink($order);
        }
    }
}
```

### Registro de Observers

**Archivo:** `app/Providers/AppServiceProvider.php` (método `boot`)

```php
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\Creative;
use App\Observers\OrderObserver;
use App\Observers\OrderLineObserver;
use App\Observers\CreativeObserver;

public function boot(): void
{
    Order::observe(OrderObserver::class);
    OrderLine::observe(OrderLineObserver::class);
    Creative::observe(CreativeObserver::class);
}
```

---

## Changes to Existing Models

### `Screen` — Retirar campos obsoletos

```php
// REMOVE from $fillable:
// 'duration_seconds', 'loop_config', 'sources_config'

// REMOVE from casts():
// 'loop_config' => 'array', 'sources_config' => 'array'

// ADD new relations:
public function orderLineTargets()
{
    return $this->hasMany(OrderLineTarget::class);
}

public function impressions()
{
    return $this->hasMany(Impression::class);
}

// REMOVE old relation (tabla ya no existe):
// public function playbackLogs() { ... }
```

### `ScreenGroup` — Agregar relación inversa

```php
// ADD:
public function orderLineTargets()
{
    return $this->hasMany(OrderLineTarget::class);
}
```

### `Tenant` — Agregar relación a orders, retirar playbackLogs

```php
// ADD:
public function orders()
{
    return $this->hasMany(Order::class);
}

// REMOVE (tabla ya no existe):
// public function playbackLogs() { ... }
```

### `Content` — Agregar relación a creatives

```php
// ADD:
public function creatives()
{
    return $this->hasMany(Creative::class);
}
```

---

## Migration Ordering & Dependencies

Las migraciones se ejecutan en orden estricto porque hay FKs entre ellas:

| # | Migración | Depende de |
|---|-----------|-----------|
| 1 | `create_orders_table` | `tenants` (existente) |
| 2 | `create_order_lines_table` | `orders` (#1) |
| 3 | `create_order_line_targets_table` | `order_lines` (#2), `screens` (existente), `screen_groups` (existente) |
| 4 | `create_creatives_table` | `order_lines` (#2), `content` (existente) |
| 5 | `create_impressions_table` | `screens` (existente), `creatives` (#4), `order_lines` (#2). También elimina `playback_logs`. |
| 6 | `remove_loop_columns_from_screens` | `screens` (existente). Sin FK, solo DDL. |

**Nota sobre la eliminación de `playback_logs`:** La migración 5 ejecuta `dropIfExists('playback_logs')` ANTES de crear `impressions`. Como `playback_logs` está vacía (D1 de la auditoría confirma que nunca se registró nada), no hay datos que migrar.

---

## Impacto en Código Existente (Breaking Changes)

### Backend — Controllers que usan campos eliminados

| Archivo | Campo afectado | Acción requerida |
|---------|---------------|-----------------|
| `LoopConfigController` | `loop_config` | **Eliminar controller completo** — la ruta `PUT /screens/{id}/loop` queda obsoleta. |
| `SourceToggleController` | `sources_config` | **Eliminar controller completo** — la ruta `PUT /screens/{id}/sources` queda obsoleta. |
| `ConfigSyncController` | `loop_config`, `sources_config`, `duration_seconds` | **Refactorizar** — el device config ya no sirve loop/sources. Se refactorizará en spec 06 (motor) para servir el manifiesto nuevo. |
| `PlaybackLogController` | tabla `playback_logs` | **Refactorizar** — ahora escribe a `impressions`. Se refactorizará en spec 06 como parte del nuevo protocolo de sincronización. |
| `PlaybackAnalyticsController` | tabla `playback_logs` | **Refactorizar** — ahora lee de `impressions`. |

### Backend — Modelo `PlaybackLog`

El archivo `app/Models/PlaybackLog.php` queda obsoleto y se elimina junto con la tabla.

### Admin-Frontend — Componentes que usan campos eliminados

| Componente | Dependencia | Acción |
|-----------|------------|--------|
| `LoopEditor` | `PUT /screens/{id}/loop` | Se elimina en un spec posterior (UI de Pedidos reemplaza esto). |
| `SourceToggles` | `PUT /screens/{id}/sources` | Se elimina en un spec posterior. |
| `ScreenDetailPage` | Renderiza loop editor + source toggles | Se refactorizará en spec posterior. |

**Importante:** Estos breaking changes en controllers y frontend NO se resuelven en este spec (fundación). Se resuelven en el spec 06 (motor) que introduce el nuevo ConfigSyncController y la UI de administración de pedidos. Durante la transición entre spec 05 y 06, los endpoints obsoletos devolverán 404/410.

---

## Testing Strategy

### Unit Tests — Modelos y relaciones

Verificar con `artisan tinker` o tests Feature:
- Crear Order → OrderLine → Creative con fechas válidas: OK
- Crear OrderLine con fechas fuera del rango del Order padre: falla con ValidationException
- Crear Creative con `active_dates` fuera del rango de su OrderLine: falla con ValidationException
- Crear OrderLineTarget con ambos campos nulos: falla
- Crear OrderLineTarget con ambos campos presentes: falla
- Cascade delete: eliminar Order elimina OrderLines → Creatives → OrderLineTargets
- Set null on delete: eliminar Creative no elimina Impressions (solo nullifica `creative_id`)
- Restrict on delete: no se puede eliminar Content referenciado por un Creative

### Migration Tests

- `php artisan migrate` completa sin errores
- `php artisan migrate:rollback` revierte todas las migraciones sin errores
- Constraints CHECK funcionan: insert con `ends_at < starts_at` falla a nivel DB
- XOR constraint funciona: insert con ambos campos nulos o ambos presentes falla a nivel DB
