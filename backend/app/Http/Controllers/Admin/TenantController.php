<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Tenant;
use App\Services\TenantService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TenantController extends Controller
{
    public function __construct(
        private readonly TenantService $tenantService
    ) {}

    /**
     * GET /api/admin/tenants — List all tenants (paginated).
     */
    public function index(Request $request): JsonResponse
    {
        $perPage = $request->integer('per_page', 15);
        $tenants = $this->tenantService->list($perPage);

        return response()->json($tenants);
    }

    /**
     * POST /api/admin/tenants — Create a new tenant.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'default_config' => 'nullable|array',
            'default_duration_seconds' => 'nullable|integer|min:1',
            'default_timezone' => 'nullable|string|max:100',
            'default_schedule' => 'nullable|array',
            'transition_type' => 'nullable|string|in:cut,fade,slide',
            'transition_duration_ms' => 'nullable|integer|min:0',
        ]);

        $tenant = $this->tenantService->create($validated);

        return response()->json($tenant->makeVisible('api_credential'), 201);
    }

    /**
     * GET /api/admin/tenants/{id} — Show tenant details.
     */
    public function show(string $id): JsonResponse
    {
        $tenant = Tenant::findOrFail($id);

        return response()->json($tenant);
    }

    /**
     * PUT /api/admin/tenants/{id} — Update tenant.
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $tenant = Tenant::findOrFail($id);

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'default_config' => 'nullable|array',
            'default_duration_seconds' => 'nullable|integer|min:1',
            'default_timezone' => 'nullable|string|max:100',
            'default_schedule' => 'nullable|array',
            'transition_type' => 'nullable|string|in:cut,fade,slide',
            'transition_duration_ms' => 'nullable|integer|min:0',
        ]);

        $tenant = $this->tenantService->update($tenant, $validated);

        return response()->json($tenant);
    }

    /**
     * DELETE /api/admin/tenants/{id} — Delete tenant.
     */
    public function destroy(string $id): JsonResponse
    {
        $tenant = Tenant::findOrFail($id);

        $this->tenantService->delete($tenant);

        return response()->json(['message' => 'Tenant deleted successfully.']);
    }
}
