<?php

namespace App\Observers;

use App\Jobs\RecalculateManifestJob;
use App\Models\Order;
use App\Services\AuditServiceInterface;
use App\Services\DateContainmentValidator;

class OrderObserver
{
    /**
     * Fields that trigger specific audit event types when changed.
     */
    private const AUDIT_FIELD_EVENTS = [
        'status' => 'status_changed',
        'name' => 'name_changed',
    ];

    public function __construct(
        private DateContainmentValidator $validator,
        private AuditServiceInterface $auditService,
    ) {}

    public function created(Order $order): void
    {
        $this->auditService->log($order, 'created');
    }

    public function updating(Order $order): void
    {
        // starts_at and ends_at are now computed from order_lines,
        // so no date shrink validation is needed on the Order itself.
    }

    public function updated(Order $order): void
    {
        if ($order->wasChanged('status')) {
            $this->dispatchForAllOrderScreens($order);
        }

        $this->auditFieldChanges($order);
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
            RecalculateManifestJob::dispatch($screenId, true)->afterCommit();
        });
    }

    /**
     * Audit field changes on the Order model.
     * Maps specific fields to their dedicated event types, and logs generic
     * field_modified for other changed fields.
     */
    private function auditFieldChanges(Order $order): void
    {
        $changes = $order->getChanges();

        // Exclude timestamp fields from auditing
        $excludedFields = ['created_at', 'updated_at'];

        foreach ($changes as $field => $newValue) {
            if (in_array($field, $excludedFields, true)) {
                continue;
            }

            $oldValue = $order->getOriginal($field);
            $eventType = self::AUDIT_FIELD_EVENTS[$field] ?? 'field_modified';

            $this->auditService->log($order, $eventType, [
                'field' => $field,
                'old_value' => $oldValue,
                'new_value' => $newValue,
            ]);
        }
    }
}
