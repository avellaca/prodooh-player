<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\MorphTo;

class TrackingPixel extends Model
{
    use HasFactory, HasUuids;

    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'trackable_type',
        'trackable_id',
        'url',
        'trigger_type',
        'multiplier',
    ];

    protected function casts(): array
    {
        return [
            'multiplier' => 'integer',
        ];
    }

    public function trackable(): MorphTo
    {
        return $this->morphTo();
    }
}
