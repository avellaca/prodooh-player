<?php

namespace App\Observers;

use App\Models\OrderLine;
use App\Models\Tenant;
use App\Services\AuditServiceInterface;
use App\Services\DateContainmentValidator;
use App\Services\LoopTemplateGeneratorInterface;

class OrderLineObserver
{
    /**
     * Default operating window in seconds (16 hours) when no schedule is configured.
     */
    private const DEFAULT_OPERATING_WINDOW_SECONDS = 57600;

    /**
     * Fields that, when changed, require loop template regeneration.
     */
    private const RECALCULATE_FIELDS = ['status', 'starts_at', 'ends_at', 'target_spots', 'active_dates'];

    /**
     * Fields that trigger specific audit event types when changed.
     */
    private const AUDIT_FIELD_EVENTS = [
        'status' => 'status_changed',
        'name' => 'name_changed',
        'target_spots' => 'spots_modified',
    ];

    public function __construct(
        private DateContainmentValidator $validator,
        private LoopTemplateGeneratorInterface $loopTemplateGenerator,
        private AuditServiceInterface $auditService,
    ) {}

    public function creating(OrderLine $orderLine): void
    {
        $this->enforcePaceByTier($orderLine);
        $this->calculateTargetSpotsBySlot($orderLine);
        $this->validator->validateOrderLineDates($orderLine);
        $this->validator->validateOrderLineActiveDates($orderLine);
    }

    public function created(OrderLine $orderLine): void
    {
        $this->auditService->log($orderLine, 'created');
        $this->dispatchForTargetScreens($orderLine);
    }

    public function updating(OrderLine $orderLine): void
    {
        $this->enforcePaceByTier($orderLine);
        $this->calculateTargetSpotsBySlot($orderLine);

        if ($orderLine->isDirty(['starts_at', 'ends_at'])) {
            $this->validator->validateOrderLineDates($orderLine);
        }
        if ($orderLine->isDirty('active_dates')) {
            $this->validator->validateOrderLineActiveDates($orderLine);
        }
    }

    public function updated(OrderLine $orderLine): void
    {
        if ($orderLine->wasChanged(self::RECALCULATE_FIELDS)) {
            $this->dispatchForTargetScreens($orderLine);
        }

        $this->auditFieldChanges($orderLine);
    }

    public function deleting(OrderLine $orderLine): void
    {
        $this->dispatchForTargetScreens($orderLine);
    }

    /**
     * Dispatch loop template regeneration for all screens targeted by this line.
     * Uses LoopTemplateGenerator.regenerateAffected() which dispatches batch queue jobs
     * ensuring regeneration completes within 30 seconds.
     */
    private function dispatchForTargetScreens(OrderLine $orderLine): void
    {
        $screenIds = $orderLine->resolveTargetScreens()->pluck('id')->all();

        if (!empty($screenIds)) {
            $this->loopTemplateGenerator->regenerateAffected($screenIds);
        }
    }

    /**
     * Force delivery_pace based on priority_tier:
     * - "patrocinio" and "red_interna" → always "uniform"
     * - "estandar" → allow "asap" or "uniform" (default to "uniform" if invalid)
     */
    private function enforcePaceByTier(OrderLine $orderLine): void
    {
        $tier = $orderLine->priority_tier;

        if (in_array($tier, ['patrocinio', 'red_interna'], true)) {
            $orderLine->delivery_pace = 'uniform';
        } elseif ($tier === 'estandar') {
            if (! in_array($orderLine->delivery_pace, ['asap', 'uniform'], true)) {
                $orderLine->delivery_pace = 'uniform';
            }
        }
    }

    /**
     * Calculate target_spots when by_slot=true and slots_purchased is set.
     *
     * Formula: target_spots = slots_purchased × loops_per_day
     * Where: loops_per_day = operating_window_seconds / (num_slots × slot_duration_seconds)
     *
     * The target_spots is fixed at creation/update time and does NOT recalculate
     * when num_slots changes later.
     */
    private function calculateTargetSpotsBySlot(OrderLine $orderLine): void
    {
        // Only calculate for patrocinio lines with by_slot enabled
        if ($orderLine->priority_tier !== 'patrocinio') {
            return;
        }

        if (! $orderLine->by_slot || ! $orderLine->slots_purchased) {
            return;
        }

        // Only recalculate if relevant fields changed (or on creation)
        if ($orderLine->exists && ! $orderLine->isDirty(['by_slot', 'slots_purchased'])) {
            return;
        }

        $tenant = $this->resolveTenant($orderLine);

        if (! $tenant) {
            return;
        }

        $loopsPerDay = $this->calculateLoopsPerDay($tenant);
        $orderLine->target_spots = $orderLine->slots_purchased * $loopsPerDay;
    }

    /**
     * Resolve the Tenant for an OrderLine via its parent Order.
     */
    private function resolveTenant(OrderLine $orderLine): ?Tenant
    {
        // If the order is already loaded, use it
        if ($orderLine->relationLoaded('order') && $orderLine->order) {
            return $orderLine->order->tenant ?? Tenant::find($orderLine->order->tenant_id);
        }

        // Load the order without global scopes to avoid tenant filtering issues during creation
        $order = \App\Models\Order::withoutGlobalScopes()->find($orderLine->order_id);

        if (! $order) {
            return null;
        }

        return Tenant::find($order->tenant_id);
    }

    /**
     * Calculate loops_per_day from tenant configuration.
     *
     * loops_per_day = operating_window_seconds / (num_slots × slot_duration_seconds)
     */
    private function calculateLoopsPerDay(Tenant $tenant): int
    {
        $numSlots = $tenant->num_slots ?? 10;
        $slotDurationSeconds = $tenant->default_duration_seconds ?? 10;
        $operatingWindowSeconds = $this->resolveOperatingWindowFromTenant($tenant);

        $loopDurationSeconds = $numSlots * $slotDurationSeconds;

        if ($loopDurationSeconds <= 0) {
            return 0;
        }

        return (int) floor($operatingWindowSeconds / $loopDurationSeconds);
    }

    /**
     * Resolve operating window seconds from tenant's default_schedule.
     * Uses a simplified calculation based on the first matching schedule rule.
     * Falls back to DEFAULT_OPERATING_WINDOW_SECONDS (16h = 57600s) when no schedule is set.
     */
    private function resolveOperatingWindowFromTenant(Tenant $tenant): int
    {
        $schedule = $tenant->default_schedule;

        if (empty($schedule)) {
            return self::DEFAULT_OPERATING_WINDOW_SECONDS;
        }

        // Calculate total operating seconds from all schedule rules for today
        $totalSeconds = 0;

        foreach ($schedule as $rule) {
            $startSeconds = $this->timeToSeconds($rule['start'] ?? '00:00');
            $endSeconds = $this->timeToSeconds($rule['end'] ?? '24:00');

            $windowSeconds = $endSeconds - $startSeconds;
            if ($windowSeconds > 0) {
                $totalSeconds += $windowSeconds;
            }
        }

        return $totalSeconds > 0 ? $totalSeconds : self::DEFAULT_OPERATING_WINDOW_SECONDS;
    }

    /**
     * Convert a time string (HH:MM) to seconds since midnight.
     */
    private function timeToSeconds(string $time): int
    {
        $parts = explode(':', $time);
        $hours = (int) ($parts[0] ?? 0);
        $minutes = (int) ($parts[1] ?? 0);

        return ($hours * 3600) + ($minutes * 60);
    }

    /**
     * Audit field changes on the OrderLine model.
     * Maps specific fields to their dedicated event types, and logs generic
     * field_modified for other changed fields.
     */
    private function auditFieldChanges(OrderLine $orderLine): void
    {
        $changes = $orderLine->getChanges();

        // Exclude timestamp fields from auditing
        $excludedFields = ['created_at', 'updated_at'];

        foreach ($changes as $field => $newValue) {
            if (in_array($field, $excludedFields, true)) {
                continue;
            }

            $oldValue = $orderLine->getOriginal($field);
            $eventType = self::AUDIT_FIELD_EVENTS[$field] ?? 'field_modified';

            $this->auditService->log($orderLine, $eventType, [
                'field' => $field,
                'old_value' => $oldValue,
                'new_value' => $newValue,
            ]);
        }
    }
}
