<?php

namespace Tests\Unit;

use App\Services\RotationScheduler;
use Illuminate\Support\Collection;
use Tests\TestCase;

class RotationSchedulerTest extends TestCase
{
    private RotationScheduler $scheduler;

    protected function setUp(): void
    {
        parent::setUp();
        $this->scheduler = new RotationScheduler();
    }

    // ─── calculateRotation: ASAP + Uniform with ≤10 creatives (ratio 1:2) ──

    public function test_asap_uniform_ratio_1_to_2_when_10_or_fewer_creatives(): void
    {
        $candidates = new Collection([
            ['order_line_id' => 'asap-1', 'delivery_pace' => 'asap', 'share_weight' => 10],
            ['order_line_id' => 'uniform-1', 'delivery_pace' => 'uniform', 'share_weight' => 10],
        ]);

        $result = $this->scheduler->calculateRotation($candidates, 8);

        $this->assertCount(2, $result);

        $asapEntry = collect($result)->firstWhere('order_line_id', 'asap-1');
        $uniformEntry = collect($result)->firstWhere('order_line_id', 'uniform-1');

        $this->assertEquals('1/3', $asapEntry['frequency']);
        $this->assertEquals('2/3', $uniformEntry['frequency']);
    }

    public function test_asap_uniform_ratio_at_exactly_10_creatives(): void
    {
        $candidates = new Collection([
            ['order_line_id' => 'asap-1', 'delivery_pace' => 'asap', 'share_weight' => 5],
            ['order_line_id' => 'uniform-1', 'delivery_pace' => 'uniform', 'share_weight' => 5],
        ]);

        $result = $this->scheduler->calculateRotation($candidates, 10);

        $asapEntry = collect($result)->firstWhere('order_line_id', 'asap-1');
        $uniformEntry = collect($result)->firstWhere('order_line_id', 'uniform-1');

        // ≤10 → ratio 1:2 → cycle of 3
        $this->assertEquals('1/3', $asapEntry['frequency']);
        $this->assertEquals('2/3', $uniformEntry['frequency']);
    }

    // ─── calculateRotation: ASAP + Uniform with >10 creatives (ratio 1:3) ──

    public function test_asap_uniform_ratio_1_to_3_when_more_than_10_creatives(): void
    {
        $candidates = new Collection([
            ['order_line_id' => 'asap-1', 'delivery_pace' => 'asap', 'share_weight' => 10],
            ['order_line_id' => 'uniform-1', 'delivery_pace' => 'uniform', 'share_weight' => 10],
            ['order_line_id' => 'uniform-2', 'delivery_pace' => 'uniform', 'share_weight' => 5],
        ]);

        $result = $this->scheduler->calculateRotation($candidates, 11);

        $asapEntry = collect($result)->firstWhere('order_line_id', 'asap-1');
        $uniformEntry1 = collect($result)->firstWhere('order_line_id', 'uniform-1');
        $uniformEntry2 = collect($result)->firstWhere('order_line_id', 'uniform-2');

        // >10 → ratio 1:3 → cycle of 4
        $this->assertEquals('1/4', $asapEntry['frequency']);
        $this->assertEquals('3/4', $uniformEntry1['frequency']);
        $this->assertEquals('3/4', $uniformEntry2['frequency']);
    }

    public function test_multiple_asap_and_uniform_lines_with_many_creatives(): void
    {
        $candidates = new Collection([
            ['order_line_id' => 'asap-1', 'delivery_pace' => 'asap', 'share_weight' => 10],
            ['order_line_id' => 'asap-2', 'delivery_pace' => 'asap', 'share_weight' => 5],
            ['order_line_id' => 'uniform-1', 'delivery_pace' => 'uniform', 'share_weight' => 10],
        ]);

        $result = $this->scheduler->calculateRotation($candidates, 20);

        // >10 → ratio 1:3 → cycle of 4
        $asap1 = collect($result)->firstWhere('order_line_id', 'asap-1');
        $asap2 = collect($result)->firstWhere('order_line_id', 'asap-2');
        $uniform1 = collect($result)->firstWhere('order_line_id', 'uniform-1');

        $this->assertEquals('1/4', $asap1['frequency']);
        $this->assertEquals('1/4', $asap2['frequency']);
        $this->assertEquals('3/4', $uniform1['frequency']);
    }

    // ─── calculateRotation: Only ASAP (no Uniform) → distribute by weight ──

    public function test_only_asap_lines_distributed_by_share_weight(): void
    {
        $candidates = new Collection([
            ['order_line_id' => 'asap-1', 'delivery_pace' => 'asap', 'share_weight' => 3],
            ['order_line_id' => 'asap-2', 'delivery_pace' => 'asap', 'share_weight' => 1],
        ]);

        $result = $this->scheduler->calculateRotation($candidates, 5);

        $asap1 = collect($result)->firstWhere('order_line_id', 'asap-1');
        $asap2 = collect($result)->firstWhere('order_line_id', 'asap-2');

        // Total weight = 4. asap-1 gets 3/4, asap-2 gets 1/4
        $this->assertEquals('3/4', $asap1['frequency']);
        $this->assertEquals('1/4', $asap2['frequency']);
    }

    public function test_only_asap_with_equal_weights(): void
    {
        $candidates = new Collection([
            ['order_line_id' => 'asap-1', 'delivery_pace' => 'asap', 'share_weight' => 5],
            ['order_line_id' => 'asap-2', 'delivery_pace' => 'asap', 'share_weight' => 5],
        ]);

        $result = $this->scheduler->calculateRotation($candidates, 6);

        $asap1 = collect($result)->firstWhere('order_line_id', 'asap-1');
        $asap2 = collect($result)->firstWhere('order_line_id', 'asap-2');

        // Total weight = 10, each gets 5/10 = 1/2
        $this->assertEquals('1/2', $asap1['frequency']);
        $this->assertEquals('1/2', $asap2['frequency']);
    }

    public function test_single_asap_only_line(): void
    {
        $candidates = new Collection([
            ['order_line_id' => 'asap-1', 'delivery_pace' => 'asap', 'share_weight' => 7],
        ]);

        $result = $this->scheduler->calculateRotation($candidates, 3);

        $this->assertCount(1, $result);
        $this->assertEquals('1/1', $result[0]['frequency']);
    }

    // ─── calculateRotation: Only Uniform → distribute equally ───────────────

    public function test_only_uniform_lines_distributed_equally(): void
    {
        $candidates = new Collection([
            ['order_line_id' => 'uniform-1', 'delivery_pace' => 'uniform', 'share_weight' => 10],
            ['order_line_id' => 'uniform-2', 'delivery_pace' => 'uniform', 'share_weight' => 5],
            ['order_line_id' => 'uniform-3', 'delivery_pace' => 'uniform', 'share_weight' => 3],
        ]);

        $result = $this->scheduler->calculateRotation($candidates, 5);

        foreach ($result as $entry) {
            $this->assertEquals('1/3', $entry['frequency']);
        }
    }

    // ─── calculateRotation: Edge cases ──────────────────────────────────────

    public function test_empty_candidates_returns_empty(): void
    {
        $result = $this->scheduler->calculateRotation(new Collection([]), 5);

        $this->assertEmpty($result);
    }

    // ─── distributeByWeight ─────────────────────────────────────────────────

    public function test_distribute_by_weight_proportional_allocation(): void
    {
        $lines = new Collection([
            ['order_line_id' => 'ri-1', 'share_weight' => 3],
            ['order_line_id' => 'ri-2', 'share_weight' => 1],
        ]);

        $result = $this->scheduler->distributeByWeight($lines, 4);

        $ri1 = collect($result)->firstWhere('order_line_id', 'ri-1');
        $ri2 = collect($result)->firstWhere('order_line_id', 'ri-2');

        // 3/4 * 4 = 3, 1/4 * 4 = 1
        $this->assertEquals(3, $ri1['slots_assigned']);
        $this->assertEquals(1, $ri2['slots_assigned']);
    }

    public function test_distribute_by_weight_with_remainder(): void
    {
        $lines = new Collection([
            ['order_line_id' => 'ri-1', 'share_weight' => 2],
            ['order_line_id' => 'ri-2', 'share_weight' => 2],
            ['order_line_id' => 'ri-3', 'share_weight' => 1],
        ]);

        $result = $this->scheduler->distributeByWeight($lines, 7);

        // Total weight = 5, available = 7
        // ri-1: 2/5 * 7 = 2.8 → floor 2, remainder 0.8
        // ri-2: 2/5 * 7 = 2.8 → floor 2, remainder 0.8
        // ri-3: 1/5 * 7 = 1.4 → floor 1, remainder 0.4
        // Allocated: 5, remaining: 2 → give to ri-1 and ri-2 (highest remainders)
        $ri1 = collect($result)->firstWhere('order_line_id', 'ri-1');
        $ri2 = collect($result)->firstWhere('order_line_id', 'ri-2');
        $ri3 = collect($result)->firstWhere('order_line_id', 'ri-3');

        $this->assertEquals(3, $ri1['slots_assigned']);
        $this->assertEquals(3, $ri2['slots_assigned']);
        $this->assertEquals(1, $ri3['slots_assigned']);

        // Total must equal available slots
        $totalAssigned = collect($result)->sum('slots_assigned');
        $this->assertEquals(7, $totalAssigned);
    }

    public function test_distribute_by_weight_single_line(): void
    {
        $lines = new Collection([
            ['order_line_id' => 'ri-1', 'share_weight' => 5],
        ]);

        $result = $this->scheduler->distributeByWeight($lines, 10);

        $this->assertCount(1, $result);
        $this->assertEquals(10, $result[0]['slots_assigned']);
    }

    public function test_distribute_by_weight_equal_weights(): void
    {
        $lines = new Collection([
            ['order_line_id' => 'ri-1', 'share_weight' => 1],
            ['order_line_id' => 'ri-2', 'share_weight' => 1],
        ]);

        $result = $this->scheduler->distributeByWeight($lines, 6);

        $ri1 = collect($result)->firstWhere('order_line_id', 'ri-1');
        $ri2 = collect($result)->firstWhere('order_line_id', 'ri-2');

        $this->assertEquals(3, $ri1['slots_assigned']);
        $this->assertEquals(3, $ri2['slots_assigned']);
    }

    public function test_distribute_by_weight_empty_lines(): void
    {
        $result = $this->scheduler->distributeByWeight(new Collection([]), 5);

        $this->assertEmpty($result);
    }

    public function test_distribute_by_weight_zero_available_slots(): void
    {
        $lines = new Collection([
            ['order_line_id' => 'ri-1', 'share_weight' => 3],
        ]);

        $result = $this->scheduler->distributeByWeight($lines, 0);

        $this->assertEmpty($result);
    }

    public function test_distribute_by_weight_total_assigned_equals_available(): void
    {
        $lines = new Collection([
            ['order_line_id' => 'ri-1', 'share_weight' => 7],
            ['order_line_id' => 'ri-2', 'share_weight' => 3],
            ['order_line_id' => 'ri-3', 'share_weight' => 2],
            ['order_line_id' => 'ri-4', 'share_weight' => 1],
        ]);

        $result = $this->scheduler->distributeByWeight($lines, 10);

        $totalAssigned = collect($result)->sum('slots_assigned');
        $this->assertEquals(10, $totalAssigned);
    }

    public function test_distribute_by_weight_remainder_goes_to_highest_weight(): void
    {
        $lines = new Collection([
            ['order_line_id' => 'ri-heavy', 'share_weight' => 10],
            ['order_line_id' => 'ri-light', 'share_weight' => 1],
        ]);

        $result = $this->scheduler->distributeByWeight($lines, 3);

        // Total weight = 11, available = 3
        // ri-heavy: 10/11 * 3 = 2.727 → floor 2, remainder 0.727
        // ri-light: 1/11 * 3 = 0.272 → floor 0, remainder 0.272
        // Remaining: 1 → goes to ri-heavy (highest remainder)
        $heavy = collect($result)->firstWhere('order_line_id', 'ri-heavy');
        $light = collect($result)->firstWhere('order_line_id', 'ri-light');

        $this->assertEquals(3, $heavy['slots_assigned']);
        $this->assertEquals(0, $light['slots_assigned']);
    }
}
