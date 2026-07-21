<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\MorphMany;

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
        'active_dates',
        'target_spots',
        'delivery_pace',
        'slots_purchased',
        'by_slot',
        'time_window',
        'status',
        'playback_mode',
    ];

    protected function casts(): array
    {
        return [
            'starts_at' => 'date',
            'ends_at' => 'date',
            'time_window' => 'array',
            'active_dates' => 'array',
            'slots_purchased' => 'integer',
            'by_slot' => 'boolean',
        ];
    }

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function creatives()
    {
        return $this->hasManyThrough(
            Creative::class,
            OrderLineTarget::class,
            'order_line_id',        // FK on order_line_targets
            'order_line_target_id', // FK on creatives
            'id',                   // local key on order_lines
            'id'                    // local key on order_line_targets
        );
    }

    public function targets()
    {
        return $this->hasMany(OrderLineTarget::class);
    }

    public function impressions()
    {
        return $this->hasMany(Impression::class);
    }

    public function trackingPixels(): MorphMany
    {
        return $this->morphMany(TrackingPixel::class, 'trackable');
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
