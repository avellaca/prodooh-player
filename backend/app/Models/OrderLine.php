<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class OrderLine extends Model
{
    use HasFactory, HasUuids;

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
