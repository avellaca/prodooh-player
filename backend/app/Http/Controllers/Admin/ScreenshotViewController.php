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
                'storage_path' => $screenshot->storage_path,
                'captured_at' => $screenshot->captured_at->toIso8601String(),
            ]);

        return response()->json(['data' => $screenshots]);
    }
}
