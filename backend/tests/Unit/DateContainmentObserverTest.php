<?php

namespace Tests\Unit;

use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Observers\CreativeObserver;
use App\Observers\OrderLineObserver;
use App\Observers\OrderObserver;
use App\Services\AuditServiceInterface;
use App\Services\DateContainmentValidator;
use App\Services\LoopTemplateGeneratorInterface;
use Tests\TestCase;

class DateContainmentObserverTest extends TestCase
{
    private function makeOrderLineObserver(): OrderLineObserver
    {
        $generator = $this->createMock(LoopTemplateGeneratorInterface::class);
        $auditService = $this->createMock(AuditServiceInterface::class);
        return new OrderLineObserver(new DateContainmentValidator(), $generator, $auditService);
    }

    private function makeCreativeObserver(): CreativeObserver
    {
        $generator = $this->createMock(LoopTemplateGeneratorInterface::class);
        $auditService = $this->createMock(AuditServiceInterface::class);
        return new CreativeObserver(new DateContainmentValidator(), $auditService, $generator);
    }

    // ─── OrderLine date validation is now a no-op (order dates computed from lines) ──

    public function test_creating_order_line_with_any_dates_passes(): void
    {
        $order = new Order();

        $orderLine = new OrderLine();
        $orderLine->order_id = fake()->uuid();
        $orderLine->name = 'Test Line';
        $orderLine->priority_tier = 'estandar';
        $orderLine->starts_at = '2024-12-01';
        $orderLine->ends_at = '2025-03-31';
        $orderLine->setRelation('order', $order);

        // Should not throw — validateOrderLineDates is now a no-op
        $observer = $this->makeOrderLineObserver();
        $observer->creating($orderLine);
        $this->assertTrue(true);
    }

    public function test_updating_order_line_without_dirty_dates_skips_validation(): void
    {
        $order = new Order();

        $orderLine = new OrderLine();
        $orderLine->order_id = fake()->uuid();
        $orderLine->name = 'Test Line';
        $orderLine->priority_tier = 'estandar';
        $orderLine->starts_at = '2025-03-01';
        $orderLine->ends_at = '2025-06-30';
        $orderLine->setRelation('order', $order);

        // Sync original (dates aren't dirty)
        $orderLine->syncOriginal();

        // Change only name (not dates)
        $orderLine->name = 'Updated Name';

        // Should not throw - dates are not dirty
        $observer = $this->makeOrderLineObserver();
        $observer->updating($orderLine);
        $this->assertTrue(true);
    }

    public function test_updating_order_line_with_dirty_dates_passes(): void
    {
        $order = new Order();

        $orderLine = new OrderLine();
        $orderLine->order_id = fake()->uuid();
        $orderLine->name = 'Test Line';
        $orderLine->priority_tier = 'estandar';
        $orderLine->starts_at = '2025-03-01';
        $orderLine->ends_at = '2025-06-30';
        $orderLine->setRelation('order', $order);

        // Sync original
        $orderLine->syncOriginal();

        // Change dates — previously would throw, now is no-op
        $orderLine->ends_at = '2025-09-30';

        $observer = $this->makeOrderLineObserver();
        $observer->updating($orderLine);
        $this->assertTrue(true);
    }

    // ─── CreativeObserver ──

    public function test_creative_observer_creating_does_not_validate_active_dates(): void
    {
        $creative = new Creative();
        $creative->order_line_id = fake()->uuid();
        $creative->content_id = fake()->uuid();
        $creative->weight = 100;

        // Should not throw - CreativeObserver no longer validates active_dates
        $observer = $this->makeCreativeObserver();
        $observer->creating($creative);
        $this->assertTrue(true);
    }

    public function test_creative_observer_updating_does_not_validate_active_dates(): void
    {
        $creative = new Creative();
        $creative->order_line_id = fake()->uuid();
        $creative->content_id = fake()->uuid();
        $creative->weight = 100;

        // Sync original
        $creative->syncOriginal();

        // Change weight
        $creative->weight = 50;

        // Should not throw - CreativeObserver no longer validates active_dates
        $observer = $this->makeCreativeObserver();
        $observer->updating($creative);
        $this->assertTrue(true);
    }

    // ─── OrderObserver: updating no longer validates date shrink ──

    public function test_order_observer_updating_is_noop_for_dates(): void
    {
        $order = new Order();
        $order->name = 'Test Order';
        $order->status = 'draft';

        // Sync original
        $order->syncOriginal();

        // Change name — observer should not throw
        $order->name = 'Updated Name';

        $auditService = $this->createMock(AuditServiceInterface::class);
        $observer = new OrderObserver(new DateContainmentValidator(), $auditService);
        $observer->updating($order);
        $this->assertTrue(true);
    }
}
