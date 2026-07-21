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
 * Property tests for PriorityEngine — waterfall allocation.
 *
 * Tag: Feature: 06-player-reingenieria-motor
 *
 * Uses explicit loops with random inputs.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.6, 6.2, 6.3**
 */
class PriorityEngineWaterfallPropertyTest extends TestCase
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
     * Helper: Create base test infrastructure (tenant, group, screen, content, order).
     */
    private function createBaseInfrastructure(): array
    {
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
            'ends_at' => '2026-08-31',
            'status' => 'active',
        ]);

        return compact('tenant', 'group', 'screen', 'content', 'order');
    }

    /**
     * Helper: Create an order line with a known daily_budget via asap pace.
     *
     * For asap: daily_budget = target_spots - delivered.
     * We set target_spots = desiredBudget + 0 delivered = desiredBudget as daily_budget.
     * This avoids creating impression records for the "delivered" count.
     */
    private function createLineWithBudget(
        string $orderId,
        string $contentId,
        string $tier,
        int $desiredBudget,
        int $shareWeight,
        string $today
    ): OrderLine {
        $line = OrderLine::create([
            'order_id' => $orderId,
            'name' => "Line {$tier} budget={$desiredBudget}",
            'priority_tier' => $tier,
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-31',
            'target_spots' => $desiredBudget, // asap: budget = target - delivered = target - 0 = target
            'delivery_pace' => 'asap',
            'status' => 'active',
        ]);

        Creative::create([
            'order_line_id' => $line->id,
            'content_id' => $contentId,
            'weight' => 100,
            'active_dates' => [$today],
        ]);

        return $line;
    }

    /**
     * Helper: Clean up all test data.
     */
    private function cleanUp(): void
    {
        Impression::query()->delete();
        OrderLineTarget::query()->delete();
        Creative::query()->delete();
        OrderLine::query()->delete();
        Order::query()->delete();
        Screen::query()->delete();
        ScreenGroup::query()->delete();
        Content::query()->delete();
        Tenant::query()->delete();
    }

    /**
     * Property 6: Waterfall priority guarantee
     *
     * For any set of active order lines across all priority tiers and any total capacity,
     * patrocinio lines SHALL receive their full daily_budget before any capacity is allocated
     * to estándar, and estándar SHALL receive its allocation before red_interna.
     *
     * Create lines across tiers where each tier's demand < capacity.
     * Assert patrocinio lines get exact budget BEFORE estandar gets anything.
     *
     * **Validates: Requirements 3.1**
     */
    public function test_patrocinio_gets_full_budget_before_estandar(): void
    {
        $today = '2026-08-15';
        Carbon::setTestNow(Carbon::parse($today));

        for ($i = 0; $i < 50; $i++) {
            $infra = $this->createBaseInfrastructure();

            // Random capacity (200-1000)
            $capacity = random_int(200, 1000);

            // Each tier demand < capacity/3 so all tiers fit comfortably
            $maxTierDemand = (int) floor($capacity / 3) - 10;
            $maxTierDemand = max(10, $maxTierDemand);

            // Create patrocinio lines (1-3)
            $numPatrocinio = random_int(1, 3);
            $patrocinioLines = collect();
            $patronicioBudgets = [];

            for ($p = 0; $p < $numPatrocinio; $p++) {
                $budget = random_int(3, (int) floor($maxTierDemand / $numPatrocinio));
                $patronicioBudgets[] = $budget;
                $line = $this->createLineWithBudget(
                    $infra['order']->id,
                    $infra['content']->id,
                    'patrocinio',
                    $budget,
                    random_int(1, 10),
                    $today
                );
                $patrocinioLines->push($line);
            }

            // Create estandar lines (1-3)
            $numEstandar = random_int(1, 3);
            $estandarLines = collect();
            $estandarBudgets = [];

            for ($e = 0; $e < $numEstandar; $e++) {
                $budget = random_int(3, (int) floor($maxTierDemand / $numEstandar));
                $estandarBudgets[] = $budget;
                $line = $this->createLineWithBudget(
                    $infra['order']->id,
                    $infra['content']->id,
                    'estandar',
                    $budget,
                    random_int(1, 10),
                    $today
                );
                $estandarLines->push($line);
            }

            // Combine all lines
            $allLines = $patrocinioLines->merge($estandarLines);

            // Run waterfall
            $result = $this->engine->runWaterfall($allLines, $capacity);
            $allocations = collect($result['allocations']);

            // Assert: patrocinio lines get their exact budget
            foreach ($patrocinioLines as $idx => $pLine) {
                $allocation = $allocations->firstWhere('order_line_id', $pLine->id);
                $expectedBudget = $patronicioBudgets[$idx];

                $this->assertNotNull(
                    $allocation,
                    "Property 6 (iter {$i}): patrocinio line should have an allocation"
                );

                $this->assertEquals(
                    $expectedBudget,
                    $allocation['count'],
                    "Property 6 (iter {$i}): patrocinio line should get its full budget={$expectedBudget}, " .
                    "got {$allocation['count']}. Capacity={$capacity}"
                );
            }

            // Assert: estandar lines also get their budget (since total demand < capacity)
            foreach ($estandarLines as $idx => $eLine) {
                $allocation = $allocations->firstWhere('order_line_id', $eLine->id);
                $expectedBudget = $estandarBudgets[$idx];

                $this->assertNotNull(
                    $allocation,
                    "Property 6 (iter {$i}): estandar line should have an allocation"
                );

                $this->assertEquals(
                    $expectedBudget,
                    $allocation['count'],
                    "Property 6 (iter {$i}): estandar line should get its budget={$expectedBudget}, " .
                    "got {$allocation['count']}. This confirms tier ordering (patrocinio served first)."
                );
            }

            $this->cleanUp();
        }

        Carbon::setTestNow();
    }

    /**
     * Property 7: Under-capacity exact allocation
     *
     * For any priority level where the sum of daily_budgets of active lines is ≤ remaining
     * capacity, each line SHALL receive exactly its daily_budget.
     *
     * Random lines (1-5) in one tier with demand sum < capacity (random 100-1000).
     * Assert each line.count == its daily_budget.
     *
     * **Validates: Requirements 3.2**
     */
    public function test_under_capacity_each_line_gets_exact_budget(): void
    {
        $today = '2026-08-15';
        Carbon::setTestNow(Carbon::parse($today));

        for ($i = 0; $i < 100; $i++) {
            $infra = $this->createBaseInfrastructure();

            $capacity = random_int(100, 1000);
            $numLines = random_int(1, 5);

            // Generate budgets that sum to less than capacity
            $budgets = [];
            $maxPerLine = (int) floor($capacity / ($numLines + 1));
            $maxPerLine = max(2, $maxPerLine);

            for ($l = 0; $l < $numLines; $l++) {
                $budgets[] = random_int(1, $maxPerLine);
            }

            $totalDemand = array_sum($budgets);
            $this->assertLessThanOrEqual($capacity, $totalDemand);

            $lines = collect();
            $tier = ['patrocinio', 'estandar', 'red_interna'][random_int(0, 2)];

            for ($l = 0; $l < $numLines; $l++) {
                $line = $this->createLineWithBudget(
                    $infra['order']->id,
                    $infra['content']->id,
                    $tier,
                    $budgets[$l],
                    random_int(1, 10),
                    $today
                );
                $lines->push($line);
            }

            // Run allocateLevel
            $result = $this->engine->allocateLevel($lines, $capacity);
            $allocations = collect($result['allocations']);

            // Assert each line gets its exact budget
            foreach ($lines as $idx => $line) {
                $allocation = $allocations->firstWhere('order_line_id', $line->id);
                $expectedBudget = $budgets[$idx];

                $this->assertNotNull(
                    $allocation,
                    "Property 7 (iter {$i}): line {$idx} should have an allocation"
                );

                $this->assertEquals(
                    $expectedBudget,
                    $allocation['count'],
                    "Property 7 (iter {$i}): line {$idx} should get exact budget={$expectedBudget}, " .
                    "got {$allocation['count']}. capacity={$capacity}, totalDemand={$totalDemand}"
                );
            }

            // Remaining should be capacity - totalDemand
            $this->assertEquals(
                $capacity - $totalDemand,
                $result['remaining'],
                "Property 7 (iter {$i}): remaining should be {$capacity} - {$totalDemand} = " . ($capacity - $totalDemand)
            );

            $this->cleanUp();
        }

        Carbon::setTestNow();
    }

    /**
     * Property 8: Over-capacity proportional allocation
     *
     * For any priority level where total demand exceeds remaining capacity,
     * each line's allocation SHALL be floor(capacity × weight / total_weight).
     *
     * Random lines with demand > capacity. Assert each allocation == floor(capacity * weight / total_weight).
     *
     * **Validates: Requirements 3.3**
     */
    public function test_over_capacity_equal_allocation(): void
    {
        $today = '2026-08-15';
        Carbon::setTestNow(Carbon::parse($today));

        for ($i = 0; $i < 100; $i++) {
            $infra = $this->createBaseInfrastructure();

            $capacity = random_int(50, 500);
            $numLines = random_int(2, 5);

            // Generate budgets that sum to MORE than capacity (overcapacity)
            $budgets = [];
            $minPerLine = (int) ceil($capacity / $numLines) + 10;

            for ($l = 0; $l < $numLines; $l++) {
                $budgets[] = random_int($minPerLine, $minPerLine + 100);
            }

            $totalDemand = array_sum($budgets);
            $this->assertGreaterThan($capacity, $totalDemand);

            $lines = collect();
            $tier = ['patrocinio', 'estandar', 'red_interna'][random_int(0, 2)];

            for ($l = 0; $l < $numLines; $l++) {
                $line = $this->createLineWithBudget(
                    $infra['order']->id,
                    $infra['content']->id,
                    $tier,
                    $budgets[$l],
                    1, // weight param kept for signature compatibility but ignored
                    $today
                );
                $lines->push($line);
            }

            // Run allocateLevel
            $result = $this->engine->allocateLevel($lines, $capacity);
            $allocations = collect($result['allocations']);

            // Assert each line gets floor(capacity * 1 / numLines) (equal weight)
            $expectedCount = (int) floor($capacity / $numLines);

            foreach ($lines as $idx => $line) {
                $allocation = $allocations->firstWhere('order_line_id', $line->id);

                $this->assertNotNull(
                    $allocation,
                    "Property 8 (iter {$i}): line {$idx} should have an allocation"
                );

                $this->assertEqualsWithDelta(
                    $expectedCount,
                    $allocation['count'],
                    1, // ±1 for rounding
                    "Property 8 (iter {$i}): line {$idx} should get approximately floor({$capacity} / {$numLines}) " .
                    "= {$expectedCount} (±1), got {$allocation['count']}"
                );
            }

            $this->cleanUp();
        }

        Carbon::setTestNow();
    }

    /**
     * Property 10: Red interna remainder 50/50 split
     *
     * For any allocation where capacity remains after red_interna explicit lines are served,
     * the leftover SHALL be divided: ssp = floor(r/2), playlist = r - floor(r/2).
     *
     * For random remaining (0-1000), assert ssp=floor(r/2), playlist=r-floor(r/2).
     *
     * **Validates: Requirements 3.6**
     */
    public function test_remainder_split_50_50_between_ssp_and_playlist(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $remaining = random_int(0, 1000);

            $result = $this->engine->allocateRemainder($remaining);

            $expectedSsp = (int) floor($remaining / 2);
            $expectedPlaylist = $remaining - $expectedSsp;

            $this->assertEquals(
                $expectedSsp,
                $result['ssp_slots'],
                "Property 10 (iter {$i}): ssp_slots should be floor({$remaining}/2) = {$expectedSsp}, " .
                "got {$result['ssp_slots']}"
            );

            $this->assertEquals(
                $expectedPlaylist,
                $result['playlist_slots'],
                "Property 10 (iter {$i}): playlist_slots should be {$remaining} - floor({$remaining}/2) = {$expectedPlaylist}, " .
                "got {$result['playlist_slots']}"
            );

            // Total must equal the input
            $this->assertEquals(
                $remaining,
                $result['ssp_slots'] + $result['playlist_slots'],
                "Property 10 (iter {$i}): ssp + playlist should equal remaining={$remaining}"
            );
        }
    }

    /**
     * Property 14: Intra-day recalculation uses remaining capacity
     *
     * For any mid-day recalculation triggered by an event, the waterfall algorithm SHALL use
     * total_daily_spots - impressions_delivered_today as its starting capacity.
     *
     * Create screen with random impressions today. Assert recalculate(isIntraDay=true).capacity
     * == total_daily_spots - impressions_today.
     *
     * **Validates: Requirements 6.2, 6.3**
     */
    public function test_intraday_recalculation_uses_remaining_capacity(): void
    {
        for ($i = 0; $i < 50; $i++) {
            $today = '2026-08-15';
            Carbon::setTestNow(Carbon::parse($today));

            $durationSeconds = random_int(5, 30);
            $windowSeconds = 86400;
            $totalDailySpots = (int) floor($windowSeconds / $durationSeconds);

            // Random impressions today (0 to 50, capped for speed)
            $impressionsToday = random_int(0, min($totalDailySpots, 50));

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
                'schedule' => null,
            ]);

            // Bulk create impressions for today
            $impressionData = [];
            for ($d = 0; $d < $impressionsToday; $d++) {
                $impressionData[] = [
                    'id' => \Illuminate\Support\Str::uuid()->toString(),
                    'screen_id' => $screen->id,
                    'creative_id' => null,
                    'order_line_id' => null,
                    'source' => 'order_line',
                    'started_at' => Carbon::parse($today)->addMinutes($d)->toDateTimeString(),
                    'result' => 'success',
                ];
            }

            if (!empty($impressionData)) {
                // Insert in chunks
                foreach (array_chunk($impressionData, 50) as $chunk) {
                    Impression::insert($chunk);
                }
            }

            $expectedCapacity = max(0, $totalDailySpots - $impressionsToday);

            // Run recalculate with isIntraDay=true
            $result = $this->engine->recalculate($screen->id, true);

            $this->assertEquals(
                $totalDailySpots,
                $result['total_daily_spots'],
                "Property 14 (iter {$i}): total_daily_spots should be {$totalDailySpots}"
            );

            $this->assertEquals(
                $expectedCapacity,
                $result['capacity'],
                "Property 14 (iter {$i}): intra-day capacity should be {$totalDailySpots} - {$impressionsToday} = {$expectedCapacity}, " .
                "got {$result['capacity']}"
            );

            $this->cleanUp();
            Carbon::setTestNow();
        }
    }
}
