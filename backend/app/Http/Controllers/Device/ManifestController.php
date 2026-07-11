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
     * Serve the manifest for the authenticated device.
     * Supports ETag-based conditional requests (304 Not Modified).
     */
    public function show(Request $request): JsonResponse|Response
    {
        $screenId = $request->attributes->get('screen_id');

        $manifest = ScreenManifest::where('screen_id', $screenId)->first();

        if (!$manifest) {
            return response()->json([
                'version' => null,
                'generated_at' => null,
                'items' => [],
            ]);
        }

        // Check If-None-Match header for conditional request
        $ifNoneMatch = $request->header('If-None-Match');
        if ($ifNoneMatch && $ifNoneMatch === $manifest->version) {
            return response()->noContent(304);
        }

        return response()->json([
            'version' => $manifest->version,
            'generated_at' => $manifest->generated_at->toIso8601String(),
            'items' => $manifest->items,
        ])->header('ETag', $manifest->version);
    }

    /**
     * POST /api/device/manifest/confirm
     *
     * Receive manifest adoption confirmation from the device.
     */
    public function confirm(Request $request): JsonResponse
    {
        $request->validate([
            'version' => 'required|string',
        ]);

        $screenId = $request->attributes->get('screen_id');
        $screen = Screen::find($screenId);

        if (!$screen) {
            return response()->json(['error' => 'Screen not found'], 404);
        }

        $screen->update(['manifest_version' => $request->input('version')]);

        return response()->json(['ack' => true]);
    }
}
