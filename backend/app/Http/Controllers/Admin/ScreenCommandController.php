<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\DeviceCommand;
use App\Models\Screen;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class ScreenCommandController extends Controller
{
    /**
     * Store a new command for a screen (Modo Testigo).
     *
     * Supports two command types:
     * - speed_override: accelerate playback by a factor (1, 2, or 4)
     * - preview_content: display specific content on the screen
     */
    public function store(Request $request, string $screenId): JsonResponse
    {
        if (!Str::isUuid($screenId)) {
            return response()->json(['message' => 'Screen not found.'], 404);
        }

        $screen = Screen::find($screenId);

        if (!$screen) {
            return response()->json(['message' => 'Screen not found.'], 404);
        }

        // Base validation: type is required and must be one of the allowed values
        $request->validate([
            'type' => ['required', 'string', 'in:speed_override,preview_content'],
        ]);

        $type = $request->input('type');
        $payload = [];

        if ($type === 'speed_override') {
            $validated = $request->validate([
                'factor' => ['required', 'integer', 'in:1,2,4'],
                'expires_at' => ['sometimes', 'nullable', 'date'],
            ]);

            $payload = [
                'factor' => (int) $validated['factor'],
                'expires_at' => isset($validated['expires_at']) && $validated['expires_at']
                    ? Carbon::parse($validated['expires_at'])->toIso8601String()
                    : Carbon::now()->addMinutes(10)->toIso8601String(),
            ];
        } elseif ($type === 'preview_content') {
            $validated = $request->validate([
                'content_id' => ['required', 'string'],
                'asset_url' => ['required', 'string'],
                'duration_seconds' => ['sometimes', 'nullable', 'integer', 'min:1'],
            ]);

            $payload = [
                'content_id' => $validated['content_id'],
                'asset_url' => $validated['asset_url'],
            ];

            if (isset($validated['duration_seconds']) && $validated['duration_seconds']) {
                $payload['duration_seconds'] = (int) $validated['duration_seconds'];
            }
        }

        $command = DeviceCommand::create([
            'screen_id' => $screen->id,
            'type' => $type,
            'payload' => $payload,
            'status' => 'pending',
        ]);

        return response()->json(['data' => $command], 201);
    }
}
