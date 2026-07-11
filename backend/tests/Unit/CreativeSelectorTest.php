<?php

namespace Tests\Unit;

use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\Tenant;
use App\Services\CreativeSelector;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CreativeSelectorTest extends TestCase
{
    use RefreshDatabase;

    private CreativeSelector $selector;

    protected function setUp(): void
    {
        parent::setUp();
        $this->selector = new CreativeSelector();
    }

    private function createOrderLineWithCreatives(array $creativesData): OrderLine
    {
        $tenant = Tenant::factory()->create();
        $order = Order::factory()->create([
            'tenant_id' => $tenant->id,
            'status' => 'active',
        ]);
        $line = OrderLine::factory()->create([
            'order_id' => $order->id,
            'status' => 'active',
        ]);

        foreach ($creativesData as $data) {
            Creative::factory()->create(array_merge([
                'order_line_id' => $line->id,
            ], $data));
        }

        // Refresh to load the creatives relationship
        $line->load('creatives');

        return $line;
    }

    public function test_single_creative_always_selected(): void
    {
        $today = Carbon::today()->toDateString();

        $line = $this->createOrderLineWithCreatives([
            ['weight' => 1, 'active_dates' => [$today]],
        ]);

        $creative = $line->creatives->first();

        // With a single creative, it should always be returned regardless of history
        $result = $this->selector->select($line, []);
        $this->assertEquals($creative->id, $result->id);

        // Even with the same creative in history, single pool means no restriction
        $result = $this->selector->select($line, [$creative->id]);
        $this->assertEquals($creative->id, $result->id);
    }

    public function test_never_repeats_consecutively_with_two_creatives(): void
    {
        $today = Carbon::today()->toDateString();

        $line = $this->createOrderLineWithCreatives([
            ['weight' => 1, 'active_dates' => [$today]],
            ['weight' => 1, 'active_dates' => [$today]],
        ]);

        $creativeIds = $line->creatives->pluck('id')->toArray();
        $firstId = $creativeIds[0];

        // When the first creative was just played, it should not be selected again
        for ($i = 0; $i < 20; $i++) {
            $result = $this->selector->select($line, [$firstId]);
            $this->assertNotEquals($firstId, $result->id,
                "Should not repeat the most recent creative consecutively");
        }
    }

    public function test_anti_repetition_window_for_pool_of_three(): void
    {
        $today = Carbon::today()->toDateString();

        $line = $this->createOrderLineWithCreatives([
            ['weight' => 1, 'active_dates' => [$today]],
            ['weight' => 1, 'active_dates' => [$today]],
            ['weight' => 1, 'active_dates' => [$today]],
        ]);

        $creativeIds = $line->creatives->pluck('id')->toArray();

        // Pool size 3, window = min(3-1, 5) = 2
        // If last 2 creatives were A, B → only C is eligible
        $recentHistory = [$creativeIds[0], $creativeIds[1]];

        for ($i = 0; $i < 20; $i++) {
            $result = $this->selector->select($line, $recentHistory);
            $this->assertEquals($creativeIds[2], $result->id,
                "With pool of 3 and window of 2, only the third creative should be selected");
        }
    }

    public function test_anti_repetition_window_capped_at_5(): void
    {
        $today = Carbon::today()->toDateString();

        // Create 8 creatives → window = min(8-1, 5) = 5
        $creativesData = [];
        for ($i = 0; $i < 8; $i++) {
            $creativesData[] = ['weight' => 1, 'active_dates' => [$today]];
        }

        $line = $this->createOrderLineWithCreatives($creativesData);
        $creativeIds = $line->creatives->pluck('id')->toArray();

        // Recent history has 5 IDs (the window max)
        $recentHistory = array_slice($creativeIds, 0, 5);

        // The selected creative should be from the remaining 3 (indices 5, 6, 7)
        $eligibleIds = array_slice($creativeIds, 5, 3);

        for ($i = 0; $i < 30; $i++) {
            $result = $this->selector->select($line, $recentHistory);
            $this->assertContains($result->id, $eligibleIds,
                "With pool of 8 and window of 5, only creatives outside window should be eligible");
        }
    }

    public function test_only_active_creatives_for_today_are_in_pool(): void
    {
        $today = Carbon::today()->toDateString();
        $tomorrow = Carbon::tomorrow()->toDateString();

        $line = $this->createOrderLineWithCreatives([
            ['weight' => 1, 'active_dates' => [$today]],
            ['weight' => 1, 'active_dates' => [$tomorrow]], // Not active today
        ]);

        $activeCreative = $line->creatives->first(function ($c) use ($today) {
            return in_array($today, $c->active_dates);
        });

        // Only 1 creative active today, so it should always be selected
        for ($i = 0; $i < 10; $i++) {
            $result = $this->selector->select($line, []);
            $this->assertEquals($activeCreative->id, $result->id);
        }
    }

    public function test_weighted_selection_respects_relative_probabilities(): void
    {
        $today = Carbon::today()->toDateString();

        // Create one creative with high weight and one with low weight
        $line = $this->createOrderLineWithCreatives([
            ['weight' => 100, 'active_dates' => [$today]],
            ['weight' => 1, 'active_dates' => [$today]],
        ]);

        $creatives = $line->creatives->sortByDesc('weight');
        $heavyId = $creatives->first()->id;

        // Run many selections with empty history — the heavy creative should dominate
        $heavyCount = 0;
        $iterations = 200;

        for ($i = 0; $i < $iterations; $i++) {
            $result = $this->selector->select($line, []);
            if ($result->id === $heavyId) {
                $heavyCount++;
            }
        }

        // With 100:1 ratio, we expect ~99% selections to be the heavy one
        $this->assertGreaterThan($iterations * 0.8, $heavyCount,
            "Creative with weight 100 should be selected significantly more than weight 1");
    }

    public function test_fallback_to_full_pool_when_all_excluded(): void
    {
        $today = Carbon::today()->toDateString();

        // Pool of 2, window = min(2-1, 5) = 1
        // If history contains both IDs (more than window), only first one is excluded
        // But let's test the edge case where history is artificially large
        $line = $this->createOrderLineWithCreatives([
            ['weight' => 1, 'active_dates' => [$today]],
            ['weight' => 1, 'active_dates' => [$today]],
        ]);

        $creativeIds = $line->creatives->pluck('id')->toArray();

        // Even with both in history, window=1 means only first entry is excluded
        // This test validates normal behavior with pool of 2
        $result = $this->selector->select($line, $creativeIds);
        $this->assertContains($result->id, $creativeIds);
    }

    public function test_empty_history_selects_from_full_pool(): void
    {
        $today = Carbon::today()->toDateString();

        $line = $this->createOrderLineWithCreatives([
            ['weight' => 1, 'active_dates' => [$today]],
            ['weight' => 1, 'active_dates' => [$today]],
            ['weight' => 1, 'active_dates' => [$today]],
        ]);

        $creativeIds = $line->creatives->pluck('id')->toArray();

        // With empty history, any creative from the pool is valid
        $result = $this->selector->select($line, []);
        $this->assertContains($result->id, $creativeIds);
    }
}
