<?php

namespace App\Observers;

use App\Jobs\RecalculateManifestJob;
use App\Models\Order;
use App\Services\DateContainmentValidator;

class OrderObserver
{
    public function __construct(private DateContainmentValidator $validator) {}

    public function updating(Order $order): void
    {
        if ($order->isDirty(['starts_at', 'ends_at'])) {
            $this->validator->validateOrderDateShrink($order);
        }
    }

    public function updated(Order $order): void
    {
        if ($order->wasChanged('status')) {
            $this->dispatchForAllOrderScreens($order);
        }
    }

    /**
     * Dispatch intra-day recalculation for all screens targeted by all lines of this order.
     */
    private function dispatchForAllOrderScreens(Order $order): void
    {
        $screenIds = collect();

        $order->orderLines->each(function ($line) use ($screenIds) {
            $screens = $line->resolveTargetScreens();
            $screenIds->push(...$screens->pluck('id'));
        });

        $screenIds->unique()->each(function ($screenId) {
            RecalculateManifestJob::dispatch($screenId, true);
        });
    }
}
