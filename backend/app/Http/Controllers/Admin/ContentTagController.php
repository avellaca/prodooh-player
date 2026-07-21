<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Content;
use App\Models\Tag;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ContentTagController extends Controller
{
    /**
     * Assign tags to a content item.
     *
     * POST /api/admin/content/{id}/tags
     * Body: { "tag_ids": ["uuid", ...] }
     */
    public function store(Request $request, string $id): JsonResponse
    {
        if (!$this->isValidUuid($id)) {
            return response()->json(['message' => 'Content not found.'], 404);
        }

        $content = Content::find($id);

        if (!$content) {
            return response()->json(['message' => 'Content not found.'], 404);
        }

        $validated = $request->validate([
            'tag_ids' => ['required', 'array', 'min:1'],
            'tag_ids.*' => ['required', 'uuid', 'exists:tags,id'],
        ], [
            'tag_ids.required' => 'Debe proporcionar al menos un tag.',
            'tag_ids.min' => 'Debe proporcionar al menos un tag.',
            'tag_ids.*.exists' => 'Uno o más tags no existen.',
        ]);

        // Sync without detaching — adds new tags without removing existing ones
        $content->tags()->syncWithoutDetaching($validated['tag_ids']);

        return response()->json([
            'data' => $content->load('tags'),
            'message' => 'Tags asignados exitosamente.',
        ]);
    }

    /**
     * Remove a tag from a content item.
     *
     * DELETE /api/admin/content/{id}/tags/{tagId}
     */
    public function destroy(string $id, string $tagId): JsonResponse
    {
        if (!$this->isValidUuid($id)) {
            return response()->json(['message' => 'Content not found.'], 404);
        }

        $content = Content::find($id);

        if (!$content) {
            return response()->json(['message' => 'Content not found.'], 404);
        }

        if (!$this->isValidUuid($tagId)) {
            return response()->json(['message' => 'Tag not found.'], 404);
        }

        $tag = Tag::find($tagId);

        if (!$tag) {
            return response()->json(['message' => 'Tag not found.'], 404);
        }

        $content->tags()->detach($tagId);

        return response()->json([
            'data' => $content->load('tags'),
            'message' => 'Tag removido exitosamente.',
        ]);
    }

    /**
     * Check if a string is a valid UUID format.
     */
    private function isValidUuid(string $value): bool
    {
        return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value) === 1;
    }
}
