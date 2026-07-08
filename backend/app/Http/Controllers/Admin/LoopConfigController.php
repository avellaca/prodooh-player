<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\DeviceService;
use App\Services\LoopConfigService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LoopConfigController extends Controller
{
    public function __construct(
        private readonly LoopConfigService $loopConfigService,
        private readonly DeviceService $deviceService,
    ) {}

    /**
     * Update the loop configuration for a screen.
     *
     * PUT /api/admin/screens/{id}/loop
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $screen = $this->deviceService->show($id);

        $validated = $request->validate([
            'slots' => ['required', 'array', 'min:1'],
            'slots.*.source' => ['required', 'string', 'in:prodooh,gam,url,playlist'],
            'slots.*.duration' => ['required', 'integer', 'min:1'],
        ]);

        $config = ['slots' => $validated['slots']];

        $updatedScreen = $this->loopConfigService->updateConfig($screen, $config);

        return response()->json(['data' => $updatedScreen]);
    }
}
