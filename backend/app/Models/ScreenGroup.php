<?php

namespace App\Models;

use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ScreenGroup extends Model
{
    use BelongsToTenant, HasFactory, HasUuids;

    /**
     * Indicates that the model's ID is not auto-incrementing.
     */
    public $incrementing = false;

    /**
     * The data type of the primary key.
     */
    protected $keyType = 'string';

    /**
     * Indicates the model should not manage updated_at timestamp.
     */
    const UPDATED_AT = null;

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'tenant_id',
        'name',
        'duration_seconds',
        'schedule',
        'num_slots',
        'ssp_slots',
        'playlist_slots',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'schedule' => 'array',
        ];
    }

    /**
     * Get the screens in this group.
     */
    public function screens()
    {
        return $this->hasMany(Screen::class, 'group_id');
    }

    /**
     * Get the order line targets for this screen group.
     */
    public function orderLineTargets()
    {
        return $this->hasMany(OrderLineTarget::class);
    }
}
