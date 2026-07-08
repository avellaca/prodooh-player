<?php

namespace App\Http\Controllers\Device;

use App\Http\Controllers\Controller;
use App\Models\DeviceCommand;
use App\Models\Screen;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class HeartbeatController extends Controller
{
    /**
     * Handle device heartbeat.
     *
     * Updates screen status and last_heartbeat, stores storage info,
     * and returns any pending device commands.
     */
    public function __invoke(Request $request): JsonResponse
    {
        $request->validate([
            'venue_id' => 'required|string',
            'timestamp' => 'required|date',
            'current_content' => 'nullable|array',
            'current_content.id' => 'required_with:current_content|string',
            'current_content.source' => 'required_with:current_content|string|in:prodooh,gam,url,playlist',
            'storage' => 'required|array',
            'storage.total_mb' => 'required|integer|min:0',
            'storage.available_mb' => 'required|integer|min:0',
            'storage.percent_used' => 'required|integer|min:0|max:100',
            'uptime_seconds' => 'required|integer|min:0',
            'playlist_version' => 'required|string',
        ]);

        $screenId = $request->attributes->get('screen_id');

        $screen = Screen::find($screenId);

        if (!$screen) {
            return response()->json([
                'error' => 'Screen not found',
                'message' => 'The authenticated screen could not be found.',
            ], 404);
        }

        // Update screen heartbeat data
        $screen->update([
            'last_heartbeat' => Carbon::now(),
            'status' => 'online',
            'last_storage_status' => $request->input('storage'),
            'playlist_version' => $request->input('playlist_version'),
        ]);

        // Fetch pending commands and mark them as delivered
        $pendingCommands = DeviceCommand::where('screen_id', $screenId)
            ->where('status', 'pending')
            ->get();

        if ($pendingCommands->isNotEmpty()) {
            DeviceCommand::where('screen_id', $screenId)
                ->where('status', 'pending')
                ->update([
                    'status' => 'delivered',
                    'delivered_at' => Carbon::now(),
                ]);
        }

        return response()->json([
            'ack' => true,
            'pending_commands' => $pendingCommands->map(function (DeviceCommand $command) {
                return [
                    'id' => $command->id,
                    'type' => $command->type,
                    'payload' => $command->payload,
                ];
            })->values()->toArray(),
        ]);
    }
}
