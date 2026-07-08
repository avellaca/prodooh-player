<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\PlaylistService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PlaylistController extends Controller
{
    public function __construct(
        private readonly PlaylistService $playlistService,
    ) {}

    /**
     * List all playlists with item count.
     *
     * GET /api/admin/playlists
     */
    public function index(): JsonResponse
    {
        $playlists = $this->playlistService->list();

        return response()->json(['data' => $playlists]);
    }

    /**
     * Create a new playlist.
     *
     * POST /api/admin/playlists
     */
    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'name' => ['required', 'string', 'max:255'],
        ]);

        $user = $request->user();
        $tenantId = $user->tenant_id;

        // Super-admin must specify a tenant
        if ($user->isSuperAdmin()) {
            $request->validate([
                'tenant_id' => ['required', 'string', 'exists:tenants,id'],
            ]);
            $tenantId = $request->input('tenant_id');
        }

        $playlist = $this->playlistService->create([
            'tenant_id' => $tenantId,
            'name' => $request->input('name'),
        ]);

        return response()->json([
            'data' => $playlist,
            'message' => 'Playlist created successfully.',
        ], 201);
    }

    /**
     * Show a playlist with its items.
     *
     * GET /api/admin/playlists/{id}
     */
    public function show(string $id): JsonResponse
    {
        $playlist = $this->playlistService->show($id);

        return response()->json(['data' => $playlist]);
    }

    /**
     * Update playlist items (replaces all items).
     *
     * PUT /api/admin/playlists/{id}
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $playlist = $this->playlistService->show($id);

        $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'items' => ['sometimes', 'array'],
            'items.*.type' => ['required_with:items', 'string', 'in:image,video,url'],
            'items.*.content_id' => ['sometimes', 'nullable', 'string'],
            'items.*.url' => ['sometimes', 'nullable', 'string'],
            'items.*.duration_seconds' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'items.*.position' => ['required_with:items', 'integer', 'min:0'],
            'items.*.refresh_interval' => ['sometimes', 'nullable', 'integer', 'min:1'],
        ]);

        // Update name if provided
        if ($request->has('name')) {
            $playlist->update(['name' => $request->input('name')]);
        }

        // Update items if provided
        if ($request->has('items')) {
            $playlist = $this->playlistService->updateItems($playlist, $request->input('items'));
        }

        return response()->json(['data' => $playlist]);
    }

    /**
     * Delete a playlist.
     *
     * DELETE /api/admin/playlists/{id}
     */
    public function destroy(string $id): JsonResponse
    {
        $playlist = $this->playlistService->show($id);

        $this->playlistService->delete($playlist);

        return response()->json(['message' => 'Playlist deleted successfully.']);
    }

    /**
     * Assign a playlist to multiple screens.
     *
     * POST /api/admin/playlists/{id}/assign
     */
    public function assign(Request $request, string $id): JsonResponse
    {
        $playlist = $this->playlistService->show($id);

        $request->validate([
            'screen_ids' => ['required', 'array', 'min:1'],
            'screen_ids.*' => ['required', 'string', 'exists:screens,id'],
        ]);

        $this->playlistService->assignToScreens($playlist, $request->input('screen_ids'));

        return response()->json([
            'message' => 'Playlist assigned to screens successfully.',
        ]);
    }
}
