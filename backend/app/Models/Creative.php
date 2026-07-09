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
