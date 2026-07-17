<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class SspDefinition extends Model
{
    use HasUuids;

    protected $fillable = [
        'name',
        'slug',
        'logo_url',
        'base_url',
        'description',
        'credential_fields',
        'active',
    ];

    protected $casts = [
        'credential_fields' => 'array',
        'active' => 'boolean',
    ];

    public function connections()
    {
        return $this->hasMany(SspConnection::class);
    }
}
