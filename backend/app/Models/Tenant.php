<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Tenant extends Model
{
    use HasFactory, HasUuids;

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
        'name',
        'api_credential',
        'default_config',
        'default_duration_seconds',
        'default_timezone',
        'default_schedule',
        'transition_type',
        'transition_duration_ms',
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var list<string>
     */
    protected $hidden = [
        'api_credential',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'default_config' => 'array',
            'default_schedule' => 'array',
        ];
    }

    /**
     * Get the users for the tenant.
     */
    public function users()
    {
        return $this->hasMany(User::class);
    }

    /**
     * Get the screens for the tenant.
     */
    public function screens()
    {
        return $this->hasMany(Screen::class);
    }

    /**
     * Get the screen groups for the tenant.
     */
    public function screenGroups()
    {
        return $this->hasMany(ScreenGroup::class);
    }

    /**
     * Get the content for the tenant.
     */
    public function content()
    {
        return $this->hasMany(Content::class);
    }

    /**
     * Get the playlists for the tenant.
     */
    public function playlists()
    {
        return $this->hasMany(Playlist::class);
    }

    /**
     * Get the orders for the tenant.
     */
    public function orders()
    {
        return $this->hasMany(Order::class);
    }
}
