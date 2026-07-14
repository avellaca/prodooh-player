<?php

namespace Tests\Property;

use App\Models\Order;
use App\Models\OrderLine;
use App\Models\Tenant;
use App\Services\DateContainmentValidator;
use Carbon\Carbon;
use Eris\Generators;
use Eris\TestTrait;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

/**
 * Property 1: Date containment validation
 *
 * For any OrderLine with active_dates, validateOrderLineActiveDates SHALL pass
 * if and only if ALL dates fall within the parent Order's [starts_at, ends_at] range.
 *
 * **Validates: Requirements 1.3, 1.4, 5.3**
 */
class DateContainmentPropertyTest extends TestCase
{
    use RefreshDatabase, TestTrait;

    /**
     * Prevent seeding — Eris TestTrait's $seed property (random seed integer)
     * conflicts with Laravel's shouldSeed() which checks property_exists($this, 'seed').
     */
    protected function shouldSeed(): bool
    {
        return false;
    }

    /**
     * Property 1: Date containment validation — all dates within Order range → passes
     *
     * For any OrderLine with a non-empty active_dates array where ALL dates fall within
     * the parent Order's [starts_at, ends_at] range, validateOrderLineActiveDates SHALL pass.
     *
     * **Validates: Requirements 1.3, 1.4, 5.3**
     */
    public function test_property1_dates_within_order_range_passes_validation(): void
    {
        // Order range: 2025-03-01 to 2025-03-31 (31 days)
        $orderStartsAt = '2025-03-01';
        $orderEndsAt = '2025-03-31';
        $rangeDays = 30; // 0-indexed offsets: 0..30 gives 2025-03-01..2025-03-31

        $this->limitTo(5)->forAll(
            Generators::choose(1, 5),  // number of dates to generate
            Generators::choose(0, $rangeDays), // offset for date 1
            Generators::choose(0, $rangeDays), // offset for date 2
            Generators::choose(0, $rangeDays)  // offset for date 3
        )->then(function (int $numDates, int $offset1, int $offset2, int $offset3) use ($orderStartsAt, $orderEndsAt, $rangeDays): void {
            // Create Order and OrderLine without triggering observer validation
            $tenant = Tenant::factory()->create();
            $order = Order::factory()->create([
                'tenant_id' => $tenant->id,
                'starts_at' => $orderStartsAt,
                'ends_at' => $orderEndsAt,
            ]);

            // Generate dates ALL within Order range
            $baseDate = Carbon::parse($orderStartsAt);
            $offsets = [$offset1, $offset2, $offset3];
            $dates = [];
            for ($i = 0; $i < $numDates; $i++) {
                $dayOffset = $offsets[$i] ?? rand(0, $rangeDays);
                $dates[] = $baseDate->copy()->addDays($dayOffset)->toDateString();
            }
            $dates = array_values(array_unique($dates));
            if (empty($dates)) {
                $dates = [$orderStartsAt];
            }

            // Create OrderLine with valid active_dates (within Order range)
            $orderLine = OrderLine::factory()->create([
                'order_id' => $order->id,
                'starts_at' => $orderStartsAt,
                'ends_at' => $orderEndsAt,
                'active_dates' => $dates,
            ]);

            // Act: validate directly — should NOT throw
            $validator = app(DateContainmentValidator::class);
            $threw = false;
            try {
                $validator->validateOrderLineActiveDates($orderLine);
            } catch (ValidationException $e) {
                $threw = true;
            }

            $this->assertFalse($threw, sprintf(
                'Property 1: Dates %s should PASS validation within Order range [%s, %s], but it threw.',
                json_encode($dates),
                $orderStartsAt,
                $orderEndsAt
            ));

            // Cleanup
            OrderLine::query()->delete();
            Order::query()->delete();
            Tenant::query()->delete();
        });
    }

    /**
     * Property 1: Date containment validation — at least one date outside Order range → fails
     *
     * For any OrderLine with a non-empty active_dates array where AT LEAST ONE date falls
     * outside the parent Order's [starts_at, ends_at] range, validateOrderLineActiveDates SHALL throw.
     *
     * **Validates: Requirements 1.3, 1.4, 5.3**
     */
    public function test_property1_dates_outside_order_range_fails_validation(): void
    {
        // Order range: 2025-03-01 to 2025-03-31
        $orderStartsAt = '2025-03-01';
        $orderEndsAt = '2025-03-31';
        $rangeDays = 30;

        $this->limitTo(5)->forAll(
            Generators::choose(0, 2),   // number of valid dates to include
            Generators::choose(1, 60),  // days outside range for invalid date
            Generators::elements('before', 'after') // direction of the invalid date
        )->then(function (int $validCount, int $daysOutside, string $direction) use ($orderStartsAt, $orderEndsAt, $rangeDays): void {
            // Create Order
            $tenant = Tenant::factory()->create();
            $order = Order::factory()->create([
                'tenant_id' => $tenant->id,
                'starts_at' => $orderStartsAt,
                'ends_at' => $orderEndsAt,
            ]);

            // Generate some valid dates within Order range
            $baseDate = Carbon::parse($orderStartsAt);
            $dates = [];
            for ($i = 0; $i < $validCount; $i++) {
                $dates[] = $baseDate->copy()->addDays(rand(0, $rangeDays))->toDateString();
            }

            // Add at least one invalid date outside Order range
            if ($direction === 'before') {
                $invalidDate = Carbon::parse($orderStartsAt)->subDays($daysOutside)->toDateString();
            } else {
                $invalidDate = Carbon::parse($orderEndsAt)->addDays($daysOutside)->toDateString();
            }
            $dates[] = $invalidDate;
            $dates = array_values(array_unique($dates));

            // Create OrderLine with withoutEvents to avoid observer triggering validation
            // (we want to test the validator directly, not the observer)
            $orderLine = OrderLine::withoutEvents(function () use ($order, $orderStartsAt, $orderEndsAt, $dates) {
                return OrderLine::factory()->create([
                    'order_id' => $order->id,
                    'starts_at' => $orderStartsAt,
                    'ends_at' => $orderEndsAt,
                    'active_dates' => $dates,
                ]);
            });

            // Act: validate directly — should throw ValidationException
            $validator = app(DateContainmentValidator::class);
            $threw = false;
            try {
                $validator->validateOrderLineActiveDates($orderLine);
            } catch (ValidationException $e) {
                $threw = true;
            }

            $this->assertTrue($threw, sprintf(
                'Property 1: Dates %s should FAIL validation (invalid: %s outside Order range [%s, %s]), but it passed.',
                json_encode($dates),
                $invalidDate,
                $orderStartsAt,
                $orderEndsAt
            ));

            // Cleanup
            OrderLine::query()->delete();
            Order::query()->delete();
            Tenant::query()->delete();
        });
    }
}
