<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\ScreenGroup;
use App\Services\ScreenGroupService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ScreenGroupController extends Controller
{
    public function __construct(
        private readonly ScreenGroupService $screenGroupService
    ) {}

    /**
     * List all screen groups.
     */
    public function index(): JsonResponse
    {
        $groups = $this->screenGroupService->list();

        return response()->json($groups);
    }

    /**
     * Create a new screen group.
     */
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();

        // Accept tenant_id from query param (interceptor) if not in body
        if (!$request->input('tenant_id') && $request->query('tenant_id')) {
            $request->merge(['tenant_id' => $request->query('tenant_id')]);
        }

        // For tenant_admin, enforce their own tenant
        if ($user->isTenantAdmin()) {
            $request->merge(['tenant_id' => $user->tenant_id]);
        }

        $validated = $request->validate([
            'tenant_id' => ['required', 'uuid', 'exists:tenants,id'],
            'name' => ['required', 'string', 'max:255'],
            'duration_seconds' => ['nullable', 'integer', 'min:1'],
            'num_slots' => ['nullable', 'integer', 'min:1', 'max:100'],
            'ssp_slots' => ['nullable', 'integer', 'min:0'],
            'playlist_slots' => ['nullable', 'integer', 'min:0'],
            'schedule' => ['nullable', 'array'],
        ], [
            'tenant_id.required' => 'El network es obligatorio.',
            'tenant_id.uuid' => 'El ID del network no es válido.',
            'tenant_id.exists' => 'El network seleccionado no existe.',
            'name.required' => 'El nombre es obligatorio.',
            'name.max' => 'El nombre no puede exceder 255 caracteres.',
        ]);

        $group = $this->screenGroupService->create($validated);

        return response()->json($group, 201);
    }

    /**
     * Show a specific screen group.
     */
    public function show(string $id): JsonResponse
    {
        $group = ScreenGroup::with('screens')->findOrFail($id);

        return response()->json($group);
    }

    /**
     * Update a screen group.
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $group = ScreenGroup::findOrFail($id);

        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'duration_seconds' => ['nullable', 'integer', 'min:1'],
            'num_slots' => ['nullable', 'integer', 'min:1', 'max:100'],
            'ssp_slots' => ['nullable', 'integer', 'min:0'],
            'playlist_slots' => ['nullable', 'integer', 'min:0'],
            'schedule' => ['nullable', 'array'],
        ]);

        $group = $this->screenGroupService->update($group, $validated);

        // If schedule or duration changed, recalculate manifests for all screens in the group
        if ($request->has('schedule') || $request->has('duration_seconds')) {
            $screenIds = $group->screens()->pluck('id');
            foreach ($screenIds as $screenId) {
                \App\Jobs\RecalculateManifestJob::dispatch($screenId, true)->afterCommit();
            }
        }

        return response()->json($group);
    }

    /**
     * Delete a screen group.
     */
    public function destroy(string $id): JsonResponse
    {
        $group = ScreenGroup::findOrFail($id);

        $this->screenGroupService->delete($group);

        return response()->json(null, 204);
    }

    /**
     * Assign screens to a group.
     */
    public function assignScreens(Request $request, string $id): JsonResponse
    {
        $group = ScreenGroup::findOrFail($id);

        $validated = $request->validate([
            'screen_ids' => ['required', 'array', 'min:1'],
            'screen_ids.*' => ['required', 'uuid', 'exists:screens,id'],
        ]);

        $group = $this->screenGroupService->assignScreens($group, $validated['screen_ids']);

        return response()->json($group);
    }

    /**
     * Apply the group's schedule to all screens in the group.
     * Resets all screens' individual schedule override to null (inherit from group).
     */
    public function applySchedule(string $id): JsonResponse
    {
        $group = ScreenGroup::findOrFail($id);

        $group->screens()->update(['schedule' => null]);

        // Recalculate manifests for all screens (their effective schedule just changed)
        $screenIds = $group->screens()->pluck('id');
        foreach ($screenIds as $screenId) {
            \App\Jobs\RecalculateManifestJob::dispatch($screenId, true)->afterCommit();
        }

        return response()->json([
            'message' => 'Horario del grupo aplicado a todas las pantallas.',
            'screens_updated' => $group->screens()->count(),
        ]);
    }
}
