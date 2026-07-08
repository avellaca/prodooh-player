<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\DeviceService;
use App\Services\SourceToggleService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use InvalidArgumentException;

class SourceToggleController extends Controller
{
    public function __construct(
        private readonly SourceToggleService $sourceToggleService,
        private readonly DeviceService $deviceService,
    ) {}

    /**
     * Toggle sources for a screen.
     *
     * Accepts either:
     *   { "source": "gam", "enabled": false }
     * or:
     *   { "sources": { "gam": { "enabled": false }, "prodooh": { "enabled": true } } }
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $screen = $this->deviceService->show($id);

        // Determine which format the request uses
        if ($request->has('sources')) {
            $validated = $request->validate([
                'sources' => ['required', 'array'],
                'sources.*.enabled' => ['required', 'boolean'],
            ]);

            try {
                $screen = $this->sourceToggleService->toggleMultiple($screen, $validated['sources']);
            } catch (InvalidArgumentException $e) {
                return response()->json(['message' => $e->getMessage()], 422);
            }
        } else {
            $validated = $request->validate([
                'source' => ['required', 'string'],
                'enabled' => ['required', 'boolean'],
            ]);

            try {
                $screen = $this->sourceToggleService->toggle(
                    $screen,
                    $validated['source'],
                    $validated['enabled']
                );
            } catch (InvalidArgumentException $e) {
                return response()->json(['message' => $e->getMessage()], 422);
            }
        }

        // Return the updated screen with effective loop config
        $effectiveLoop = $this->sourceToggleService->getEffectiveLoopConfig($screen);

        return response()->json([
            'data' => $screen,
            'effective_loop_config' => $effectiveLoop,
        ]);
    }
}
