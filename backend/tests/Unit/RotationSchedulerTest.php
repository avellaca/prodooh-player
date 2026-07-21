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
            ['order_line_id' => 'asap-1', 'delivery_pace' => 'asap'],
            ['order_line_id' => 'uniform-1', 'delivery_pace' => 'uniform'],
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
            ['order_line_id' => 'asap-1', 'delivery_pace' => 'asap'],
            ['order_line_id' => 'uniform-1', 'delivery_pace' => 'uniform'],
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
            ['order_line_id' => 'asap-1', 'delivery_pace' => 'asap'],
            ['order_line_id' => 'uniform-1', 'delivery_pace' => 'uniform'],
            ['order_line_id' => 'uniform-2', 'delivery_pace' => 'uniform'],
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
            ['order_line_id' => 'asap-1', 'delivery_pace' => 'asap'],
            ['order_line_id' => 'asap-2', 'delivery_pace' => 'asap'],
            ['order_line_id' => 'uniform-1', 'delivery_pace' => 'uniform'],
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

    // ─── calculateRotation: Only ASAP (no Uniform) → distribute equally (all weight=1) ──

    public function test_only_asap_lines_distributed_equally(): void
    {
        $candidates = new Collection([
            ['order_line_id' => 'asap-1', 'delivery_pace' => 'asap'],
            ['order_line_id' => 'asap-2', 'delivery_pace' => 'asap'],
        ]);

        $result = $this->scheduler->calculateRotation($candidates, 5);

        $asap1 = collect($result)->firstWhere('order_line_id', 'asap-1');
        $asap2 = collect($result)->firstWhere('order_line_id', 'asap-2');

        // All weight=1 (via ?? 1 fallback). Total weight = 2. Each gets 1/2
        $this->assertEquals('1/2', $asap1['frequency']);
        $this->assertEquals('1/2', $asap2['frequency']);
    }

    public function test_single_asap_only_line(): void
    {
        $candidates = new Collection([
            ['order_line_id' => 'asap-1', 'delivery_pace' => 'asap'],
        ]);

        $result = $this->scheduler->calculateRotation($candidates, 3);

        $this->assertCount(1, $result);
        $this->assertEquals('1/1', $result[0]['frequency']);
    }

    // ─── calculateRotation: Only Uniform → distribute equally ───────────────

    public function test_only_uniform_lines_distributed_equally(): void
    {
        $candidates = new Collection([
            ['order_line_id' => 'uniform-1', 'delivery_pace' => 'uniform'],
            ['order_line_id' => 'uniform-2', 'delivery_pace' => 'uniform'],
            ['order_line_id' => 'uniform-3', 'delivery_pace' => 'uniform'],
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

    // ─── distributeByWeight — all lines have equal weight (1) ────────────────

    public function test_distribute_by_weight_equal_allocation(): void
    {
        $lines = new Collection([
            ['order_line_id' => 'ri-1'],
            ['order_line_id' => 'ri-2'],
        ]);

        $result = $this->scheduler->distributeByWeight($lines, 4);

        $ri1 = collect($result)->firstWhere('order_line_id', 'ri-1');
        $ri2 = collect($result)->firstWhere('order_line_id', 'ri-2');

        // weight=1 each (via ?? 1 fallback). 4 slots / 2 lines = 2 each
        $this->assertEquals(2, $ri1['slots_assigned']);
        $this->assertEquals(2, $ri2['slots_assigned']);
    }

    public function test_distribute_by_weight_with_remainder(): void
    {
        $lines = new Collection([
            ['order_line_id' => 'ri-1'],
            ['order_line_id' => 'ri-2'],
            ['order_line_id' => 'ri-3'],
        ]);

        $result = $this->scheduler->distributeByWeight($lines, 7);

        // Total weight = 3, available = 7
        // Each: 7/3 = 2.33 → floor 2, remainder 0.33 each
        // Allocated: 6, remaining: 1 → give to first line (highest remainder by order)
        $ri1 = collect($result)->firstWhere('order_line_id', 'ri-1');
        $ri2 = collect($result)->firstWhere('order_line_id', 'ri-2');
        $ri3 = collect($result)->firstWhere('order_line_id', 'ri-3');

        // Total must equal available slots
        $totalAssigned = collect($result)->sum('slots_assigned');
        $this->assertEquals(7, $totalAssigned);

        // With equal weights and remainder=1, each gets at least 2
        $this->assertGreaterThanOrEqual(2, $ri1['slots_assigned']);
        $this->assertGreaterThanOrEqual(2, $ri2['slots_assigned']);
        $this->assertGreaterThanOrEqual(2, $ri3['slots_assigned']);
    }

    public function test_distribute_by_weight_single_line(): void
    {
        $lines = new Collection([
            ['order_line_id' => 'ri-1'],
        ]);

        $result = $this->scheduler->distributeByWeight($lines, 10);

        $this->assertCount(1, $result);
        $this->assertEquals(10, $result[0]['slots_assigned']);
    }

    public function test_distribute_by_weight_equal_weights_even_split(): void
    {
        $lines = new Collection([
            ['order_line_id' => 'ri-1'],
            ['order_line_id' => 'ri-2'],
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
            ['order_line_id' => 'ri-1'],
        ]);

        $result = $this->scheduler->distributeByWeight($lines, 0);

        $this->assertEmpty($result);
    }

    public function test_distribute_by_weight_total_assigned_equals_available(): void
    {
        $lines = new Collection([
            ['order_line_id' => 'ri-1'],
            ['order_line_id' => 'ri-2'],
            ['order_line_id' => 'ri-3'],
            ['order_line_id' => 'ri-4'],
        ]);

        $result = $this->scheduler->distributeByWeight($lines, 10);

        $totalAssigned = collect($result)->sum('slots_assigned');
        $this->assertEquals(10, $totalAssigned);
    }
}
