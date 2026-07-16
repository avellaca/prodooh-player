<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use App\Services\LoopConfigValidator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class LoopConfigController extends Controller
{
    public function __construct(
        private readonly LoopConfigValidator $validator
    ) {}

    /**
     * PUT /api/admin/tenants/{id}/loop-config
     *
     * Update num_slots, ssp_slots, playlist_slots for a tenant.
     * Only tenant_admin (own tenant) or super_admin allowed.
     */
    public function updateLoopConfig(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        $tenant = Tenant::findOrFail($id);

        // Authorization: only super_admin or tenant_admin of own tenant
        if (!$this->canManageTenant($user, $tenant)) {
            return response()->json([
                'error' => 'Forbidden',
                'message' => 'You do not have permission to modify loop configuration.',
            ], 403);
        }

        $data = $request->validate([
            'num_slots' => 'required|integer',
            'ssp_slots' => 'required|integer',
            'playlist_slots' => 'required|integer',
        ]);

        // Use LoopConfigValidator for business rules validation
        $this->validator->validate([
            'num_slots' => (int) $data['num_slots'],
            'ssp_slots' => (int) $data['ssp_slots'],
            'playlist_slots' => (int) $data['playlist_slots'],
        ]);

        $tenant->update([
            'num_slots' => (int) $data['num_slots'],
            'ssp_slots' => (int) $data['ssp_slots'],
            'playlist_slots' => (int) $data['playlist_slots'],
        ]);

        $tenant->refresh();

        return response()->json($tenant);
    }

    /**
     * PUT /api/admin/tenants/{id}/network-settings
     *
     * Update sync_interval_seconds, cache_flush_interval_hours for a tenant.
     * Only tenant_admin (own tenant) or super_admin allowed.
     */
    public function updateNetworkSettings(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        $tenant = Tenant::findOrFail($id);

        // Authorization: only super_admin or tenant_admin of own tenant
        if (!$this->canManageTenant($user, $tenant)) {
            return response()->json([
                'error' => 'Forbidden',
                'message' => 'You do not have permission to modify network settings.',
            ], 403);
        }

        $data = $request->validate([
            'sync_interval_seconds' => 'sometimes|required|integer',
            'cache_flush_interval_hours' => 'sometimes|required|integer',
        ]);

        // Use LoopConfigValidator for range validation on network settings
        $configToValidate = [
            'num_slots' => $tenant->num_slots,
            'ssp_slots' => $tenant->ssp_slots,
            'playlist_slots' => $tenant->playlist_slots,
        ];

        if (isset($data['sync_interval_seconds'])) {
            $configToValidate['sync_interval_seconds'] = (int) $data['sync_interval_seconds'];
        }

        if (isset($data['cache_flush_interval_hours'])) {
            $configToValidate['cache_flush_interval_hours'] = (int) $data['cache_flush_interval_hours'];
        }

        $this->validator->validate($configToValidate);

        $updateData = [];
        if (isset($data['sync_interval_seconds'])) {
            $updateData['sync_interval_seconds'] = (int) $data['sync_interval_seconds'];
        }
        if (isset($data['cache_flush_interval_hours'])) {
            $updateData['cache_flush_interval_hours'] = (int) $data['cache_flush_interval_hours'];
        }

        if (!empty($updateData)) {
            $tenant->update($updateData);
        }

        $tenant->refresh();

        return response()->json($tenant);
    }

    /**
     * POST /api/admin/tenants/{id}/loop-config/propagate
     *
     * Propagate num_slots to all ScreenGroups and Screens that don't have an explicit override.
     * Only tenant_admin (own tenant) or super_admin allowed.
     */
    public function propagate(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        $tenant = Tenant::findOrFail($id);

        // Authorization: only super_admin or tenant_admin of own tenant
        if (!$this->canManageTenant($user, $tenant)) {
            return response()->json([
                'error' => 'Forbidden',
                'message' => 'You do not have permission to propagate loop configuration.',
            ], 403);
        }

        // Count ALL entities that will be affected (forced override)
        $affectedGroups = ScreenGroup::withoutGlobalScope('tenant')
            ->where('tenant_id', $tenant->id)
            ->count();

        $affectedScreens = Screen::withoutGlobalScope('tenant')
            ->where('tenant_id', $tenant->id)
            ->count();

        // Force override: set num_slots, ssp_slots, playlist_slots on ALL descendants
        // This overwrites any existing custom values
        ScreenGroup::withoutGlobalScope('tenant')
            ->where('tenant_id', $tenant->id)
            ->update([
                'num_slots' => $tenant->num_slots,
                'ssp_slots' => $tenant->ssp_slots,
                'playlist_slots' => $tenant->playlist_slots,
            ]);

        Screen::withoutGlobalScope('tenant')
            ->where('tenant_id', $tenant->id)
            ->update([
                'num_slots' => $tenant->num_slots,
                'ssp_slots' => $tenant->ssp_slots,
                'playlist_slots' => $tenant->playlist_slots,
            ]);

        return response()->json([
            'message' => 'Configuración aplicada a todos los grupos y pantallas.',
            'affected_screen_groups' => $affectedGroups,
            'affected_screens' => $affectedScreens,
            'num_slots' => $tenant->num_slots,
        ]);
    }

    /**
     * Check if the user can manage the given tenant's configuration.
     */
    private function canManageTenant($user, Tenant $tenant): bool
    {
        if ($user->isSuperAdmin()) {
            return true;
        }

        if ($user->isTenantAdmin() && $user->tenant_id === $tenant->id) {
            return true;
        }

        return false;
    }

    /**
     * GET /api/admin/tenants/{id}/loop-config
     *
     * Get the current loop and network configuration for a tenant.
     * Accessible by tenant_admin (own tenant) or super_admin.
     */
    public function show(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        $tenant = Tenant::findOrFail($id);

        if (!$this->canManageTenant($user, $tenant)) {
            return response()->json([
                'error' => 'Forbidden',
                'message' => 'You do not have permission to view this configuration.',
            ], 403);
        }

        return response()->json([
            'id' => $tenant->id,
            'name' => $tenant->name,
            'num_slots' => $tenant->num_slots ?? 10,
            'ssp_slots' => $tenant->ssp_slots ?? 0,
            'playlist_slots' => $tenant->playlist_slots ?? 0,
            'default_duration_seconds' => $tenant->default_duration_seconds ?? 10,
            'sync_interval_seconds' => $tenant->sync_interval_seconds ?? 240,
            'cache_flush_interval_hours' => $tenant->cache_flush_interval_hours ?? 24,
        ]);
    }
}
