<?php

namespace App\Http\Controllers\Device;

use App\Http\Controllers\Controller;
use App\Models\Screen;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;

class PlaylistSyncController extends Controller
{
    /**
     * GET /api/device/playlist
     *
     * Serve the playlist manifest for the authenticated device.
     * Supports ETag-based conditional requests (304 Not Modified).
     */
    public function index(Request $request): JsonResponse|Response
    {
        $screenId = $request->attributes->get('screen_id');
        $screen = Screen::with(['playlists.playlistItems.content'])->find($screenId);

        if (!$screen) {
            return response()->json(['error' => 'Screen not found'], 404);
        }

        // Get the first playlist assigned to this screen
        $playlist = $screen->playlists()->first();

        if (!$playlist) {
            return response()->json([
                'version' => null,
                'etag' => null,
                'items' => [],
            ]);
        }

        $currentVersion = $playlist->version;

        // Check If-None-Match header for conditional request
        $ifNoneMatch = $request->header('If-None-Match');
        if ($ifNoneMatch && $ifNoneMatch === $currentVersion) {
            return response()->noContent(304);
        }

        // Load playlist items with content
        $playlist->load('playlistItems.content');

        $items = $playlist->playlistItems
            ->sortBy('position')
            ->values()
            ->map(function ($item) {
                return [
                    'id' => $item->id,
                    'type' => $item->type,
                    'url' => $this->resolveItemUrl($item),
                    'duration' => $item->duration_seconds,
                    'rotation' => $item->content?->rotation ?? 0,
                    'refresh_interval' => $item->refresh_interval,
                    'checksum' => $item->content?->checksum_sha256,
                ];
            });

        return response()->json([
            'version' => $currentVersion,
            'etag' => $currentVersion,
            'items' => $items,
        ])->header('ETag', $currentVersion);
    }

    /**
     * POST /api/device/playlist/confirm
     *
     * Receive adoption confirmation from the device.
     */
    public function confirm(Request $request): JsonResponse
    {
        $request->validate([
            'version' => 'required|string',
            'status' => 'required|in:adopted,failed',
            'error' => 'nullable|string',
        ]);

        $screenId = $request->attributes->get('screen_id');
        $screen = Screen::find($screenId);

        if (!$screen) {
            return response()->json(['error' => 'Screen not found'], 404);
        }

        $version = $request->input('version');
        $status = $request->input('status');
        $error = $request->input('error');

        if ($status === 'adopted') {
            $screen->update(['manifest_version' => $version]);
            Log::info('Playlist adopted', [
                'screen_id' => $screenId,
                'version' => $version,
            ]);
        } else {
            Log::warning('Playlist adoption failed', [
                'screen_id' => $screenId,
                'version' => $version,
                'error' => $error,
            ]);
        }

        return response()->json(['ack' => true]);
    }

    /**
     * Resolve the URL for a playlist item based on its type.
     */
    private function resolveItemUrl($item): ?string
    {
        if ($item->type === 'url') {
            return $item->url;
        }

        // For image/video types, generate a device-accessible download URL
        if ($item->content) {
            return url("/api/device/content/{$item->content->id}/file");
        }

        return null;
    }

    /**
     * GET /api/device/content/{id}/file
     *
     * Serve a content file to the device for download.
     */
    public function serveContentFile(Request $request, string $id)
    {
        $content = \App\Models\Content::find($id);

        if (!$content) {
            return response()->json(['error' => 'Content not found'], 404);
        }

        $disk = Storage::disk('local');

        if (!$disk->exists($content->storage_path)) {
            return response()->json(['error' => 'File not found on storage'], 404);
        }

        $path = $disk->path($content->storage_path);

        return response()->file($path, [
            'Content-Type' => $content->mime_type,
            'Content-Disposition' => 'inline; filename="' . $content->filename . '"',
        ]);
    }
}
