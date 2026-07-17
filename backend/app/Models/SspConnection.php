<?php

namespace App\Models;

use App\Models\Traits\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class SspConnection extends Model
{
    use HasUuids, BelongsToTenant;

    protected $fillable = [
        'tenant_id',
        'ssp_definition_id',
        'credentials',
        'active',
    ];

    protected $casts = [
        'credentials' => 'encrypted:array',
        'active' => 'boolean',
    ];

    /**
     * Hide credentials from serialization by default.
     */
    protected $hidden = ['credentials'];

    public function definition()
    {
        return $this->belongsTo(SspDefinition::class, 'ssp_definition_id');
    }

    public function tenant()
    {
        return $this->belongsTo(Tenant::class);
    }
}
