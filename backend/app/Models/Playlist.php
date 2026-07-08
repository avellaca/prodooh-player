<?php

namespace App\Models;

use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Playlist extends Model
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
        'name',
        'version',
    ];

    /**
     * Get the playlist items for this playlist.
     */
    public function playlistItems()
    {
        return $this->hasMany(PlaylistItem::class);
    }

    /**
     * Get the screens assigned to this playlist.
     */
    public function screens()
    {
        return $this->belongsToMany(Screen::class, 'screen_playlists')
            ->withPivot('assigned_at');
    }
}
