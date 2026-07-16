<?php

namespace App\Models;

use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Order extends Model
{
    use BelongsToTenant, HasFactory, HasUuids;

    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'tenant_id',
        'name',
        'advertiser_id',
        'advertiser_name',
        'status',
    ];

    /**
     * Append computed attributes to JSON serialization.
     */
    protected $appends = [
        'starts_at',
        'ends_at',
    ];

    /**
     * Set default status to 'draft' on creation.
     */
    protected static function booted(): void
    {
        static::creating(function (Order $order) {
            if (empty($order->status)) {
                $order->status = 'draft';
            }
        });
    }

    /**
     * Computed accessor: starts_at = MIN(starts_at) from all associated order_lines.
     */
    protected function startsAt(): Attribute
    {
        return Attribute::make(
            get: function () {
                return $this->orderLines()->min('starts_at')
                    ? \Carbon\Carbon::parse($this->orderLines()->min('starts_at'))
                    : null;
            },
        );
    }

    /**
     * Computed accessor: ends_at = MAX(ends_at) from all associated order_lines.
     */
    protected function endsAt(): Attribute
    {
        return Attribute::make(
            get: function () {
                return $this->orderLines()->max('ends_at')
                    ? \Carbon\Carbon::parse($this->orderLines()->max('ends_at'))
                    : null;
            },
        );
    }

    public function orderLines()
    {
        return $this->hasMany(OrderLine::class);
    }

    public function advertiser()
    {
        return $this->belongsTo(Advertiser::class);
    }
}
