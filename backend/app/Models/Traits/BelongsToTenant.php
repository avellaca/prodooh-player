<?php

namespace App\Models\Traits;

use Illuminate\Database\Eloquent\Builder;

trait BelongsToTenant
{
    /**
     * Boot the trait and register a global scope that filters
     * queries by the authenticated user's tenant_id.
     * Super-admin users bypass this scope.
     */
    protected static function bootBelongsToTenant(): void
    {
        static::addGlobalScope('tenant', function (Builder $builder) {
            $user = auth()->user();

            if ($user && !$user->isSuperAdmin()) {
                $builder->where($builder->getModel()->getTable() . '.tenant_id', $user->tenant_id);
            }
        });
    }

    /**
     * Get the tenant that owns this model.
     */
    public function tenant()
    {
        return $this->belongsTo(\App\Models\Tenant::class);
    }
}
