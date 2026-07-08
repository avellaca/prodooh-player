<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Content;
use App\Models\PlaylistItem;
use App\Services\ContentLibraryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ContentController extends Controller
{
    public function __construct(
        private readonly ContentLibraryService $contentLibraryService,
    ) {}

    /**
     * List all content for the authenticated user's tenant.
     *
     * GET /api/admin/content
     */
    public function index(): JsonResponse
    {
        $content = $this->contentLibraryService->list();

        return response()->json(['data' => $content]);
    }

    /**
     * Upload and validate new content.
     *
     * POST /api/admin/content
     */
    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'file' => ['required', 'file'],
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

        $result = $this->contentLibraryService->upload(
            $request->file('file'),
            $tenantId
        );

        if ($result['content'] === null) {
            return response()->json([
                'message' => 'Content validation failed.',
                'errors' => $result['validation']->errors,
            ], 422);
        }

        return response()->json([
            'data' => $result['content'],
            'message' => 'Content uploaded successfully.',
        ], 201);
    }

    /**
     * Delete a content item.
     *
     * DELETE /api/admin/content/{id}
     */
    public function destroy(string $id): JsonResponse
    {
        $content = Content::find($id);

        if (! $content) {
            return response()->json(['message' => 'Content not found.'], 404);
        }

        $this->contentLibraryService->delete($content);

        return response()->json(['message' => 'Content deleted successfully.']);
    }

    /**
     * Set the rotation metadata for a content item.
     *
     * PUT /api/admin/content/{id}/rotate
     */
    public function rotate(Request $request, string $id): JsonResponse
    {
        $content = Content::find($id);

        if (! $content) {
            return response()->json(['message' => 'Content not found.'], 404);
        }

        $request->validate([
            'rotation' => ['required', Rule::in([0, 90, 180, 270])],
        ]);

        // If content is a video, check if it's in an active playlist (assigned to a screen)
        if (str_starts_with($content->mime_type, 'video/')) {
            $isInActivePlaylist = PlaylistItem::where('content_id', $content->id)
                ->whereHas('playlist.screens')
                ->exists();

            if ($isInActivePlaylist) {
                return response()->json([
                    'message' => 'Cannot rotate video while in active playlist.',
                ], 422);
            }
        }

        $content->rotation = (int) $request->input('rotation');
        $content->save();

        return response()->json([
            'data' => $content->fresh(),
            'message' => 'Content rotation updated successfully.',
        ]);
    }
}
