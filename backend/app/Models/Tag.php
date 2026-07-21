<?php

namespace App\Models;

use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Tag extends Model
{
    use BelongsToTenant, HasFactory, HasUuids;

    public $incrementing = false;
    protected $keyType = 'string';

    const UPDATED_AT = null;

    protected $fillable = [
        'tenant_id',
        'name',
    ];

    /**
     * Get the contents associated with this tag.
     */
    public function contents(): BelongsToMany
    {
        return $this->belongsToMany(Content::class, 'content_tags');
    }
}
