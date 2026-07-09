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
