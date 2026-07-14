<?php

namespace App\Observers;

use App\Jobs\RecalculateManifestJob;
use App\Models\OrderLineTarget;
use App\Models\Screen;

class OrderLineTargetObserver
{
    public function created(OrderLineTarget $target): void
    {
        $this->dispatchForTargetScreens($target);
    }

    public function deleting(OrderLineTarget $target): void
    {
        $this->dispatchForTargetScreens($target);
    }

    /**
     * Dispatch intra-day recalculation for the screen(s) associated with this target.
     */
    private function dispatchForTargetScreens(OrderLineTarget $target): void
    {
        $screenIds = collect();

        if ($target->screen_id) {
            $screenIds->push($target->screen_id);
        } elseif ($target->screen_group_id) {
            $groupScreenIds = Screen::where('group_id', $target->screen_group_id)->pluck('id');
            $screenIds = $screenIds->merge($groupScreenIds);
        }

        $screenIds->unique()->each(function ($screenId) {
            RecalculateManifestJob::dispatch($screenId, true)->afterCommit();
        });
    }
}
