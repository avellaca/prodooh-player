<?php

namespace Tests\Property;

use App\Models\Content;
use App\Models\Creative;
use App\Models\Impression;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use App\Services\BresenhamInterleaver;
use App\Services\PriorityEngine;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Property tests for PriorityEngine — capacity and budget calculations.
 *
 * Tag: Feature: 06-player-reingenieria-motor
 *
 * Uses explicit loops (100 iterations) with random inputs.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.4**
 */
class PriorityEngineCapacityPropertyTest extends TestCase
{
    use RefreshDatabase;

    private PriorityEngine $engine;

    protected function setUp(): void
    {
        parent::setUp();
        $this->engine = new PriorityEngine(new BresenhamInterleaver());
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    /**
     * Property 1: Capacity calculation
     *
     * For any valid operating window (in seconds) and effective duration (positive integer),
     * total_daily_spots SHALL equal floor(window_seconds / duration_seconds).
     *
     * Generate random schedule (single window per day), random group duration (5-30s).
     * Create screen+group. Assert calculateTotalDailySpots == floor(window/duration).
     *
     * **Validates: Requirements 1.1**
     */
    public function test_capacity_equals_floor_of_window_divided_by_duration(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $windowSeconds = random_int(3600, 86400);
            $durationSeconds = random_int(5, 30);

            // Convert window to time format for schedule
            $endHours = intdiv($windowSeconds, 3600);
            $endMinutes = intdiv($windowSeconds % 3600, 60);
            $endRemainder = $windowSeconds % 60;
            $endTime = sprintf('%02d:%02d:%02d', $endHours, $endMinutes, $endRemainder);

            // Schedule with all 7 days to match any test day
            $schedule = [
                [
                    'days' => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
                    'start' => '00:00:00',
                    'end' => $endTime,
                ],
            ];

            $tenant = Tenant::factory()->create([
                'default_duration_seconds' => 10,
                'default_schedule' => null,
            ]);

            $group = ScreenGroup::factory()->create([
                'tenant_id' => $tenant->id,
                'duration_seconds' => $durationSeconds,
                'schedule' => null,
            ]);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'group_id' => $group->id,
                'schedule' => $schedule,
            ]);

            $expected = (int) floor($windowSeconds / $durationSeconds);
            $actual = $this->engine->calculateTotalDailySpots($screen);

            $this->assertEquals(
                $expected,
                $actual,
                "Property 1 (iter {$i}): calculateTotalDailySpots should equal floor({$windowSeconds} / {$durationSeconds}) = {$expected}, got {$actual}"
            );

            // Cleanup
            $screen->delete();
            $group->delete();
            $tenant->delete();
        }
    }

    /**
     * Property 2: Duration and schedule hierarchy resolution
     *
     * For any combination of (group_duration: int|null, tenant_duration: int|null),
     * the resolved effective value SHALL be the first non-null in the hierarchy order
     * (group > tenant > default 10s).
     *
     * 100 iterations of random (group_duration|null, tenant_duration|null).
     * Create models. Assert resolveEffectiveDuration picks first non-null or defaults to 10.
     *
     * **Validates: Requirements 1.2**
     */
    public function test_duration_hierarchy_resolves_first_non_null(): void
    {
        for ($i = 0; $i < 100; $i++) {
            // group_duration: null or 5-60
            $groupDuration = random_int(0, 1) === 1 ? random_int(5, 60) : null;
            // tenant_duration: 0 (falsy/not configured) or 5-60
            $tenantDuration = random_int(0, 1) === 1 ? random_int(5, 60) : 0;

            $tenant = Tenant::factory()->create([
                'default_duration_seconds' => $tenantDuration,
                'default_schedule' => null,
            ]);

            $group = ScreenGroup::factory()->create([
                'tenant_id' => $tenant->id,
                'duration_seconds' => $groupDuration,
                'schedule' => null,
            ]);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'group_id' => $group->id,
                'schedule' => null,
            ]);

            // Expected: first truthy in hierarchy (group > tenant > 10)
            if ($groupDuration) {
                $expected = $groupDuration;
            } elseif ($tenantDuration) {
                $expected = $tenantDuration;
            } else {
                $expected = 10;
            }

            $actual = $this->engine->resolveEffectiveDuration($screen);

            $this->assertEquals(
                $expected,
                $actual,
                "Property 2 (iter {$i}): resolveEffectiveDuration should return first truthy. " .
                "group_duration=" . ($groupDuration ?? 'null') . ", tenant_duration={$tenantDuration}, " .
                "expected={$expected}, got={$actual}"
            );

            // Cleanup
            $screen->delete();
            $group->delete();
            $tenant->delete();
        }
    }

    /**
     * Property 3: Schedule day-of-week calculation
     *
     * For any valid schedule with 1-3 random time rules for a specific day,
     * calculateDayOperatingSeconds returns sum of (end-start) for those rules.
     *
     * Generate 1-3 random time rules for a specific day.
     * Assert calculateDayOperatingSeconds returns sum of (end-start) for those rules.
     *
     * **Validates: Requirements 1.4**
     */
    public function test_schedule_day_operating_seconds_equals_sum_of_matching_rules(): void
    {
        $days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        $dateMap = [
            'monday' => '2026-07-06',
            'tuesday' => '2026-07-07',
            'wednesday' => '2026-07-08',
            'thursday' => '2026-07-09',
            'friday' => '2026-07-10',
            'saturday' => '2026-07-11',
            'sunday' => '2026-07-12',
        ];

        for ($i = 0; $i < 100; $i++) {
            $dayIndex = random_int(0, 6);
            $targetDay = $days[$dayIndex];
            $testDate = Carbon::parse($dateMap[$targetDay]);

            $numRules = random_int(1, 3);
            $schedule = [];
            $expectedSeconds = 0;

            for ($r = 0; $r < $numRules; $r++) {
                // Non-overlapping time blocks: segment r covers [r*7, r*7 + random(1,6)] hours
                $segmentStart = $r * 7;
                $segmentHours = random_int(1, 6);
                $segmentEnd = $segmentStart + $segmentHours;

                if ($segmentEnd > 24) {
                    $segmentEnd = 24;
                }

                $startTime = sprintf('%02d:00', $segmentStart);
                $endTime = sprintf('%02d:00', $segmentEnd);

                // Include the target day in this rule
                $ruleDays = [$targetDay];

                // Optionally add other days
                $otherDays = array_diff($days, [$targetDay]);
                if (random_int(0, 1) === 1) {
                    $ruleDays[] = $otherDays[array_rand($otherDays)];
                }

                $schedule[] = [
                    'days' => $ruleDays,
                    'start' => $startTime,
                    'end' => $endTime,
                ];

                $expectedSeconds += ($segmentEnd - $segmentStart) * 3600;
            }

            $actual = $this->engine->calculateDayOperatingSeconds($schedule, $testDate);

            $this->assertEquals(
                $expectedSeconds,
                $actual,
                "Property 3 (iter {$i}): calculateDayOperatingSeconds for {$targetDay} " .
                "should equal {$expectedSeconds}s, got {$actual}s. Schedule: " . json_encode($schedule)
            );
        }
    }

    /**
     * Property 4: Daily budget formula
     *
     * For any order line with target_spots > 0 and spots_delivered < target_spots:
     * - uniform: daily_budget == ceil((target - delivered) / remaining_days)
     * - asap: daily_budget == (target - delivered)
     *
     * Generate random target_spots (10-1000), delivered (0 to target-1),
     * remaining_days (1-30). Create line with matching ends_at.
     * Assert uniform=ceil((target-delivered)/remaining_days), asap=(target-delivered).
     *
     * **Validates: Requirements 2.1, 2.2**
     */
    public function test_daily_budget_formula_uniform_and_asap(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $targetSpots = random_int(10, 1000);
            $delivered = random_int(0, $targetSpots - 1);
            $remainingDays = random_int(1, 30);
            $pace = random_int(0, 1) === 0 ? 'uniform' : 'asap';

            $today = Carbon::parse('2026-08-15');
            Carbon::setTestNow($today);

            // ends_at = today + (remaining_days - 1) since remaining_days includes today
            $endsAt = $today->copy()->addDays($remainingDays - 1);

            $tenant = Tenant::factory()->create([
                'default_duration_seconds' => 10,
                'default_schedule' => null,
            ]);

            $group = ScreenGroup::factory()->create([
                'tenant_id' => $tenant->id,
                'duration_seconds' => 10,
            ]);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'group_id' => $group->id,
            ]);

            $content = Content::factory()->create([
                'tenant_id' => $tenant->id,
            ]);

            $order = Order::create([
                'tenant_id' => $tenant->id,
                'name' => 'Test Order',
                'starts_at' => '2026-08-01',
                'ends_at' => $endsAt->toDateString(),
                'status' => 'active',
            ]);

            $line = OrderLine::create([
                'order_id' => $order->id,
                'name' => 'Budget Line',
                'priority_tier' => 'estandar',
                'starts_at' => '2026-08-01',
                'ends_at' => $endsAt->toDateString(),
                'target_spots' => $targetSpots,
                'delivery_pace' => $pace,
                'share_weight' => 100,
                'status' => 'active',
            ]);

            $creative = Creative::create([
                'order_line_id' => $line->id,
                'content_id' => $content->id,
                'weight' => 100,
                'active_dates' => [$today->toDateString()],
            ]);

            // Create delivered impressions
            for ($d = 0; $d < $delivered; $d++) {
                Impression::create([
                    'screen_id' => $screen->id,
                    'creative_id' => $creative->id,
                    'order_line_id' => $line->id,
                    'source' => 'order_line',
                    'started_at' => '2026-08-10 10:00:00',
                    'result' => 'success',
                ]);
            }

            $remaining = $targetSpots - $delivered;

            if ($pace === 'asap') {
                $expected = $remaining;
            } else {
                $expected = (int) ceil($remaining / $remainingDays);
            }

            $actual = $this->engine->calculateDailyBudget($line);

            $this->assertEquals(
                $expected,
                $actual,
                "Property 4 (iter {$i}): calculateDailyBudget ({$pace}) should be {$expected}, got {$actual}. " .
                "target={$targetSpots}, delivered={$delivered}, remaining_days={$remainingDays}"
            );

            // Cleanup (respect FK order)
            Impression::query()->delete();
            Creative::query()->delete();
            OrderLine::query()->delete();
            Order::query()->delete();
            Screen::query()->delete();
            ScreenGroup::query()->delete();
            Content::query()->delete();
            Tenant::query()->delete();

            Carbon::setTestNow();
        }
    }

    /**
     * Property 5: Target exhaustion exclusion
     *
     * For any order line where spots_delivered >= target_spots (when target_spots is defined),
     * the line SHALL be excluded from the active lines set regardless of its date range or status.
     *
     * Create line with target_spots=X, create X success impressions.
     * Assert filterActiveLines excludes it.
     *
     * **Validates: Requirements 2.4**
     */
    public function test_target_exhaustion_excludes_line_from_active_set(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $targetSpots = random_int(1, 50);

            $today = '2026-08-15';
            Carbon::setTestNow(Carbon::parse($today));

            $tenant = Tenant::factory()->create([
                'default_duration_seconds' => 10,
                'default_schedule' => null,
            ]);

            $group = ScreenGroup::factory()->create([
                'tenant_id' => $tenant->id,
                'duration_seconds' => 10,
            ]);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'group_id' => $group->id,
            ]);

            $content = Content::factory()->create([
                'tenant_id' => $tenant->id,
            ]);

            $order = Order::create([
                'tenant_id' => $tenant->id,
                'name' => 'Exhaustion Order',
                'starts_at' => '2026-08-01',
                'ends_at' => '2026-08-31',
                'status' => 'active',
            ]);

            $line = OrderLine::create([
                'order_id' => $order->id,
                'name' => 'Exhausted Line',
                'priority_tier' => 'estandar',
                'starts_at' => '2026-08-01',
                'ends_at' => '2026-08-31',
                'target_spots' => $targetSpots,
                'delivery_pace' => 'uniform',
                'share_weight' => 100,
                'status' => 'active',
            ]);

            $creative = Creative::create([
                'order_line_id' => $line->id,
                'content_id' => $content->id,
                'weight' => 100,
                'active_dates' => [$today],
            ]);

            OrderLineTarget::create([
                'order_line_id' => $line->id,
                'screen_id' => $screen->id,
                'screen_group_id' => null,
            ]);

            // Create exactly target_spots impressions (meets target → should be excluded)
            for ($d = 0; $d < $targetSpots; $d++) {
                Impression::create([
                    'screen_id' => $screen->id,
                    'creative_id' => $creative->id,
                    'order_line_id' => $line->id,
                    'source' => 'order_line',
                    'started_at' => '2026-08-10 10:00:00',
                    'result' => 'success',
                ]);
            }

            $activeLines = $this->engine->filterActiveLines($screen);

            $this->assertFalse(
                $activeLines->contains('id', $line->id),
                "Property 5 (iter {$i}): Line with target_spots={$targetSpots} and {$targetSpots} " .
                "delivered impressions should be excluded from active lines (target exhausted)"
            );

            // Cleanup (respect FK order)
            Impression::query()->delete();
            OrderLineTarget::query()->delete();
            Creative::query()->delete();
            OrderLine::query()->delete();
            Order::query()->delete();
            Screen::query()->delete();
            ScreenGroup::query()->delete();
            Content::query()->delete();
            Tenant::query()->delete();

            Carbon::setTestNow();
        }
    }
}
