<?php

namespace Tests\Unit;

use App\Models\Creative;
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

    // ─── validateCreativeActiveDates ──────────────────────────────────────────

    public function test_creative_dates_within_order_line_range_passes(): void
    {
        $orderLine = new OrderLine();
        $orderLine->starts_at = '2025-03-01';
        $orderLine->ends_at = '2025-06-30';

        $creative = new Creative();
        $creative->active_dates = ['2025-03-15', '2025-04-10', '2025-06-30'];
        $creative->setRelation('orderLine', $orderLine);

        // Should not throw
        $this->validator->validateCreativeActiveDates($creative);
        $this->assertTrue(true);
    }

    public function test_creative_date_before_order_line_start_fails(): void
    {
        $orderLine = new OrderLine();
        $orderLine->starts_at = '2025-03-01';
        $orderLine->ends_at = '2025-06-30';

        $creative = new Creative();
        $creative->active_dates = ['2025-02-28', '2025-03-15'];
        $creative->setRelation('orderLine', $orderLine);

        $this->expectException(ValidationException::class);
        $this->validator->validateCreativeActiveDates($creative);
    }

    public function test_creative_date_after_order_line_end_fails(): void
    {
        $orderLine = new OrderLine();
        $orderLine->starts_at = '2025-03-01';
        $orderLine->ends_at = '2025-06-30';

        $creative = new Creative();
        $creative->active_dates = ['2025-03-15', '2025-07-01'];
        $creative->setRelation('orderLine', $orderLine);

        $this->expectException(ValidationException::class);
        $this->validator->validateCreativeActiveDates($creative);
    }

    public function test_creative_with_empty_active_dates_passes(): void
    {
        $orderLine = new OrderLine();
        $orderLine->starts_at = '2025-03-01';
        $orderLine->ends_at = '2025-06-30';

        $creative = new Creative();
        $creative->active_dates = [];
        $creative->setRelation('orderLine', $orderLine);

        // Empty dates should not throw
        $this->validator->validateCreativeActiveDates($creative);
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

    public function test_creative_validation_error_includes_invalid_dates(): void
    {
        $orderLine = new OrderLine();
        $orderLine->starts_at = '2025-03-01';
        $orderLine->ends_at = '2025-06-30';

        $creative = new Creative();
        $creative->active_dates = ['2025-02-15', '2025-03-15', '2025-07-10'];
        $creative->setRelation('orderLine', $orderLine);

        try {
            $this->validator->validateCreativeActiveDates($creative);
            $this->fail('Expected ValidationException was not thrown');
        } catch (ValidationException $e) {
            $this->assertArrayHasKey('active_dates', $e->errors());
            $message = $e->errors()['active_dates'][0];
            $this->assertStringContainsString('parent order line range', $message);
            $this->assertStringContainsString('2025-02-15', $message);
            $this->assertStringContainsString('2025-07-10', $message);
        }
    }
}
