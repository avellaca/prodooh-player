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
        $validated = $request->validate([
            'tenant_id' => ['required', 'uuid', 'exists:tenants,id'],
            'name' => ['required', 'string', 'max:255'],
            'duration_seconds' => ['nullable', 'integer', 'min:1'],
            'schedule' => ['nullable', 'array'],
            'orientation' => ['nullable', 'string', 'in:landscape,portrait'],
            'resolution_width' => ['nullable', 'integer', 'min:1'],
            'resolution_height' => ['nullable', 'integer', 'min:1'],
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
            'schedule' => ['nullable', 'array'],
            'orientation' => ['nullable', 'string', 'in:landscape,portrait'],
            'resolution_width' => ['nullable', 'integer', 'min:1'],
            'resolution_height' => ['nullable', 'integer', 'min:1'],
        ]);

        $group = $this->screenGroupService->update($group, $validated);

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
}
