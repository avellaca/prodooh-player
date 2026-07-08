<?php

namespace App\Http\Controllers\Device;

use App\Http\Controllers\Controller;
use App\Models\PlaybackLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class PlaybackLogController extends Controller
{
    /**
     * Receive batched playback log entries from the device.
     *
     * Each entry is validated and stored with screen_id and tenant_id
     * from the authenticated JWT claims.
     */
    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'logs' => 'required|array|min:1',
            'logs.*.id' => 'required|string',
            'logs.*.content_id' => 'required|string',
            'logs.*.source' => 'required|string|in:prodooh,gam,url,playlist',
            'logs.*.started_at' => 'required|date',
            'logs.*.ended_at' => 'required|date',
            'logs.*.duration_seconds' => 'required|numeric|min:0',
            'logs.*.result' => 'required|string|in:success,failed',
            'logs.*.failure_reason' => 'nullable|string',
        ]);

        $screenId = $request->attributes->get('screen_id');
        $tenantId = $request->attributes->get('tenant_id');
        $now = Carbon::now();

        $ackIds = [];

        foreach ($request->input('logs') as $logEntry) {
            PlaybackLog::create([
                'screen_id' => $screenId,
                'tenant_id' => $tenantId,
                'content_id' => $logEntry['content_id'],
                'source' => $logEntry['source'],
                'started_at' => Carbon::parse($logEntry['started_at']),
                'ended_at' => Carbon::parse($logEntry['ended_at']),
                'duration_seconds' => $logEntry['duration_seconds'],
                'result' => $logEntry['result'],
                'failure_reason' => $logEntry['failure_reason'] ?? null,
                'synced_at' => $now,
            ]);

            $ackIds[] = $logEntry['id'];
        }

        return response()->json([
            'received' => count($ackIds),
            'ack_ids' => $ackIds,
        ]);
    }
}
