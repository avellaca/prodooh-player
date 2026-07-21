<?php

namespace App\Services;

use App\Models\OrderLineTarget;

class PlaybackModeResolver
{
    /**
     * Resolve the effective playback mode for a given target.
     *
     * Priority: target override → order line setting → default 'round_robin'
     */
    public static function resolve(OrderLineTarget $target): string
    {
        if ($target->playback_mode_override !== null) {
            return $target->playback_mode_override;
        }

        return $target->orderLine->playback_mode ?? 'round_robin';
    }
}
