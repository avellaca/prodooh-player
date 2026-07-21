<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Content;
use App\Models\Creative;
use App\Models\PlaylistItem;
use App\Models\Tag;
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
     * Supports optional resolution filtering via query params width and height.
     *
     * GET /api/admin/content
     * GET /api/admin/content?width=1920&height=1080
     */
    public function index(Request $request): JsonResponse
    {
        $query = Content::with('tags')->orderBy('created_at', 'desc');

        if ($request->has('width') && $request->has('height')) {
            $width = (int) $request->input('width');
            $height = (int) $request->input('height');
            $query->where('width', $width)->where('height', $height);
        }

        $content = $query->get();

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

        // Super-admin must specify a tenant (via body or query param from interceptor)
        if ($user->isSuperAdmin()) {
            $tenantId = $request->input('tenant_id') ?? $request->query('tenant_id');
            if (!$tenantId) {
                return response()->json([
                    'message' => 'La validación del contenido falló.',
                    'errors' => ['tenant_id' => ['Debe seleccionar un network antes de subir contenido.']],
                ], 422);
            }
        }

        $result = $this->contentLibraryService->upload(
            $request->file('file'),
            $tenantId
        );

        if ($result['content'] === null) {
            return response()->json([
                'message' => 'La validación del contenido falló.',
                'errors' => $result['validation']->errors,
            ], 422);
        }

        return response()->json([
            'data' => $result['content'],
            'message' => 'Contenido subido exitosamente.',
        ], 201);
    }

    /**
     * Bulk upload up to 50 files with optional tag assignment.
     * Returns 207 Multi-Status with per-file results.
     *
     * POST /api/admin/content/bulk
     */
    public function bulkStore(Request $request): JsonResponse
    {
        $request->validate([
            'files' => ['required', 'array', 'min:1', 'max:50'],
            'files.*' => ['required', 'file'],
            'tag_ids' => ['sometimes', 'array'],
            'tag_ids.*' => ['string', 'uuid', 'exists:tags,id'],
        ], [
            'files.required' => 'Se requiere al menos un archivo.',
            'files.max' => 'Se permiten máximo 50 archivos por lote.',
            'files.*.file' => 'Cada elemento debe ser un archivo válido.',
            'tag_ids.*.uuid' => 'Cada tag_id debe ser un UUID válido.',
            'tag_ids.*.exists' => 'Uno o más tags no existen.',
        ]);

        $user = $request->user();
        $tenantId = $user->tenant_id;

        // Super-admin must specify a tenant
        if ($user->isSuperAdmin()) {
            $tenantId = $request->input('tenant_id') ?? $request->query('tenant_id');
            if (!$tenantId) {
                return response()->json([
                    'message' => 'La validación del contenido falló.',
                    'errors' => ['tenant_id' => ['Debe seleccionar un network antes de subir contenido.']],
                ], 422);
            }
        }

        // Validate that provided tags belong to the same tenant
        $tagIds = $request->input('tag_ids', []);
        if (!empty($tagIds)) {
            $validTagCount = Tag::where('tenant_id', $tenantId)
                ->whereIn('id', $tagIds)
                ->count();

            if ($validTagCount !== count($tagIds)) {
                return response()->json([
                    'message' => 'La validación del contenido falló.',
                    'errors' => ['tag_ids' => ['Uno o más tags no pertenecen al tenant actual.']],
                ], 422);
            }
        }

        $files = $request->file('files');
        $successes = [];
        $failures = [];

        foreach ($files as $index => $file) {
            try {
                $result = $this->contentLibraryService->upload($file, $tenantId);

                if ($result['content'] === null) {
                    $failures[] = [
                        'index' => $index,
                        'filename' => $file->getClientOriginalName(),
                        'errors' => $result['validation']->errors,
                    ];

                    continue;
                }

                // Associate tags with the uploaded content
                if (!empty($tagIds)) {
                    $result['content']->tags()->sync($tagIds);
                }

                $successes[] = [
                    'index' => $index,
                    'data' => $result['content']->load('tags'),
                ];
            } catch (\Throwable $e) {
                $failures[] = [
                    'index' => $index,
                    'filename' => $file->getClientOriginalName(),
                    'errors' => [$e->getMessage()],
                ];
            }
        }

        return response()->json([
            'successes' => $successes,
            'failures' => $failures,
            'summary' => [
                'total' => count($files),
                'successful' => count($successes),
                'failed' => count($failures),
            ],
        ], 207);
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

        // Verificar FK antes de intentar delete
        if (Creative::where('content_id', $content->id)->exists()) {
            return response()->json([
                'message' => 'No se puede eliminar este contenido porque está siendo utilizado por uno o más creativos activos. Elimine primero los creativos que lo referencian.',
            ], 409);
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

    /**
     * Serve the content file for preview.
     *
     * GET /api/admin/content/{id}/preview/file
     */
    public function serveFile(string $id)
    {
        $content = Content::find($id);

        if (! $content) {
            return response()->json(['message' => 'Content not found.'], 404);
        }

        $disk = \Illuminate\Support\Facades\Storage::disk('local');

        if (! $disk->exists($content->storage_path)) {
            return response()->json(['message' => 'File not found on storage.'], 404);
        }

        $path = $disk->path($content->storage_path);

        return response()->file($path, [
            'Content-Type' => $content->mime_type,
            'Content-Disposition' => 'inline; filename="' . $content->filename . '"',
        ]);
    }
}
