<?php

namespace App\Http\Controllers\Device;

use App\Http\Controllers\Controller;
use App\Models\Screen;
use App\Models\ScreenManifest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ManifestController extends Controller
{
    /**
     * GET /api/device/manifest
     *
     * Serve the Loop Template JSON for the authenticated device.
     * Supports ETag-based conditional requests via If-None-Match header:
     * - If the version hasn't changed → HTTP 304 Not Modified
     * - Otherwise → HTTP 200 with the full Loop Template JSON
     *
     * The response includes sync_interval_seconds and cache_flush_interval_hours
     * from tenant configuration for the player to use.
     */
    public function show(Request $request): JsonResponse|Response
    {
        $screenId = $request->attributes->get('screen_id');
        $screen = Screen::withoutGlobalScopes()->find($screenId);

        $manifest = ScreenManifest::where('screen_id', $screenId)->first();

        if (!$manifest) {
            // Return an empty Loop Template structure when no manifest exists
            $tenant = $screen ? $screen->tenant : null;
            $syncInterval = $tenant ? (int) ($tenant->sync_interval_seconds ?? 240) : 240;
            $cacheFlush = $tenant ? (int) ($tenant->cache_flush_interval_hours ?? 24) : 24;

            return response()->json([
                'version' => null,
                'generated_at' => null,
                'loop_config' => null,
                'slots' => [],
                'sync_interval_seconds' => $syncInterval,
                'cache_flush_interval_hours' => $cacheFlush,
            ]);
        }

        // Check If-None-Match header for conditional request (ETag = version hash)
        $ifNoneMatch = $request->header('If-None-Match');
        if ($ifNoneMatch && $ifNoneMatch === $manifest->version) {
            return response()->noContent(304);
        }

        // The Loop Template JSON is stored in the `items` column
        // It already contains: version, generated_at, loop_config, slots,
        // sync_interval_seconds, and cache_flush_interval_hours
        $loopTemplate = $manifest->items;

        // Ensure sync_interval_seconds and cache_flush_interval_hours are present
        // (fallback to tenant config if not in stored template)
        if (!isset($loopTemplate['sync_interval_seconds']) || !isset($loopTemplate['cache_flush_interval_hours'])) {
            $tenant = $screen ? $screen->tenant : null;
            if (!isset($loopTemplate['sync_interval_seconds'])) {
                $loopTemplate['sync_interval_seconds'] = $tenant ? (int) ($tenant->sync_interval_seconds ?? 240) : 240;
            }
            if (!isset($loopTemplate['cache_flush_interval_hours'])) {
                $loopTemplate['cache_flush_interval_hours'] = $tenant ? (int) ($tenant->cache_flush_interval_hours ?? 24) : 24;
            }
        }

        return response()->json($loopTemplate)
            ->header('ETag', $manifest->version);
    }

    /**
     * POST /api/device/manifest/confirm
     *
     * Receive manifest adoption confirmation from the device.
     */
    public function confirm(Request $request): JsonResponse
    {
        $request->validate([
            'version' => 'nullable|string',
        ]);

        $screenId = $request->attributes->get('screen_id');
        $screen = Screen::find($screenId);

        if (!$screen) {
            return response()->json(['error' => 'Screen not found'], 404);
        }

        if ($request->input('version')) {
            $screen->update(['manifest_version' => $request->input('version')]);
        }

        return response()->json(['ack' => true]);
    }
}
