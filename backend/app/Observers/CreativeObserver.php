<?php

namespace App\Observers;

use App\Jobs\RecalculateManifestJob;
use App\Models\Creative;
use App\Services\DateContainmentValidator;

class CreativeObserver
{
    /**
     * Fields that, when changed, require a manifest recalculation.
     */
    private const RECALCULATE_FIELDS = ['content_id', 'weight'];

    public function __construct(private DateContainmentValidator $validator) {}

    public function creating(Creative $creative): void
    {
        //
    }

    public function created(Creative $creative): void
    {
        $this->dispatchForTargetScreens($creative);
    }

    public function updating(Creative $creative): void
    {
        //
    }

    public function updated(Creative $creative): void
    {
        if ($creative->wasChanged(self::RECALCULATE_FIELDS)) {
            $this->dispatchForTargetScreens($creative);
        }
    }

    public function deleting(Creative $creative): void
    {
        $this->dispatchForTargetScreens($creative);
    }

    /**
     * Dispatch intra-day recalculation for all screens targeted by the parent order line.
     */
    private function dispatchForTargetScreens(Creative $creative): void
    {
        $orderLine = $creative->orderLine;

        if (!$orderLine) {
            return;
        }

        $screens = $orderLine->resolveTargetScreens();

        foreach ($screens as $screen) {
            RecalculateManifestJob::dispatch($screen->id, true)->afterCommit();
        }
    }
}
