<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOneThrough;
use Illuminate\Database\Eloquent\Relations\MorphMany;

class Creative extends Model
{
    use HasFactory, HasUuids;

    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'order_line_target_id',
        'order_line_id', // deprecated, nullable, para rollback
        'content_id',
        'weight',
        'resolution_width',
        'resolution_height',
        'position',
    ];

    protected function casts(): array
    {
        return [];
    }

    public function orderLineTarget(): BelongsTo
    {
        return $this->belongsTo(OrderLineTarget::class);
    }

    /**
     * Relación derivada para backward compat.
     * Obtiene la OrderLine a través del OrderLineTarget intermedio.
     */
    public function orderLine(): HasOneThrough
    {
        return $this->hasOneThrough(
            OrderLine::class,
            OrderLineTarget::class,
            'id',                    // FK en order_line_targets (su PK)
            'id',                    // FK en order_lines (su PK)
            'order_line_target_id',  // Local key en creatives
            'order_line_id'          // Local key en order_line_targets
        );
    }

    public function content(): BelongsTo
    {
        return $this->belongsTo(Content::class);
    }

    public function impressions(): HasMany
    {
        return $this->hasMany(Impression::class);
    }

    public function trackingPixels(): MorphMany
    {
        return $this->morphMany(TrackingPixel::class, 'trackable');
    }
}
