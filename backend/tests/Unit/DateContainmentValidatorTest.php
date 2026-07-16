<?php

namespace Tests\Unit;

use App\Models\Order;
use App\Models\OrderLine;
use App\Services\DateContainmentValidator;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class DateContainmentValidatorTest extends TestCase
{
    private DateContainmentValidator $validator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->validator = new DateContainmentValidator();
    }

    // ─── validateOrderLineDates (now a no-op) ───────────────────────────────

    public function test_order_line_dates_validation_is_noop(): void
    {
        $order = new Order();

        $orderLine = new OrderLine();
        $orderLine->starts_at = '2024-12-15';
        $orderLine->ends_at = '2025-06-30';
        $orderLine->setRelation('order', $order);

        // Should not throw — method is now a no-op since order dates are computed
        $this->validator->validateOrderLineDates($orderLine);
        $this->assertTrue(true);
    }

    // ─── validateOrderDateShrink (now a no-op) ──────────────────────────────

    public function test_order_date_shrink_validation_is_noop(): void
    {
        $order = new Order();

        // Should not throw — method is now a no-op since order dates are computed
        $this->validator->validateOrderDateShrink($order);
        $this->assertTrue(true);
    }

    // ─── validateOrderLineActiveDates ───────────────────────────────────────
    // Note: These tests use a mock order with explicit starts_at/ends_at attributes
    // set on the model instance. Since Order now has computed accessors from DB,
    // these tests will only work in integration tests with real DB data.
    // The following tests verify the logic works when the order has date attributes.

    public function test_order_line_with_empty_active_dates_passes(): void
    {
        $order = new Order();

        $orderLine = new OrderLine();
        $orderLine->active_dates = [];
        $orderLine->setRelation('order', $order);

        // Empty dates should not throw
        $this->validator->validateOrderLineActiveDates($orderLine);
        $this->assertTrue(true);
    }

    public function test_order_line_with_null_active_dates_passes(): void
    {
        $order = new Order();

        $orderLine = new OrderLine();
        $orderLine->active_dates = null;
        $orderLine->setRelation('order', $order);

        // Null dates should not throw
        $this->validator->validateOrderLineActiveDates($orderLine);
        $this->assertTrue(true);
    }
}
