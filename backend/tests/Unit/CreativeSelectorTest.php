<?php

namespace Tests\Unit;

use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\Tenant;
use App\Services\CreativeSelector;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
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

    /**
     * Helper: create a pool of Creative models with given weights.
     *
     * @param array $creativesData Each item: ['weight' => int]
     * @return Collection<int, Creative>
     */
    private function createPool(array $creativesData): Collection
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

        $creatives = collect();
        foreach ($creativesData as $data) {
            $creative = Creative::factory()->create(array_merge([
                'order_line_id' => $line->id,
            ], $data));
            $creatives->push($creative);
        }

        return $creatives;
    }

    public function test_single_creative_always_selected(): void
    {
        $today = Carbon::today()->toDateString();

        $pool = $this->createPool([
            ['weight' => 1],
        ]);

        $creative = $pool->first();

        // With a single creative, it should always be returned regardless of history
        $result = $this->selector->select($pool, []);
        $this->assertEquals($creative->id, $result->id);

        // Even with the same creative in history, single pool means no restriction
        $result = $this->selector->select($pool, [$creative->id]);
        $this->assertEquals($creative->id, $result->id);
    }

    public function test_never_repeats_consecutively_with_two_creatives(): void
    {
        $today = Carbon::today()->toDateString();

        $pool = $this->createPool([
            ['weight' => 1],
            ['weight' => 1],
        ]);

        $firstId = $pool->first()->id;

        // When the first creative was just played, it should not be selected again
        for ($i = 0; $i < 20; $i++) {
            $result = $this->selector->select($pool, [$firstId]);
            $this->assertNotEquals($firstId, $result->id,
                "Should not repeat the most recent creative consecutively");
        }
    }

    public function test_anti_repetition_window_for_pool_of_three(): void
    {
        $today = Carbon::today()->toDateString();

        $pool = $this->createPool([
            ['weight' => 1],
            ['weight' => 1],
            ['weight' => 1],
        ]);

        $creativeIds = $pool->pluck('id')->toArray();

        // Pool size 3, window = min(3-1, 5) = 2
        // If last 2 creatives were A, B → only C is eligible
        $recentHistory = [$creativeIds[0], $creativeIds[1]];

        for ($i = 0; $i < 20; $i++) {
            $result = $this->selector->select($pool, $recentHistory);
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
            $creativesData[] = ['weight' => 1];
        }

        $pool = $this->createPool($creativesData);
        $creativeIds = $pool->pluck('id')->toArray();

        // Recent history has 5 IDs (the window max)
        $recentHistory = array_slice($creativeIds, 0, 5);

        // The selected creative should be from the remaining 3 (indices 5, 6, 7)
        $eligibleIds = array_slice($creativeIds, 5, 3);

        for ($i = 0; $i < 30; $i++) {
            $result = $this->selector->select($pool, $recentHistory);
            $this->assertContains($result->id, $eligibleIds,
                "With pool of 8 and window of 5, only creatives outside window should be eligible");
        }
    }

    public function test_weighted_selection_respects_relative_probabilities(): void
    {
        $today = Carbon::today()->toDateString();

        // Create one creative with high weight and one with low weight
        $pool = $this->createPool([
            ['weight' => 100],
            ['weight' => 1],
        ]);

        $heavyId = $pool->sortByDesc('weight')->first()->id;

        // Run many selections with empty history — the heavy creative should dominate
        $heavyCount = 0;
        $iterations = 200;

        for ($i = 0; $i < $iterations; $i++) {
            $result = $this->selector->select($pool, []);
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
        $pool = $this->createPool([
            ['weight' => 1],
            ['weight' => 1],
        ]);

        $creativeIds = $pool->pluck('id')->toArray();

        // Even with both in history, window=1 means only first entry is excluded
        $result = $this->selector->select($pool, $creativeIds);
        $this->assertContains($result->id, $creativeIds);
    }

    public function test_empty_history_selects_from_full_pool(): void
    {
        $today = Carbon::today()->toDateString();

        $pool = $this->createPool([
            ['weight' => 1],
            ['weight' => 1],
            ['weight' => 1],
        ]);

        $creativeIds = $pool->pluck('id')->toArray();

        // With empty history, any creative from the pool is valid
        $result = $this->selector->select($pool, []);
        $this->assertContains($result->id, $creativeIds);
    }

    public function test_all_in_history_but_pool_larger_than_window_still_selects(): void
    {
        $today = Carbon::today()->toDateString();

        // Pool of 6, window = min(6-1, 5) = 5
        $creativesData = [];
        for ($i = 0; $i < 6; $i++) {
            $creativesData[] = ['weight' => 1];
        }

        $pool = $this->createPool($creativesData);
        $creativeIds = $pool->pluck('id')->toArray();

        // History contains all 6 IDs but window is only 5
        // So the 6th creative (not in the window of 5 most recent) should be eligible
        $result = $this->selector->select($pool, $creativeIds);
        $this->assertEquals($creativeIds[5], $result->id,
            "When history is full but pool > window, only the creative outside the window should be selected");
    }
}
