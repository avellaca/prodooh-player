<?php

namespace App\Observers;

use App\Models\Creative;
use App\Models\OrderLineTarget;
use App\Services\AuditServiceInterface;
use App\Services\DateContainmentValidator;
use App\Services\LoopTemplateGeneratorInterface;

class CreativeObserver
{
    /**
     * Fields that, when changed, require loop template regeneration.
     */
    private const RECALCULATE_FIELDS = ['content_id', 'weight'];

    public function __construct(
        private DateContainmentValidator $validator,
        private AuditServiceInterface $auditService,
        private LoopTemplateGeneratorInterface $loopTemplateGenerator,
    ) {}

    public function creating(Creative $creative): void
    {
        //
    }

    public function created(Creative $creative): void
    {
        $this->auditCreativeAdded($creative);
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

        $this->auditFieldChanges($creative);
    }

    public function deleting(Creative $creative): void
    {
        $this->auditCreativeRemoved($creative);
        $this->dispatchForTargetScreens($creative);
    }

    /**
     * Dispatch loop template regeneration for all screens targeted by the parent order line.
     * Uses LoopTemplateGenerator.regenerateAffected() which dispatches batch queue jobs
     * ensuring regeneration completes within 30 seconds.
     */
    private function dispatchForTargetScreens(Creative $creative): void
    {
        $orderLine = $creative->orderLine;

        if (!$orderLine) {
            return;
        }

        $screenIds = $orderLine->resolveTargetScreens()->pluck('id')->all();

        if (!empty($screenIds)) {
            $this->loopTemplateGenerator->regenerateAffected($screenIds);
        }
    }

    /**
     * Log creative_added audit event on the parent OrderLine.
     */
    private function auditCreativeAdded(Creative $creative): void
    {
        $orderLine = $this->resolveOrderLine($creative);

        if ($orderLine) {
            $this->auditService->log($orderLine, 'creative_added', [
                'field' => 'creative_id',
                'old_value' => null,
                'new_value' => $creative->getKey(),
            ]);
        }
    }

    /**
     * Log creative_removed audit event on the parent OrderLine.
     */
    private function auditCreativeRemoved(Creative $creative): void
    {
        $orderLine = $this->resolveOrderLine($creative);

        if ($orderLine) {
            $this->auditService->log($orderLine, 'creative_removed', [
                'field' => 'creative_id',
                'old_value' => $creative->getKey(),
                'new_value' => null,
            ]);
        }
    }

    /**
     * Audit field changes on the Creative model.
     */
    private function auditFieldChanges(Creative $creative): void
    {
        $changes = $creative->getChanges();

        // Exclude timestamp fields from auditing
        $excludedFields = ['created_at', 'updated_at'];

        foreach ($changes as $field => $newValue) {
            if (in_array($field, $excludedFields, true)) {
                continue;
            }

            $oldValue = $creative->getOriginal($field);

            $this->auditService->log($creative, 'field_modified', [
                'field' => $field,
                'old_value' => $oldValue,
                'new_value' => $newValue,
            ]);
        }
    }

    /**
     * Resolve the parent OrderLine for a creative (via OrderLineTarget).
     */
    private function resolveOrderLine(Creative $creative): ?\App\Models\OrderLine
    {
        if ($creative->relationLoaded('orderLineTarget') && $creative->orderLineTarget) {
            return $creative->orderLineTarget->orderLine;
        }

        $target = OrderLineTarget::find($creative->order_line_target_id);

        if (!$target) {
            return null;
        }

        return $target->orderLine;
    }
}
