<?php

namespace App\Models;

use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Screen extends Model
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
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'tenant_id',
        'group_id',
        'venue_id',
        'device_token_hash',
        'name',
        'status',
        'orientation',
        'resolution_width',
        'resolution_height',
        'schedule',
        'transition_type',
        'transition_duration_ms',
        'manifest_version',
        'last_heartbeat',
        'last_storage_status',
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var list<string>
     */
    protected $hidden = [
        'device_token_hash',
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
            'last_heartbeat' => 'datetime',
            'last_storage_status' => 'array',
        ];
    }

    /**
     * Get the screen group this screen belongs to.
     */
    public function screenGroup()
    {
        return $this->belongsTo(ScreenGroup::class, 'group_id');
    }

    /**
     * Get the screenshots for this screen.
     */
    public function screenshots()
    {
        return $this->hasMany(Screenshot::class);
    }

    /**
     * Get the order line targets for this screen.
     */
    public function orderLineTargets()
    {
        return $this->hasMany(OrderLineTarget::class);
    }

    /**
     * Get the impressions for this screen.
     */
    public function impressions()
    {
        return $this->hasMany(Impression::class);
    }

    /**
     * Get the device commands for this screen.
     */
    public function deviceCommands()
    {
        return $this->hasMany(DeviceCommand::class);
    }

    /**
     * Get the playlists assigned to this screen.
     */
    public function playlists()
    {
        return $this->belongsToMany(Playlist::class, 'screen_playlists')
            ->withPivot('assigned_at');
    }

    /**
     * Get the current manifest for this screen.
     */
    public function screenManifest()
    {
        return $this->hasOne(ScreenManifest::class, 'screen_id');
    }
}
