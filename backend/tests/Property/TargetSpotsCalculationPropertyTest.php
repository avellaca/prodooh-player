<?php

namespace Tests\Property;

use App\Models\Order;
use App\Models\OrderLine;
use App\Models\Tenant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Property-based test for target_spots calculation in OrderLineObserver.
 *
 * Uses randomized inputs (100 iterations) to verify Property 12:
 * For any OrderLine of Patrocinio with by_slot=true and slots_purchased=N,
 * target_spots must be exactly N × loops_per_day, where
 * loops_per_day = operating_window_seconds / (num_slots × slot_duration_seconds).
 *
 * **Validates: Requirements 4.3**
 */
class TargetSpotsCalculationPropertyTest extends TestCase
{
    use RefreshDatabase;

    /** Default operating window in seconds (16 hours) when no schedule is configured */
    private const DEFAULT_OPERATING_WINDOW_SECONDS = 57600;

    /**
     * Property 12: target_spots = N × loops_per_day
     *
     * For any valid combination of:
     * - num_slots ∈ [1, 100]
     * - slot_duration_seconds ∈ [5, 60]
     * - slots_purchased ∈ [1, num_slots]
     * - operating_window via schedule or default (57600s)
     *
     * The target_spots stored MUST equal exactly:
     * slots_purchased × floor(operating_window_seconds / (num_slots × slot_duration_seconds))
     *
     * **Validates: Requirements 4.3**
     */
    public function test_target_spots_equals_slots_purchased_times_loops_per_day_no_schedule(): void
    {
        for ($i = 0; $i < 100; $i++) {
            // Generate random valid inputs
            $numSlots = random_int(1, 100);
            $slotDuration = random_int(5, 60);
            $slotsPurchased = random_int(1, $numSlots);

            // No schedule → default operating window = 57600s
            $tenant = Tenant::factory()->create([
                'num_slots' => $numSlots,
                'default_duration_seconds' => $slotDuration,
                'default_schedule' => null,
            ]);

            $order = Order::factory()->create(['tenant_id' => $tenant->id]);

            $orderLine = OrderLine::create([
                'order_id' => $order->id,
                'name' => "Property12 iter {$i}",
                'priority_tier' => 'patrocinio',
                'by_slot' => true,
                'slots_purchased' => $slotsPurchased,
                'starts_at' => '2025-01-01',
                'ends_at' => '2025-12-31',
                'target_spots' => 0,
                'delivery_pace' => 'uniform',
                'share_weight' => 1,
                'status' => 'draft',
            ]);

            // Expected calculation
            $loopDuration = $numSlots * $slotDuration;
            $loopsPerDay = (int) floor(self::DEFAULT_OPERATING_WINDOW_SECONDS / $loopDuration);
            $expectedTargetSpots = $slotsPurchased * $loopsPerDay;

            $actual = $orderLine->fresh()->target_spots;

            $this->assertEquals(
                $expectedTargetSpots,
                $actual,
                "Property 12 (iter {$i}): num_slots={$numSlots}, slot_duration={$slotDuration}s, " .
                "slots_purchased={$slotsPurchased}, loops_per_day={$loopsPerDay} → " .
                "expected target_spots={$expectedTargetSpots}, got {$actual}"
            );
        }
    }

    /**
     * Property 12 with custom schedules: target_spots = N × loops_per_day
     *
     * For any valid schedule with an operating window between 1h and 24h,
     * the formula must hold with the schedule-derived operating window.
     *
     * **Validates: Requirements 4.3**
     */
    public function test_target_spots_equals_slots_purchased_times_loops_per_day_with_schedule(): void
    {
        for ($i = 0; $i < 100; $i++) {
            // Generate random valid inputs
            $numSlots = random_int(1, 50);
            $slotDuration = random_int(5, 30);
            $slotsPurchased = random_int(1, $numSlots);

            // Generate a random schedule with a single window
            $startHour = random_int(0, 20);
            $endHour = random_int($startHour + 1, min($startHour + 20, 24));

            $schedule = [
                ['days' => [1, 2, 3, 4, 5, 6, 7], 'start' => sprintf('%02d:00', $startHour), 'end' => sprintf('%02d:00', $endHour)],
            ];

            $operatingWindowSeconds = ($endHour - $startHour) * 3600;

            $tenant = Tenant::factory()->create([
                'num_slots' => $numSlots,
                'default_duration_seconds' => $slotDuration,
                'default_schedule' => $schedule,
            ]);

            $order = Order::factory()->create(['tenant_id' => $tenant->id]);

            $orderLine = OrderLine::create([
                'order_id' => $order->id,
                'name' => "Property12 schedule iter {$i}",
                'priority_tier' => 'patrocinio',
                'by_slot' => true,
                'slots_purchased' => $slotsPurchased,
                'starts_at' => '2025-01-01',
                'ends_at' => '2025-12-31',
                'target_spots' => 0,
                'delivery_pace' => 'uniform',
                'share_weight' => 1,
                'status' => 'draft',
            ]);

            // Expected calculation
            $loopDuration = $numSlots * $slotDuration;
            $loopsPerDay = (int) floor($operatingWindowSeconds / $loopDuration);
            $expectedTargetSpots = $slotsPurchased * $loopsPerDay;

            $actual = $orderLine->fresh()->target_spots;

            $this->assertEquals(
                $expectedTargetSpots,
                $actual,
                "Property 12 schedule (iter {$i}): num_slots={$numSlots}, slot_duration={$slotDuration}s, " .
                "slots_purchased={$slotsPurchased}, window={$operatingWindowSeconds}s, " .
                "loops_per_day={$loopsPerDay} → expected target_spots={$expectedTargetSpots}, got {$actual}"
            );
        }
    }

    /**
     * Property 12 boundary: When loops_per_day is 0 (loop longer than operating window),
     * target_spots must be 0.
     *
     * **Validates: Requirements 4.3**
     */
    public function test_target_spots_is_zero_when_loop_exceeds_operating_window(): void
    {
        for ($i = 0; $i < 20; $i++) {
            // Create conditions where num_slots × slot_duration > operating_window
            // Use a very short operating window (1 hour) with large loop
            $numSlots = random_int(50, 100);
            $slotDuration = random_int(40, 60);

            // 1-hour operating window
            $schedule = [
                ['days' => [1, 2, 3, 4, 5, 6, 7], 'start' => '10:00', 'end' => '11:00'],
            ];

            $operatingWindowSeconds = 3600; // 1 hour
            $loopDuration = $numSlots * $slotDuration;

            // Only test when loop actually exceeds operating window
            if ($loopDuration <= $operatingWindowSeconds) {
                continue;
            }

            $slotsPurchased = random_int(1, $numSlots);

            $tenant = Tenant::factory()->create([
                'num_slots' => $numSlots,
                'default_duration_seconds' => $slotDuration,
                'default_schedule' => $schedule,
            ]);

            $order = Order::factory()->create(['tenant_id' => $tenant->id]);

            $orderLine = OrderLine::create([
                'order_id' => $order->id,
                'name' => "Property12 boundary iter {$i}",
                'priority_tier' => 'patrocinio',
                'by_slot' => true,
                'slots_purchased' => $slotsPurchased,
                'starts_at' => '2025-01-01',
                'ends_at' => '2025-12-31',
                'target_spots' => 0,
                'delivery_pace' => 'uniform',
                'share_weight' => 1,
                'status' => 'draft',
            ]);

            // loops_per_day = floor(3600 / large_loop) = 0
            $loopsPerDay = (int) floor($operatingWindowSeconds / $loopDuration);
            $expectedTargetSpots = $slotsPurchased * $loopsPerDay;

            $this->assertEquals(0, $loopsPerDay, "Precondition: loops_per_day should be 0");
            $this->assertEquals(
                $expectedTargetSpots,
                $orderLine->fresh()->target_spots,
                "Property 12 boundary (iter {$i}): when loop duration ({$loopDuration}s) exceeds " .
                "operating window ({$operatingWindowSeconds}s), target_spots must be 0"
            );
        }
    }
}
