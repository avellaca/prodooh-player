<?php

namespace App\Models;

use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Content extends Model
{
    use BelongsToTenant, HasFactory, HasUuids;

    /**
     * The table associated with the model.
     */
    protected $table = 'content';

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
        'filename',
        'mime_type',
        'storage_path',
        'file_size_bytes',
        'width',
        'height',
        'duration_seconds',
        'orientation',
        'rotation',
        'checksum_sha256',
    ];

    /**
     * Get the playlist items that reference this content.
     */
    public function playlistItems()
    {
        return $this->hasMany(PlaylistItem::class);
    }

    /**
     * Get the creatives that reference this content.
     */
    public function creatives()
    {
        return $this->hasMany(Creative::class);
    }

    /**
     * Get the tags associated with this content.
     */
    public function tags(): BelongsToMany
    {
        return $this->belongsToMany(Tag::class, 'content_tags');
    }
}
