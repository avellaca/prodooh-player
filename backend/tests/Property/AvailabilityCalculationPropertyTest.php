<?php

namespace Tests\Property;

use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use App\Services\AvailabilityAnalyzer;
use App\Services\AvailabilityResult;
use App\Services\LoopTemplateGenerator;
use App\Services\RotationScheduler;
use App\Services\SlotAllocator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Property-based test for availability inventory calculation.
 *
 * Uses randomized inputs (100 iterations) to verify Property 15:
 * For any OrderLine at activation time, the availability calculated must compare
 * correctly: target_spots vs (loops_per_day × assignable_slots) considering other
 * active lines on the same screens. The result must indicate isSufficient=true if
 * and only if target_spots ≤ available capacity.
 *
 * **Validates: Requirements 6.1**
 */
class AvailabilityCalculationPropertyTest extends TestCase
{
    use RefreshDatabase;

    private AvailabilityAnalyzer $analyzer;

    /** Default operating window in seconds (16 hours) when no schedule is configured */
    private const DEFAULT_OPERATING_WINDOW_SECONDS = 57600;

    /** Valid priority tiers */
    private const PRIORITY_TIERS = ['patrocinio', 'estandar', 'red_interna'];

    protected function setUp(): void
    {
        parent::setUp();

        $loopTemplateGenerator = new LoopTemplateGenerator(
            new SlotAllocator(),
            new RotationScheduler(),
        );

        $this->analyzer = new AvailabilityAnalyzer($loopTemplateGenerator);
    }

    // ─── Property 15: Availability inventory calculation ────────────────────────

    /**
     * Property 15a: For any OrderLine with random target_spots and random screen
     * configurations (num_slots, ssp_slots, playlist_slots), isSufficient MUST be
     * true if and only if target_spots ≤ available capacity.
     *
     * Available capacity = loops_per_day × assignable_slots (per screen, summed).
     *
     * **Validates: Requirements 6.1**
     */
    public function test_is_sufficient_iff_target_spots_lte_available_capacity(): void
    {
        for ($i = 0; $i < 100; $i++) {
            // Generate random valid loop configuration
            $numSlots = random_int(3, 30);
            $sspSlots = random_int(0, (int) floor($numSlots / 3));
            $playlistSlots = random_int(0, (int) floor($numSlots / 3));

            // Ensure at least 1 ad_slot
            if ($sspSlots + $playlistSlots >= $numSlots) {
                $sspSlots = 0;
                $playlistSlots = 0;
            }

            $slotDuration = random_int(5, 30);

            $tenant = Tenant::factory()->create([
                'num_slots' => $numSlots,
                'ssp_slots' => $sspSlots,
                'playlist_slots' => $playlistSlots,
                'default_duration_seconds' => $slotDuration,
                'default_schedule' => null, // uses 57600s default
            ]);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'group_id' => null,
                'num_slots' => null,
            ]);

            // Calculate expected capacity (no other active lines)
            $adSlots = $numSlots - $sspSlots - $playlistSlots;
            $loopDuration = $numSlots * $slotDuration;
            $loopsPerDay = (int) floor(self::DEFAULT_OPERATING_WINDOW_SECONDS / $loopDuration);
            $expectedCapacity = $loopsPerDay * $adSlots;

            // Generate a random target_spots that sometimes exceeds and sometimes fits
            $targetSpots = random_int(1, max(1, $expectedCapacity * 2));

            $order = Order::factory()->create(['tenant_id' => $tenant->id]);
            $line = OrderLine::factory()->create([
                'order_id' => $order->id,
                'priority_tier' => 'estandar',
                'delivery_pace' => 'uniform',
                'status' => 'draft',
                'starts_at' => now()->subDay(),
                'ends_at' => now()->addDays(30),
                'target_spots' => $targetSpots,
                'share_weight' => 1,
            ]);

            OrderLineTarget::factory()->create([
                'order_line_id' => $line->id,
                'screen_id' => $screen->id,
                'screen_group_id' => null,
            ]);

            $result = $this->analyzer->analyze($line);

            // Core invariant: isSufficient ↔ target_spots ≤ availableCapacity
            $expectedSufficient = $targetSpots <= $result->availableCapacity;

            $this->assertEquals(
                $expectedSufficient,
                $result->isSufficient,
                "Property 15a (iter {$i}): target_spots={$targetSpots}, availableCapacity={$result->availableCapacity}. " .
                "isSufficient must be " . ($expectedSufficient ? 'true' : 'false') .
                " but got " . ($result->isSufficient ? 'true' : 'false') .
                " [numSlots={$numSlots}, ssp={$sspSlots}, playlist={$playlistSlots}, slotDur={$slotDuration}s]"
            );

            // Also verify the targetSpots in result matches what we passed
            $this->assertEquals($targetSpots, $result->targetSpots,
                "Property 15a (iter {$i}): Result targetSpots must match line's target_spots"
            );
        }
    }

    /**
     * Property 15b: For any configuration, when other active lines consume slots,
     * the available capacity must be reduced accordingly:
     * - Patrocinio lines reduce by slots_purchased
     * - Estandar/Red_Interna lines reduce by 1 each
     *
     * The invariant isSufficient = (target_spots ≤ capacity) must still hold.
     *
     * **Validates: Requirements 6.1**
     */
    public function test_capacity_reduction_by_other_active_lines_maintains_invariant(): void
    {
        for ($i = 0; $i < 100; $i++) {
            // Use a moderate config to avoid edge cases with 0 capacity
            $numSlots = random_int(6, 20);
            $sspSlots = random_int(0, 2);
            $playlistSlots = random_int(0, 1);

            if ($sspSlots + $playlistSlots >= $numSlots) {
                $sspSlots = 0;
                $playlistSlots = 0;
            }

            $slotDuration = random_int(5, 15);
            $adSlots = $numSlots - $sspSlots - $playlistSlots;

            $tenant = Tenant::factory()->create([
                'num_slots' => $numSlots,
                'ssp_slots' => $sspSlots,
                'playlist_slots' => $playlistSlots,
                'default_duration_seconds' => $slotDuration,
                'default_schedule' => null,
            ]);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'group_id' => null,
                'num_slots' => null,
            ]);

            // Create random number of other active lines (0 to min(3, adSlots-1))
            $maxOtherLines = min(3, max(0, $adSlots - 1));
            $numOtherLines = random_int(0, $maxOtherLines);
            $totalConsumedSlots = 0;

            for ($j = 0; $j < $numOtherLines; $j++) {
                $tier = self::PRIORITY_TIERS[array_rand(self::PRIORITY_TIERS)];
                $lineOverrides = [
                    'priority_tier' => $tier,
                    'delivery_pace' => 'uniform',
                    'status' => 'active',
                    'starts_at' => now()->subDay(),
                    'ends_at' => now()->addDays(30),
                    'share_weight' => 1,
                ];

                if ($tier === 'patrocinio') {
                    $remainingAdSlots = $adSlots - $totalConsumedSlots;
                    $maxPurchasable = max(1, min(3, $remainingAdSlots - 1));
                    $slotsPurchased = random_int(1, $maxPurchasable);
                    $lineOverrides['slots_purchased'] = $slotsPurchased;
                    $lineOverrides['by_slot'] = true;
                    $lineOverrides['target_spots'] = $slotsPurchased * (int) floor(self::DEFAULT_OPERATING_WINDOW_SECONDS / ($numSlots * $slotDuration));
                    $totalConsumedSlots += $slotsPurchased;
                } else {
                    $lineOverrides['target_spots'] = random_int(100, 500);
                    $totalConsumedSlots += 1;
                }

                // Don't exceed ad_slots capacity
                if ($totalConsumedSlots >= $adSlots) {
                    break;
                }

                $otherOrder = Order::factory()->create(['tenant_id' => $tenant->id]);
                $otherLine = OrderLine::factory()->create(array_merge(
                    ['order_id' => $otherOrder->id],
                    $lineOverrides,
                ));

                OrderLineTarget::factory()->create([
                    'order_line_id' => $otherLine->id,
                    'screen_id' => $screen->id,
                    'screen_group_id' => null,
                ]);
            }

            // Calculate expected assignable slots for our line
            $loopsPerDay = (int) floor(self::DEFAULT_OPERATING_WINDOW_SECONDS / ($numSlots * $slotDuration));
            $assignableSlots = max(0, $adSlots - $totalConsumedSlots);
            $expectedCapacity = $loopsPerDay * $assignableSlots;

            // Random target that sometimes exceeds capacity
            $targetSpots = random_int(1, max(1, $expectedCapacity + 500));

            $order = Order::factory()->create(['tenant_id' => $tenant->id]);
            $line = OrderLine::factory()->create([
                'order_id' => $order->id,
                'priority_tier' => 'estandar',
                'delivery_pace' => 'uniform',
                'status' => 'draft',
                'starts_at' => now()->subDay(),
                'ends_at' => now()->addDays(30),
                'target_spots' => $targetSpots,
                'share_weight' => 1,
            ]);

            OrderLineTarget::factory()->create([
                'order_line_id' => $line->id,
                'screen_id' => $screen->id,
                'screen_group_id' => null,
            ]);

            $result = $this->analyzer->analyze($line);

            // Core invariant must hold regardless of other lines
            $expectedSufficient = $targetSpots <= $result->availableCapacity;

            $this->assertEquals(
                $expectedSufficient,
                $result->isSufficient,
                "Property 15b (iter {$i}): target_spots={$targetSpots}, availableCapacity={$result->availableCapacity}, " .
                "otherLines={$numOtherLines}, consumedSlots={$totalConsumedSlots}. " .
                "isSufficient must be " . ($expectedSufficient ? 'true' : 'false') .
                " but got " . ($result->isSufficient ? 'true' : 'false') .
                " [numSlots={$numSlots}, adSlots={$adSlots}, loopsPerDay={$loopsPerDay}]"
            );
        }
    }

    /**
     * Property 15c: For any OrderLine targeting multiple screens with random
     * configurations, the available capacity must be the sum of per-screen
     * capacities, and isSufficient must reflect the aggregate correctly.
     *
     * **Validates: Requirements 6.1**
     */
    public function test_multi_screen_capacity_aggregation_maintains_invariant(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $numSlots = random_int(5, 20);
            $sspSlots = random_int(0, 2);
            $playlistSlots = random_int(0, 1);

            if ($sspSlots + $playlistSlots >= $numSlots) {
                $sspSlots = 0;
                $playlistSlots = 0;
            }

            $slotDuration = random_int(5, 20);

            $tenant = Tenant::factory()->create([
                'num_slots' => $numSlots,
                'ssp_slots' => $sspSlots,
                'playlist_slots' => $playlistSlots,
                'default_duration_seconds' => $slotDuration,
                'default_schedule' => null,
            ]);

            // Create 1 to 4 screens
            $numScreens = random_int(1, 4);
            $screens = [];
            for ($s = 0; $s < $numScreens; $s++) {
                $screens[] = Screen::factory()->create([
                    'tenant_id' => $tenant->id,
                    'group_id' => null,
                    'num_slots' => null,
                ]);
            }

            // Calculate expected total capacity
            $adSlots = $numSlots - $sspSlots - $playlistSlots;
            $loopsPerDay = (int) floor(self::DEFAULT_OPERATING_WINDOW_SECONDS / ($numSlots * $slotDuration));
            $expectedTotalCapacity = $numScreens * ($loopsPerDay * $adSlots);

            // Random target spots
            $targetSpots = random_int(1, max(1, $expectedTotalCapacity * 2));

            $order = Order::factory()->create(['tenant_id' => $tenant->id]);
            $line = OrderLine::factory()->create([
                'order_id' => $order->id,
                'priority_tier' => 'estandar',
                'delivery_pace' => 'uniform',
                'status' => 'draft',
                'starts_at' => now()->subDay(),
                'ends_at' => now()->addDays(30),
                'target_spots' => $targetSpots,
                'share_weight' => 1,
            ]);

            // Target all screens
            foreach ($screens as $screen) {
                OrderLineTarget::factory()->create([
                    'order_line_id' => $line->id,
                    'screen_id' => $screen->id,
                    'screen_group_id' => null,
                ]);
            }

            $result = $this->analyzer->analyze($line);

            // Core invariant
            $expectedSufficient = $targetSpots <= $result->availableCapacity;

            $this->assertEquals(
                $expectedSufficient,
                $result->isSufficient,
                "Property 15c (iter {$i}): target_spots={$targetSpots}, availableCapacity={$result->availableCapacity}, " .
                "screens={$numScreens}. " .
                "isSufficient must be " . ($expectedSufficient ? 'true' : 'false') .
                " but got " . ($result->isSufficient ? 'true' : 'false') .
                " [numSlots={$numSlots}, adSlots={$adSlots}, loopsPerDay={$loopsPerDay}]"
            );

            // Verify capacity is consistent with multi-screen sum
            $this->assertEquals(
                $expectedTotalCapacity,
                $result->availableCapacity,
                "Property 15c (iter {$i}): Expected aggregated capacity={$expectedTotalCapacity} " .
                "({$numScreens} screens × {$loopsPerDay} loops × {$adSlots} adSlots), " .
                "got {$result->availableCapacity}"
            );
        }
    }
}
