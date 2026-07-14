<?php

namespace Tests\Unit;

use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Observers\CreativeObserver;
use App\Observers\OrderLineObserver;
use App\Observers\OrderObserver;
use App\Services\DateContainmentValidator;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class DateContainmentObserverTest extends TestCase
{
    // ─── 13.5: OrderLine with dates outside Order range → ValidationException ──

    public function test_creating_order_line_with_dates_outside_order_range_throws_validation_exception(): void
    {
        $order = new Order();
        $order->starts_at = '2025-01-01';
        $order->ends_at = '2025-06-30';

        $orderLine = new OrderLine();
        $orderLine->order_id = fake()->uuid();
        $orderLine->name = 'Test Line';
        $orderLine->priority_tier = 'estandar';
        $orderLine->starts_at = '2024-12-01'; // Before order starts
        $orderLine->ends_at = '2025-03-31';
        $orderLine->setRelation('order', $order);

        $this->expectException(ValidationException::class);

        $observer = new OrderLineObserver(new DateContainmentValidator());
        $observer->creating($orderLine);
    }

    public function test_creating_order_line_with_end_date_after_order_throws_validation_exception(): void
    {
        $order = new Order();
        $order->starts_at = '2025-01-01';
        $order->ends_at = '2025-06-30';

        $orderLine = new OrderLine();
        $orderLine->order_id = fake()->uuid();
        $orderLine->name = 'Test Line';
        $orderLine->priority_tier = 'estandar';
        $orderLine->starts_at = '2025-03-01';
        $orderLine->ends_at = '2025-09-30'; // After order ends
        $orderLine->setRelation('order', $order);

        $this->expectException(ValidationException::class);

        $observer = new OrderLineObserver(new DateContainmentValidator());
        $observer->creating($orderLine);
    }

    public function test_creating_order_line_within_order_range_passes(): void
    {
        $order = new Order();
        $order->starts_at = '2025-01-01';
        $order->ends_at = '2025-12-31';

        $orderLine = new OrderLine();
        $orderLine->order_id = fake()->uuid();
        $orderLine->name = 'Test Line';
        $orderLine->priority_tier = 'estandar';
        $orderLine->starts_at = '2025-03-01';
        $orderLine->ends_at = '2025-06-30';
        $orderLine->setRelation('order', $order);

        // Should not throw
        $observer = new OrderLineObserver(new DateContainmentValidator());
        $observer->creating($orderLine);
        $this->assertTrue(true);
    }

    public function test_updating_order_line_with_dirty_dates_outside_order_range_throws(): void
    {
        $order = new Order();
        $order->starts_at = '2025-01-01';
        $order->ends_at = '2025-06-30';

        $orderLine = new OrderLine();
        $orderLine->order_id = fake()->uuid();
        $orderLine->name = 'Test Line';
        $orderLine->priority_tier = 'estandar';
        $orderLine->starts_at = '2025-03-01';
        $orderLine->ends_at = '2025-06-30';
        $orderLine->setRelation('order', $order);

        // Sync original to make it appear "existing"
        $orderLine->syncOriginal();

        // Now change dates to be out of range
        $orderLine->ends_at = '2025-09-30';

        $this->expectException(ValidationException::class);

        $observer = new OrderLineObserver(new DateContainmentValidator());
        $observer->updating($orderLine);
    }

    public function test_updating_order_line_without_dirty_dates_skips_validation(): void
    {
        $order = new Order();
        $order->starts_at = '2025-01-01';
        $order->ends_at = '2025-06-30';

        $orderLine = new OrderLine();
        $orderLine->order_id = fake()->uuid();
        $orderLine->name = 'Test Line';
        $orderLine->priority_tier = 'estandar';
        $orderLine->starts_at = '2024-06-01'; // Would be invalid, but dates aren't dirty
        $orderLine->ends_at = '2025-03-30';
        $orderLine->setRelation('order', $order);

        // Sync original (dates aren't dirty)
        $orderLine->syncOriginal();

        // Change only name (not dates)
        $orderLine->name = 'Updated Name';

        // Should not throw - dates are not dirty
        $observer = new OrderLineObserver(new DateContainmentValidator());
        $observer->updating($orderLine);
        $this->assertTrue(true);
    }

    // ─── CreativeObserver no longer validates active_dates (moved to OrderLine level) ──

    public function test_creative_observer_creating_does_not_validate_active_dates(): void
    {
        $creative = new Creative();
        $creative->order_line_id = fake()->uuid();
        $creative->content_id = fake()->uuid();
        $creative->weight = 100;

        // Should not throw - CreativeObserver no longer validates active_dates
        $observer = new CreativeObserver(new DateContainmentValidator());
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
        $observer = new CreativeObserver(new DateContainmentValidator());
        $observer->updating($creative);
        $this->assertTrue(true);
    }

    // ─── 13.7: Shrink Order dates when children exist outside → ValidationException ──

    public function test_order_observer_updating_only_fires_when_dates_are_dirty(): void
    {
        $order = new Order();
        $order->name = 'Test Order';
        $order->starts_at = '2025-01-01';
        $order->ends_at = '2025-12-31';
        $order->status = 'draft';

        // Sync original
        $order->syncOriginal();

        // Change only name (not dates)
        $order->name = 'Updated Name';

        // Should not throw - dates are not dirty, so validation is skipped
        $observer = new OrderObserver(new DateContainmentValidator());
        $observer->updating($order);
        $this->assertTrue(true);
    }

    /**
     * This test verifies the observer correctly calls validateOrderDateShrink
     * when dates are dirty. The validateOrderDateShrink method queries the DB,
     * so for a pure unit test we verify the dirty check works.
     * A full integration test would require the database (RefreshDatabase).
     */
    public function test_order_observer_calls_validation_when_dates_dirty(): void
    {
        // We can't easily test the full DB query without RefreshDatabase,
        // but we can verify the observer dispatches to the validator.
        $validator = $this->createMock(DateContainmentValidator::class);
        $validator->expects($this->once())
            ->method('validateOrderDateShrink');

        $order = new Order();
        $order->name = 'Test Order';
        $order->starts_at = '2025-01-01';
        $order->ends_at = '2025-12-31';
        $order->status = 'draft';
        $order->syncOriginal();

        // Change dates
        $order->starts_at = '2025-02-01';

        $observer = new OrderObserver($validator);
        $observer->updating($order);
    }

    /**
     * Test that the OrderObserver calls validateOrderDateShrink which would
     * throw ValidationException when order lines exist outside the new range.
     * This simulates the validator throwing.
     */
    public function test_order_date_shrink_with_orphaned_children_throws_validation_exception(): void
    {
        $validator = $this->createMock(DateContainmentValidator::class);
        $validator->expects($this->once())
            ->method('validateOrderDateShrink')
            ->willThrowException(
                ValidationException::withMessages([
                    'starts_at' => 'Cannot shrink order date range: some order lines have dates outside the new range.',
                ])
            );

        $order = new Order();
        $order->name = 'Test Order';
        $order->starts_at = '2025-01-01';
        $order->ends_at = '2025-12-31';
        $order->status = 'draft';
        $order->syncOriginal();

        // Shrink dates
        $order->starts_at = '2025-03-01';
        $order->ends_at = '2025-09-30';

        $this->expectException(ValidationException::class);

        $observer = new OrderObserver($validator);
        $observer->updating($order);
    }
}
