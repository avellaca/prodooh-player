<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Screen;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ScreenshotViewController extends Controller
{
    /**
     * GET /api/admin/screens/{id}/screenshots
     *
     * List screenshots for a given screen.
     * Tenant isolation is enforced via Screen's BelongsToTenant global scope:
     * - Super-admin can view screenshots for any screen.
     * - Tenant-admin can only view screenshots for their own screens.
     */
    public function index(Request $request, string $id): JsonResponse
    {
        $screen = Screen::findOrFail($id);

        $screenshots = $screen->screenshots()
            ->orderByDesc('captured_at')
            ->get()
            ->map(fn ($screenshot) => [
                'id' => $screenshot->id,
                'storage_path' => "/api/admin/screenshots/{$screenshot->id}/file",
                // The captured_at was stored from a UTC ISO string but without timezone conversion.
                // Treat the stored value as UTC and convert to CDMX for display.
                'captured_at' => $screenshot->captured_at->shiftTimezone('UTC')->setTimezone('America/Mexico_City')->format('Y-m-d\TH:i:s'),
            ]);

        return response()->json(['data' => $screenshots]);
    }

    /**
     * GET /api/admin/screenshots/{id}/file
     *
     * Serve a screenshot image file.
     */
    public function file(Request $request, string $id)
    {
        $screenshot = \App\Models\Screenshot::findOrFail($id);

        // Try both possible paths (Laravel 11 uses private/ by default)
        $path = storage_path("app/{$screenshot->storage_path}");
        if (!file_exists($path)) {
            $path = storage_path("app/private/{$screenshot->storage_path}");
        }

        if (!file_exists($path)) {
            return response()->json(['message' => 'File not found'], 404);
        }

        return response()->file($path, [
            'Content-Type' => 'image/jpeg',
            'Cache-Control' => 'public, max-age=86400',
        ]);
    }

    /**
     * DELETE /api/admin/screenshots/{id}
     *
     * Delete a screenshot and its physical file.
     */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $screenshot = \App\Models\Screenshot::findOrFail($id);

        // Delete the physical file (check both possible paths)
        $path = storage_path("app/{$screenshot->storage_path}");
        if (!file_exists($path)) {
            $path = storage_path("app/private/{$screenshot->storage_path}");
        }
        if (file_exists($path)) {
            unlink($path);
        }

        $screenshot->delete();

        return response()->json(['message' => 'Screenshot deleted.']);
    }
}
