<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class PlaylistItem extends Model
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
     * Indicates the model should not manage updated_at timestamp.
     */
    const UPDATED_AT = null;

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'playlist_id',
        'content_id',
        'type',
        'url',
        'duration_seconds',
        'position',
        'refresh_interval',
    ];

    /**
     * Get the playlist this item belongs to.
     */
    public function playlist()
    {
        return $this->belongsTo(Playlist::class);
    }

    /**
     * Get the content associated with this playlist item.
     */
    public function content()
    {
        return $this->belongsTo(Content::class);
    }
}
