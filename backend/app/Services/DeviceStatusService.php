<?php

namespace App\Services;

use App\Models\Screen;
use Carbon\Carbon;

class DeviceStatusService
{
    /**
     * Number of seconds after which a screen is considered to have missed a heartbeat.
     */
    public const HEARTBEAT_THRESHOLD = 60;

    /**
     * Additional grace period (seconds) before marking a screen as unresponsive.
     * This avoids false positives from transient network interruptions.
     */
    public const GRACE_PERIOD = 60;

    /**
     * Check status for a single screen based on its last heartbeat.
     *
     * Status transitions:
     * - If last_heartbeat is null → remain in current status (offline by default)
     * - If last_heartbeat is within threshold + grace period → no change
     * - If last_heartbeat exceeds threshold + grace period → mark as 'unresponsive'
     */
    public function checkStatus(Screen $screen): Screen
    {
        // If no heartbeat has ever been received, leave status as-is (e.g., offline)
        if ($screen->last_heartbeat === null) {
            return $screen;
        }

        $deadline = Carbon::now()->subSeconds(self::HEARTBEAT_THRESHOLD + self::GRACE_PERIOD);

        if ($screen->last_heartbeat->lt($deadline)) {
            $screen->update(['status' => 'unresponsive']);
        }

        return $screen->refresh();
    }

    /**
     * Batch check all screens that are currently 'online' and evaluate
     * whether they should be marked as 'unresponsive'.
     *
     * Returns the number of screens that were marked unresponsive.
     */
    public function evaluateAllScreens(): int
    {
        $deadline = Carbon::now()->subSeconds(self::HEARTBEAT_THRESHOLD + self::GRACE_PERIOD);

        return Screen::where('status', 'online')
            ->where('last_heartbeat', '<', $deadline)
            ->update(['status' => 'unresponsive']);
    }
}
