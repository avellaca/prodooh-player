<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\OrderLine;
use App\Services\DeviceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ScreenController extends Controller
{
    public function __construct(
        private readonly DeviceService $deviceService,
    ) {}

    /**
     * List screens (tenant-filtered via BelongsToTenant).
     */
    public function index(): JsonResponse
    {
        $screens = $this->deviceService->list();

        return response()->json(['data' => $screens]);
    }

    /**
     * Register a new screen and return the plaintext device_token.
     */
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();

        $rules = [
            'venue_id' => ['required', 'string', Rule::unique('screens', 'venue_id')],
            'name' => ['required', 'string', 'max:255'],
            'orientation' => ['sometimes', 'string', 'in:landscape,portrait'],
            'resolution_width' => ['sometimes', 'integer', 'min:1'],
            'resolution_height' => ['sometimes', 'integer', 'min:1'],
            'group_id' => ['sometimes', 'nullable', 'string'],
        ];

        // Super-admin can assign to any tenant; tenant-admin's tenant is implicit
        if ($user->isSuperAdmin()) {
            // Accept tenant_id from body or query param (interceptor injects it as query param)
            if (!$request->input('tenant_id') && $request->query('tenant_id')) {
                $request->merge(['tenant_id' => $request->query('tenant_id')]);
            }
            $rules['tenant_id'] = ['required', 'string', 'exists:tenants,id'];
        }

        $validated = $request->validate($rules);

        // If tenant-admin, enforce their own tenant
        if ($user->isTenantAdmin()) {
            $validated['tenant_id'] = $user->tenant_id;
        }

        $result = $this->deviceService->register($validated);

        return response()->json([
            'data' => $result['screen'],
            'device_token' => $result['device_token'],
            'message' => 'Screen registered. Store the device_token securely — it will not be shown again.',
        ], 201);
    }

    /**
     * Show a single screen's details.
     */
    public function show(string $id): JsonResponse
    {
        $screen = $this->deviceService->show($id);

        return response()->json(['data' => $screen]);
    }

    /**
     * Update a screen's configuration.
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $screen = $this->deviceService->show($id);

        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'venue_id' => ['sometimes', 'string', 'max:255'],
            'orientation' => ['sometimes', 'string', 'in:landscape,portrait'],
            'resolution_width' => ['sometimes', 'integer', 'min:1'],
            'resolution_height' => ['sometimes', 'integer', 'min:1'],
            'num_slots' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100'],
            'ssp_slots' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'playlist_slots' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'group_id' => ['sometimes', 'nullable', 'string'],
            'enabled' => ['sometimes', 'boolean'],
            'duration_seconds' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'schedule' => ['sometimes', 'nullable', 'array'],
            'loop_config' => ['sometimes', 'nullable', 'array'],
            'sources_config' => ['sometimes', 'nullable', 'array'],
            'transition_type' => ['sometimes', 'nullable', 'string'],
            'transition_duration_ms' => ['sometimes', 'nullable', 'integer', 'min:0'],
        ]);

        $updated = $this->deviceService->update($screen, $validated);

        return response()->json(['data' => $updated]);
    }

    /**
     * Regenerate a screen's device token.
     *
     * The new plaintext token is returned once only and cannot be recovered later.
     * The old token hash is replaced, invalidating any existing device sessions.
     */
    public function regenerateToken(Request $request, string $id): JsonResponse
    {
        $screen = $this->deviceService->show($id);

        $result = $this->deviceService->regenerateToken($screen);

        return response()->json([
            'data' => $result['screen'],
            'device_token' => $result['device_token'],
            'message' => 'Token regenerated. Store the new device_token securely — it will not be shown again.',
        ]);
    }

    /**
     * Delete a screen.
     */
    public function destroy(string $id): JsonResponse
    {
        $screen = $this->deviceService->show($id);
        $screen->delete();

        return response()->json(['message' => 'Screen deleted successfully.']);
    }

    /**
     * Get the current manifest for a screen.
     */
    public function manifest(string $id): JsonResponse
    {
        $screen = $this->deviceService->show($id);
        $manifest = $screen->screenManifest;

        if (!$manifest) {
            return response()->json(['data' => null]);
        }

        return response()->json(['data' => $manifest]);
    }

    /**
     * Get active order lines assigned to this screen (directly or via its group).
     *
     * GET /api/admin/screens/{id}/active-order-lines
     */
    public function activeOrderLines(string $id): JsonResponse
    {
        $screen = $this->deviceService->show($id);
        $screenId = $screen->id;
        $groupId = $screen->group_id;

        $lines = OrderLine::query()
            ->whereHas('targets', function ($q) use ($screenId, $groupId) {
                $q->where(function ($inner) use ($screenId, $groupId) {
                    $inner->where('screen_id', $screenId);
                    if ($groupId) {
                        $inner->orWhere('screen_group_id', $groupId);
                    }
                });
            })
            ->where('status', 'active')
            ->with(['order:id,name,status'])
            ->get();

        return response()->json(['data' => $lines]);
    }
}
