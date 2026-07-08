<?php

namespace App\Services;

use App\Models\Tenant;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Str;

class TenantService
{
    /**
     * List all tenants with pagination.
     */
    public function list(int $perPage = 15): LengthAwarePaginator
    {
        return Tenant::orderBy('created_at', 'desc')->paginate($perPage);
    }

    /**
     * Create a new tenant with an auto-generated unique API credential.
     */
    public function create(array $data): Tenant
    {
        $data['api_credential'] = Str::uuid()->toString();

        return Tenant::create($data);
    }

    /**
     * Update an existing tenant.
     */
    public function update(Tenant $tenant, array $data): Tenant
    {
        $tenant->update($data);

        return $tenant->fresh();
    }

    /**
     * Delete a tenant.
     */
    public function delete(Tenant $tenant): bool
    {
        return $tenant->delete();
    }
}
