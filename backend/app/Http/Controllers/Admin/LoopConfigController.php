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
     * Propagate num_slots to all ScreenGroups and Screens.
     * Accepts optional exclude_group_ids and exclude_screen_ids to skip specific entities.
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

        $data = $request->validate([
            'exclude_group_ids' => ['sometimes', 'array'],
            'exclude_group_ids.*' => ['uuid'],
            'exclude_screen_ids' => ['sometimes', 'array'],
            'exclude_screen_ids.*' => ['uuid'],
        ]);

        $excludeGroupIds = $data['exclude_group_ids'] ?? [];
        $excludeScreenIds = $data['exclude_screen_ids'] ?? [];

        // Count entities that will be affected
        $groupsQuery = ScreenGroup::withoutGlobalScope('tenant')
            ->where('tenant_id', $tenant->id);
        $screensQuery = Screen::withoutGlobalScope('tenant')
            ->where('tenant_id', $tenant->id);

        if (!empty($excludeGroupIds)) {
            $groupsQuery->whereNotIn('id', $excludeGroupIds);
        }
        if (!empty($excludeScreenIds)) {
            $screensQuery->whereNotIn('id', $excludeScreenIds);
        }

        $affectedGroups = $groupsQuery->count();
        $affectedScreens = $screensQuery->count();

        // Force override on non-excluded entities
        $groupsUpdate = ScreenGroup::withoutGlobalScope('tenant')
            ->where('tenant_id', $tenant->id);
        $screensUpdate = Screen::withoutGlobalScope('tenant')
            ->where('tenant_id', $tenant->id);

        if (!empty($excludeGroupIds)) {
            $groupsUpdate->whereNotIn('id', $excludeGroupIds);
        }
        if (!empty($excludeScreenIds)) {
            $screensUpdate->whereNotIn('id', $excludeScreenIds);
        }

        $groupsUpdate->update([
            'num_slots' => $tenant->num_slots,
            'ssp_slots' => $tenant->ssp_slots,
            'playlist_slots' => $tenant->playlist_slots,
        ]);

        $screensUpdate->update([
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
     * GET /api/admin/tenants/{id}/loop-config/overrides
     *
     * List groups and screens that have a configuration different from the tenant's.
     */
    public function overrides(Request $request, string $id): JsonResponse
    {
        $user = $request->user();
        $tenant = Tenant::findOrFail($id);

        if (!$this->canManageTenant($user, $tenant)) {
            return response()->json([
                'error' => 'Forbidden',
                'message' => 'You do not have permission to view this configuration.',
            ], 403);
        }

        // Groups with different config than tenant
        $groups = ScreenGroup::withoutGlobalScope('tenant')
            ->where('tenant_id', $tenant->id)
            ->where(function ($q) use ($tenant) {
                $q->where('num_slots', '!=', $tenant->num_slots)
                  ->orWhere('ssp_slots', '!=', $tenant->ssp_slots)
                  ->orWhere('playlist_slots', '!=', $tenant->playlist_slots);
            })
            ->orderBy('name')
            ->get(['id', 'name', 'num_slots', 'ssp_slots', 'playlist_slots'])
            ->map(fn ($g) => [
                'id' => $g->id,
                'name' => $g->name,
                'type' => 'group',
                'num_slots' => $g->num_slots,
                'ssp_slots' => $g->ssp_slots,
                'playlist_slots' => $g->playlist_slots,
            ]);

        // Screens with different config than tenant
        $screens = Screen::withoutGlobalScope('tenant')
            ->where('tenant_id', $tenant->id)
            ->where(function ($q) use ($tenant) {
                $q->where('num_slots', '!=', $tenant->num_slots)
                  ->orWhere('ssp_slots', '!=', $tenant->ssp_slots)
                  ->orWhere('playlist_slots', '!=', $tenant->playlist_slots);
            })
            ->orderBy('name')
            ->get(['id', 'name', 'num_slots', 'ssp_slots', 'playlist_slots'])
            ->map(fn ($s) => [
                'id' => $s->id,
                'name' => $s->name,
                'type' => 'screen',
                'num_slots' => $s->num_slots,
                'ssp_slots' => $s->ssp_slots,
                'playlist_slots' => $s->playlist_slots,
            ]);

        // Merge: groups first, then screens (both ordered by name)
        $overrides = $groups->concat($screens)->values();

        return response()->json(['data' => $overrides]);
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
