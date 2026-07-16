<?php

namespace App\Observers;

use App\Jobs\RecalculateManifestJob;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Services\AuditServiceInterface;

class OrderLineTargetObserver
{
    public function __construct(
        private AuditServiceInterface $auditService,
    ) {}

    public function created(OrderLineTarget $target): void
    {
        $this->auditTargetAdded($target);
        $this->dispatchForTargetScreens($target);
    }

    public function deleting(OrderLineTarget $target): void
    {
        $this->auditTargetRemoved($target);
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

    /**
     * Log target_added audit event on the parent OrderLine.
     */
    private function auditTargetAdded(OrderLineTarget $target): void
    {
        $orderLine = $target->orderLine;

        if ($orderLine) {
            $targetDescription = $target->screen_id
                ? "screen:{$target->screen_id}"
                : "screen_group:{$target->screen_group_id}";

            $this->auditService->log($orderLine, 'target_added', [
                'field' => 'target',
                'old_value' => null,
                'new_value' => $targetDescription,
            ]);
        }
    }

    /**
     * Log target_removed audit event on the parent OrderLine.
     */
    private function auditTargetRemoved(OrderLineTarget $target): void
    {
        $orderLine = $target->orderLine;

        if ($orderLine) {
            $targetDescription = $target->screen_id
                ? "screen:{$target->screen_id}"
                : "screen_group:{$target->screen_group_id}";

            $this->auditService->log($orderLine, 'target_removed', [
                'field' => 'target',
                'old_value' => $targetDescription,
                'new_value' => null,
            ]);
        }
    }
}
