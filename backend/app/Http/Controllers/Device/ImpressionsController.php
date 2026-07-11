<?php

namespace App\Http\Controllers\Device;

use App\Http\Controllers\Controller;
use App\Models\Impression;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class ImpressionsController extends Controller
{
    /**
     * POST /api/device/impressions
     *
     * Receive a batch of impression reports from the device.
     */
    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'impressions' => 'required|array|min:1',
            'impressions.*.order_line_id' => 'required|uuid|exists:order_lines,id',
            'impressions.*.creative_id' => 'required|uuid|exists:creatives,id',
            'impressions.*.started_at' => 'required|date',
            'impressions.*.ended_at' => 'nullable|date',
            'impressions.*.duration_seconds' => 'required|numeric|min:0',
            'impressions.*.result' => 'required|in:success,failed',
            'impressions.*.failure_reason' => 'nullable|string',
        ]);

        $screenId = $request->attributes->get('screen_id');
        $impressions = $request->input('impressions');

        foreach ($impressions as $impression) {
            Impression::create([
                'screen_id' => $screenId,
                'order_line_id' => $impression['order_line_id'],
                'creative_id' => $impression['creative_id'],
                'source' => 'order_line',
                'started_at' => $impression['started_at'],
                'ended_at' => $impression['ended_at'] ?? null,
                'duration_seconds' => $impression['duration_seconds'],
                'result' => $impression['result'],
                'failure_reason' => $impression['failure_reason'] ?? null,
            ]);
        }

        Log::info('Impressions received', [
            'screen_id' => $screenId,
            'count' => count($impressions),
        ]);

        return response()->json(['ack' => true, 'count' => count($impressions)], 201);
    }
}
