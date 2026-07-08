<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\PlaybackAnalyticsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PlaybackAnalyticsController extends Controller
{
    public function __construct(
        private readonly PlaybackAnalyticsService $analyticsService,
    ) {}

    /**
     * GET /api/admin/analytics/playback
     *
     * Returns aggregated playback analytics with optional filters.
     * Tenant isolation is enforced via the BelongsToTenant global scope.
     */
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'date_from' => ['sometimes', 'nullable', 'date'],
            'date_to' => ['sometimes', 'nullable', 'date'],
            'screen_id' => ['sometimes', 'nullable', 'string'],
            'source' => ['sometimes', 'nullable', 'string', 'in:prodooh,gam,url,playlist'],
            'content_id' => ['sometimes', 'nullable', 'string'],
        ]);

        $data = $this->analyticsService->query($validated);

        return response()->json(['data' => $data]);
    }
}
