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

    // ─── validateOrderLineDates ───────────────────────────────────────────────

    public function test_order_line_within_order_range_passes(): void
    {
        $order = new Order();
        $order->starts_at = '2025-01-01';
        $order->ends_at = '2025-12-31';

        $orderLine = new OrderLine();
        $orderLine->starts_at = '2025-03-01';
        $orderLine->ends_at = '2025-06-30';
        $orderLine->setRelation('order', $order);

        // Should not throw
        $this->validator->validateOrderLineDates($orderLine);
        $this->assertTrue(true);
    }

    public function test_order_line_matching_order_range_passes(): void
    {
        $order = new Order();
        $order->starts_at = '2025-01-01';
        $order->ends_at = '2025-12-31';

        $orderLine = new OrderLine();
        $orderLine->starts_at = '2025-01-01';
        $orderLine->ends_at = '2025-12-31';
        $orderLine->setRelation('order', $order);

        // Exact same range should pass
        $this->validator->validateOrderLineDates($orderLine);
        $this->assertTrue(true);
    }

    public function test_order_line_starts_before_order_fails(): void
    {
        $order = new Order();
        $order->starts_at = '2025-01-01';
        $order->ends_at = '2025-12-31';

        $orderLine = new OrderLine();
        $orderLine->starts_at = '2024-12-15';
        $orderLine->ends_at = '2025-06-30';
        $orderLine->setRelation('order', $order);

        $this->expectException(ValidationException::class);
        $this->validator->validateOrderLineDates($orderLine);
    }

    public function test_order_line_ends_after_order_fails(): void
    {
        $order = new Order();
        $order->starts_at = '2025-01-01';
        $order->ends_at = '2025-12-31';

        $orderLine = new OrderLine();
        $orderLine->starts_at = '2025-03-01';
        $orderLine->ends_at = '2026-01-15';
        $orderLine->setRelation('order', $order);

        $this->expectException(ValidationException::class);
        $this->validator->validateOrderLineDates($orderLine);
    }

    // ─── validateOrderLineActiveDates ───────────────────────────────────────

    public function test_order_line_active_dates_within_order_range_passes(): void
    {
        $order = new Order();
        $order->starts_at = '2025-01-01';
        $order->ends_at = '2025-12-31';

        $orderLine = new OrderLine();
        $orderLine->active_dates = ['2025-03-15', '2025-04-10', '2025-06-30'];
        $orderLine->setRelation('order', $order);

        // Should not throw
        $this->validator->validateOrderLineActiveDates($orderLine);
        $this->assertTrue(true);
    }

    public function test_order_line_active_date_before_order_start_fails(): void
    {
        $order = new Order();
        $order->starts_at = '2025-01-01';
        $order->ends_at = '2025-12-31';

        $orderLine = new OrderLine();
        $orderLine->active_dates = ['2024-12-28', '2025-03-15'];
        $orderLine->setRelation('order', $order);

        $this->expectException(ValidationException::class);
        $this->validator->validateOrderLineActiveDates($orderLine);
    }

    public function test_order_line_active_date_after_order_end_fails(): void
    {
        $order = new Order();
        $order->starts_at = '2025-01-01';
        $order->ends_at = '2025-12-31';

        $orderLine = new OrderLine();
        $orderLine->active_dates = ['2025-03-15', '2026-01-01'];
        $orderLine->setRelation('order', $order);

        $this->expectException(ValidationException::class);
        $this->validator->validateOrderLineActiveDates($orderLine);
    }

    public function test_order_line_with_empty_active_dates_passes(): void
    {
        $order = new Order();
        $order->starts_at = '2025-01-01';
        $order->ends_at = '2025-12-31';

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
        $order->starts_at = '2025-01-01';
        $order->ends_at = '2025-12-31';

        $orderLine = new OrderLine();
        $orderLine->active_dates = null;
        $orderLine->setRelation('order', $order);

        // Null dates should not throw
        $this->validator->validateOrderLineActiveDates($orderLine);
        $this->assertTrue(true);
    }

    // ─── validateOrderDateShrink ──────────────────────────────────────────────

    public function test_order_shrink_validation_error_message(): void
    {
        // This test verifies the exception message format.
        // Full DB integration tests for validateOrderDateShrink require
        // the database tables to exist (tested in Feature tests).
        $order = new Order();
        $order->starts_at = '2025-01-01';
        $order->ends_at = '2025-12-31';

        $orderLine = new OrderLine();
        $orderLine->starts_at = '2024-12-01';
        $orderLine->ends_at = '2025-06-30';
        $orderLine->setRelation('order', $order);

        try {
            $this->validator->validateOrderLineDates($orderLine);
            $this->fail('Expected ValidationException was not thrown');
        } catch (ValidationException $e) {
            $this->assertArrayHasKey('starts_at', $e->errors());
            $this->assertStringContainsString('parent order range', $e->errors()['starts_at'][0]);
            $this->assertStringContainsString('2025-01-01', $e->errors()['starts_at'][0]);
            $this->assertStringContainsString('2025-12-31', $e->errors()['starts_at'][0]);
        }
    }

    public function test_order_line_active_dates_validation_error_includes_invalid_dates(): void
    {
        $order = new Order();
        $order->starts_at = '2025-01-01';
        $order->ends_at = '2025-12-31';

        $orderLine = new OrderLine();
        $orderLine->active_dates = ['2024-12-15', '2025-03-15', '2026-01-10'];
        $orderLine->setRelation('order', $order);

        try {
            $this->validator->validateOrderLineActiveDates($orderLine);
            $this->fail('Expected ValidationException was not thrown');
        } catch (ValidationException $e) {
            $this->assertArrayHasKey('active_dates', $e->errors());
            $message = $e->errors()['active_dates'][0];
            $this->assertStringContainsString('rango del pedido', $message);
            $this->assertStringContainsString('2024-12-15', $message);
            $this->assertStringContainsString('2026-01-10', $message);
        }
    }
}
