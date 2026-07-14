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

            if (!$user) {
                return;
            }

            if ($user->isSuperAdmin()) {
                // Super-admin: MUST have a tenant selected to see any data.
                // This enforces that all data is always scoped to a network.
                $tenantId = app()->bound('current_tenant_id') ? app('current_tenant_id') : null;
                if ($tenantId) {
                    $builder->where($builder->getModel()->getTable() . '.tenant_id', $tenantId);
                } else {
                    // No tenant selected → return empty results (force network selection)
                    $builder->whereRaw('1 = 0');
                }
            } else {
                // Tenant-admin: always filter by their own tenant
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
