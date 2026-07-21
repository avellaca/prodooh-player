<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreTagRequest;
use App\Http\Requests\UpdateTagRequest;
use App\Models\Tag;
use Illuminate\Http\JsonResponse;

class TagController extends Controller
{
    /**
     * List all tags for the authenticated user's tenant.
     *
     * GET /api/admin/tags
     */
    public function index(): JsonResponse
    {
        $tags = Tag::orderBy('name')->get();

        return response()->json(['data' => $tags]);
    }

    /**
     * Create a new tag.
     *
     * POST /api/admin/tags
     */
    public function store(StoreTagRequest $request): JsonResponse
    {
        $user = $request->user();
        $tenantId = $user->isSuperAdmin()
            ? (app()->bound('current_tenant_id') ? app('current_tenant_id') : null)
            : $user->tenant_id;

        $tag = Tag::create([
            'tenant_id' => $tenantId,
            'name' => $request->validated('name'),
        ]);

        return response()->json(['data' => $tag], 201);
    }

    /**
     * Rename a tag.
     *
     * PUT /api/admin/tags/{id}
     */
    public function update(UpdateTagRequest $request, string $id): JsonResponse
    {
        if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $id)) {
            return response()->json(['message' => 'Tag not found.'], 404);
        }

        $tag = Tag::find($id);

        if (!$tag) {
            return response()->json(['message' => 'Tag not found.'], 404);
        }

        $tag->update(['name' => $request->validated('name')]);

        return response()->json(['data' => $tag->fresh()]);
    }

    /**
     * Delete a tag.
     *
     * DELETE /api/admin/tags/{id}
     */
    public function destroy(string $id): JsonResponse
    {
        if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $id)) {
            return response()->json(['message' => 'Tag not found.'], 404);
        }

        $tag = Tag::find($id);

        if (!$tag) {
            return response()->json(['message' => 'Tag not found.'], 404);
        }

        $tag->contents()->detach();
        $tag->delete();

        return response()->json(null, 204);
    }
}
