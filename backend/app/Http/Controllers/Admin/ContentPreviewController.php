<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Content;
use App\Models\PlaylistItem;
use App\Models\Screen;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class ContentPreviewController extends Controller
{
    /**
     * Preview content with screen dimensions and orientation context.
     *
     * GET /api/admin/content/{id}/preview
     *
     * Optional query params:
     *   - screen_id: The target screen to preview against (for resolution/orientation checks)
     *
     * Validates: Requirements 19.1, 19.2, 19.3, 19.4, 24.4, 28.7
     */
    public function show(Request $request, string $id): JsonResponse
    {
        $content = Content::find($id);

        if (! $content) {
            return response()->json(['message' => 'Content not found.'], 404);
        }

        $screenId = $request->query('screen_id');
        $screen = $screenId ? Screen::find($screenId) : null;

        $preview = $this->buildPreviewData($content, $screen);

        return response()->json(['data' => $preview]);
    }

    /**
     * Preview a playlist item (supports URL items that don't have a content record).
     *
     * GET /api/admin/playlist-items/{id}/preview
     *
     * Optional query params:
     *   - screen_id: The target screen to preview against
     *
     * Validates: Requirement 28.7
     */
    public function showPlaylistItem(Request $request, string $id): JsonResponse
    {
        $playlistItem = PlaylistItem::with('content')->find($id);

        if (! $playlistItem) {
            return response()->json(['message' => 'Playlist item not found.'], 404);
        }

        $screenId = $request->query('screen_id');
        $screen = $screenId ? Screen::find($screenId) : null;

        if ($playlistItem->type === 'url') {
            $preview = $this->buildUrlPreviewData($playlistItem, $screen);
        } else {
            if (! $playlistItem->content) {
                return response()->json(['message' => 'Content not found for this playlist item.'], 404);
            }
            $preview = $this->buildPreviewData($playlistItem->content, $screen);
        }

        return response()->json(['data' => $preview]);
    }

    /**
     * Build preview data for a content item (image or video).
     */
    private function buildPreviewData(Content $content, ?Screen $screen): array
    {
        $effectiveDimensions = $this->getEffectiveDimensions($content);

        $preview = [
            'content_id' => $content->id,
            'type' => $this->resolveContentType($content),
            'filename' => $content->filename,
            'mime_type' => $content->mime_type,
            'format' => $this->resolveFormat($content),
            'resolution' => [
                'width' => $content->width,
                'height' => $content->height,
            ],
            'effective_resolution' => [
                'width' => $effectiveDimensions['width'],
                'height' => $effectiveDimensions['height'],
            ],
            'orientation' => $content->orientation,
            'rotation' => $content->rotation,
            'duration_seconds' => $content->duration_seconds,
            'file_size_bytes' => $content->file_size_bytes,
            'preview_url' => $this->generatePreviewUrl($content),
            'warnings' => [],
        ];

        // Add screen context if provided
        if ($screen) {
            $preview['screen'] = [
                'id' => $screen->id,
                'name' => $screen->name,
                'resolution' => [
                    'width' => $screen->resolution_width,
                    'height' => $screen->resolution_height,
                ],
                'orientation' => $screen->orientation,
            ];

            $preview['warnings'] = $this->detectWarnings($content, $screen);
        }

        return $preview;
    }

    /**
     * Build preview data for a URL playlist item.
     */
    private function buildUrlPreviewData(PlaylistItem $item, ?Screen $screen): array
    {
        $preview = [
            'playlist_item_id' => $item->id,
            'type' => 'url',
            'url' => $item->url,
            'duration_seconds' => $item->duration_seconds,
            'refresh_interval' => $item->refresh_interval,
            'preview_url' => $item->url,
            'warnings' => [],
        ];

        if ($screen) {
            $preview['screen'] = [
                'id' => $screen->id,
                'name' => $screen->name,
                'resolution' => [
                    'width' => $screen->resolution_width,
                    'height' => $screen->resolution_height,
                ],
                'orientation' => $screen->orientation,
            ];
        }

        return $preview;
    }

    /**
     * Get effective dimensions after rotation is applied.
     */
    private function getEffectiveDimensions(Content $content): array
    {
        $width = $content->width;
        $height = $content->height;

        // 90° or 270° rotation swaps width and height
        if (in_array($content->rotation, [90, 270])) {
            return ['width' => $height, 'height' => $width];
        }

        return ['width' => $width, 'height' => $height];
    }

    /**
     * Detect orientation and resolution warnings when comparing content to a target screen.
     */
    private function detectWarnings(Content $content, Screen $screen): array
    {
        $warnings = [];
        $effectiveDimensions = $this->getEffectiveDimensions($content);

        // Determine effective content orientation after rotation
        $effectiveOrientation = $effectiveDimensions['width'] >= $effectiveDimensions['height']
            ? 'landscape'
            : 'portrait';

        // Orientation mismatch warning (Req 19.4)
        if ($effectiveOrientation !== $screen->orientation) {
            $warnings[] = [
                'type' => 'orientation_mismatch',
                'message' => "Content orientation ({$effectiveOrientation}) does not match screen orientation ({$screen->orientation}).",
                'severity' => 'warning',
            ];
        }

        // Resolution mismatch warning (Req 19.3, 19.4)
        if ($effectiveDimensions['width'] !== $screen->resolution_width
            || $effectiveDimensions['height'] !== $screen->resolution_height) {
            $warnings[] = [
                'type' => 'resolution_mismatch',
                'message' => "Content resolution ({$effectiveDimensions['width']}x{$effectiveDimensions['height']}) does not match screen resolution ({$screen->resolution_width}x{$screen->resolution_height}).",
                'severity' => 'info',
            ];
        }

        // Aspect ratio mismatch (content will be stretched/letterboxed)
        $contentAspect = $effectiveDimensions['height'] > 0
            ? round($effectiveDimensions['width'] / $effectiveDimensions['height'], 3)
            : 0;
        $screenAspect = $screen->resolution_height > 0
            ? round($screen->resolution_width / $screen->resolution_height, 3)
            : 0;

        if ($contentAspect > 0 && $screenAspect > 0 && abs($contentAspect - $screenAspect) > 0.01) {
            $warnings[] = [
                'type' => 'aspect_ratio_mismatch',
                'message' => 'Content aspect ratio does not match screen aspect ratio. Content may be stretched or letterboxed.',
                'severity' => 'info',
            ];
        }

        return $warnings;
    }

    /**
     * Resolve the content type for preview.
     */
    private function resolveContentType(Content $content): string
    {
        if (str_starts_with($content->mime_type, 'image/')) {
            return 'image';
        }
        if (str_starts_with($content->mime_type, 'video/')) {
            return 'video';
        }

        return 'unknown';
    }

    /**
     * Resolve a human-readable format string.
     */
    private function resolveFormat(Content $content): string
    {
        return match ($content->mime_type) {
            'image/jpeg' => 'JPEG',
            'image/png' => 'PNG',
            'image/webp' => 'WebP',
            'video/mp4' => 'MP4',
            default => strtoupper(explode('/', $content->mime_type)[1] ?? 'unknown'),
        };
    }

    /**
     * Generate a URL for previewing the content file.
     */
    private function generatePreviewUrl(Content $content): ?string
    {
        if (Storage::disk('local')->exists($content->storage_path)) {
            return route('admin.content.preview.file', ['id' => $content->id]);
        }

        return null;
    }
}
