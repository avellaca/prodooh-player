<?php

namespace App\Observers;

use App\Jobs\RecalculateManifestJob;
use App\Models\OrderLine;
use App\Services\DateContainmentValidator;

class OrderLineObserver
{
    /**
     * Fields that, when changed, require a manifest recalculation.
     */
    private const RECALCULATE_FIELDS = ['status', 'starts_at', 'ends_at', 'target_spots'];

    public function __construct(private DateContainmentValidator $validator) {}

    public function creating(OrderLine $orderLine): void
    {
        $this->validator->validateOrderLineDates($orderLine);
    }

    public function created(OrderLine $orderLine): void
    {
        $this->dispatchForTargetScreens($orderLine);
    }

    public function updating(OrderLine $orderLine): void
    {
        if ($orderLine->isDirty(['starts_at', 'ends_at'])) {
            $this->validator->validateOrderLineDates($orderLine);
        }
    }

    public function updated(OrderLine $orderLine): void
    {
        if ($orderLine->wasChanged(self::RECALCULATE_FIELDS)) {
            $this->dispatchForTargetScreens($orderLine);
        }
    }

    public function deleting(OrderLine $orderLine): void
    {
        $this->dispatchForTargetScreens($orderLine);
    }

    /**
     * Dispatch intra-day recalculation for all screens targeted by this line.
     */
    private function dispatchForTargetScreens(OrderLine $orderLine): void
    {
        $screens = $orderLine->resolveTargetScreens();

        foreach ($screens as $screen) {
            RecalculateManifestJob::dispatch($screen->id, true);
        }
    }
}
