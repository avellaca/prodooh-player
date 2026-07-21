<?php

namespace Tests\Unit;

use App\Services\SlotAllocator;
use App\Services\SlotAssignment;
use Illuminate\Support\Collection;
use Tests\TestCase;

class SlotAllocatorTest extends TestCase
{
    private SlotAllocator $allocator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->allocator = new SlotAllocator();
    }

    // ─── Helper: build a fake line as object ────────────────────────────────

    private function makeLine(array $attrs): object
    {
        return (object) array_merge([
            'id' => fake()->uuid(),
            'priority_tier' => 'estandar',
            'delivery_pace' => 'uniform',
            'slots_purchased' => null,
        ], $attrs);
    }

    // ─── validatePatrocinioCapacity ─────────────────────────────────────────

    public function test_validate_patrocinio_capacity_returns_null_when_within_limit(): void
    {
        $lines = collect([
            $this->makeLine(['priority_tier' => 'patrocinio', 'slots_purchased' => 2]),
            $this->makeLine(['priority_tier' => 'patrocinio', 'slots_purchased' => 3]),
        ]);

        $result = $this->allocator->validatePatrocinioCapacity($lines, 7);

        $this->assertNull($result);
    }

    public function test_validate_patrocinio_capacity_returns_null_at_exact_limit(): void
    {
        $lines = collect([
            $this->makeLine(['priority_tier' => 'patrocinio', 'slots_purchased' => 3]),
            $this->makeLine(['priority_tier' => 'patrocinio', 'slots_purchased' => 4]),
        ]);

        $result = $this->allocator->validatePatrocinioCapacity($lines, 7);

        $this->assertNull($result);
    }

    public function test_validate_patrocinio_capacity_returns_error_when_exceeds(): void
    {
        $lines = collect([
            $this->makeLine(['priority_tier' => 'patrocinio', 'slots_purchased' => 4]),
            $this->makeLine(['priority_tier' => 'patrocinio', 'slots_purchased' => 4]),
        ]);

        $result = $this->allocator->validatePatrocinioCapacity($lines, 7);

        $this->assertNotNull($result);
        $this->assertStringContainsString('8', $result); // needs 8
        $this->assertStringContainsString('7', $result); // only 7 available
    }

    // ─── allocate: empty cases ──────────────────────────────────────────────

    public function test_allocate_returns_empty_when_no_lines(): void
    {
        $result = $this->allocator->allocate(collect(), 7, 576);

        $this->assertEmpty($result);
    }

    public function test_allocate_returns_empty_when_zero_ad_slots(): void
    {
        $lines = collect([
            $this->makeLine(['priority_tier' => 'estandar']),
        ]);

        $result = $this->allocator->allocate($lines, 0, 576);

        $this->assertEmpty($result);
    }

    // ─── allocate: Patrocinio only ──────────────────────────────────────────

    public function test_allocate_patrocinio_gets_fixed_slots(): void
    {
        $lines = collect([
            $this->makeLine(['id' => 'p1', 'priority_tier' => 'patrocinio', 'slots_purchased' => 2]),
            $this->makeLine(['id' => 'p2', 'priority_tier' => 'patrocinio', 'slots_purchased' => 1]),
        ]);

        $result = $this->allocator->allocate($lines, 7, 576);

        // p1 gets positions 0,1 and p2 gets position 2
        $this->assertCount(3, $result);

        $this->assertInstanceOf(SlotAssignment::class, $result[0]);
        $this->assertEquals(0, $result[0]->position);
        $this->assertEquals('ad', $result[0]->type);
        $this->assertEquals('fixed', $result[0]->strategy);
        $this->assertEquals('p1', $result[0]->candidates[0]['order_line_id']);

        $this->assertEquals(1, $result[1]->position);
        $this->assertEquals('fixed', $result[1]->strategy);
        $this->assertEquals('p1', $result[1]->candidates[0]['order_line_id']);

        $this->assertEquals(2, $result[2]->position);
        $this->assertEquals('fixed', $result[2]->strategy);
        $this->assertEquals('p2', $result[2]->candidates[0]['order_line_id']);
    }

    // ─── allocate: Estandar fills remaining after Patrocinio ────────────────

    public function test_allocate_estandar_fills_remaining_after_patrocinio(): void
    {
        $lines = collect([
            $this->makeLine(['id' => 'p1', 'priority_tier' => 'patrocinio', 'slots_purchased' => 2]),
            $this->makeLine(['id' => 'e1', 'priority_tier' => 'estandar']),
            $this->makeLine(['id' => 'e2', 'priority_tier' => 'estandar']),
        ]);

        $result = $this->allocator->allocate($lines, 5, 576);

        // Patrocinio: 2 slots (positions 0,1)
        // Estandar: 3 remaining, 2 lines → each gets 1 fixed slot (positions 2,3)
        $this->assertCount(4, $result);

        // Patrocinio at 0,1
        $this->assertEquals('p1', $result[0]->candidates[0]['order_line_id']);
        $this->assertEquals('p1', $result[1]->candidates[0]['order_line_id']);

        // Estandar at 2,3
        $this->assertEquals('e1', $result[2]->candidates[0]['order_line_id']);
        $this->assertEquals('fixed', $result[2]->strategy);
        $this->assertEquals('e2', $result[3]->candidates[0]['order_line_id']);
        $this->assertEquals('fixed', $result[3]->strategy);
    }

    // ─── allocate: Estandar round-robin when over-subscribed ────────────────

    public function test_allocate_estandar_round_robin_when_more_lines_than_slots(): void
    {
        $lines = collect([
            $this->makeLine(['id' => 'e1', 'priority_tier' => 'estandar']),
            $this->makeLine(['id' => 'e2', 'priority_tier' => 'estandar']),
            $this->makeLine(['id' => 'e3', 'priority_tier' => 'estandar']),
            $this->makeLine(['id' => 'e4', 'priority_tier' => 'estandar']),
            $this->makeLine(['id' => 'e5', 'priority_tier' => 'estandar']),
        ]);

        $result = $this->allocator->allocate($lines, 3, 576);

        // 5 lines into 3 slots → round_robin distribution
        $this->assertCount(3, $result);

        // All slots should be 'ad' type
        foreach ($result as $assignment) {
            $this->assertEquals('ad', $assignment->type);
        }

        // At least one slot must have round_robin strategy (multiple candidates)
        $roundRobinSlots = array_filter($result, fn ($a) => $a->strategy === 'round_robin');
        $this->assertNotEmpty($roundRobinSlots);

        // Total candidates across all slots should equal 5
        $totalCandidates = array_sum(array_map(fn ($a) => count($a->candidates), $result));
        $this->assertEquals(5, $totalCandidates);
    }

    // ─── allocate: Red_Interna fills remaining ──────────────────────────────

    public function test_allocate_red_interna_fills_remaining_after_estandar(): void
    {
        $lines = collect([
            $this->makeLine(['id' => 'e1', 'priority_tier' => 'estandar']),
            $this->makeLine(['id' => 'ri1', 'priority_tier' => 'red_interna']),
            $this->makeLine(['id' => 'ri2', 'priority_tier' => 'red_interna']),
        ]);

        $result = $this->allocator->allocate($lines, 5, 576);

        // Estandar gets 1 slot (position 0)
        // Red_Interna fills remaining 4 slots equally (weight=1 each → 2 and 2)
        $this->assertCount(5, $result);
        $this->assertEquals('e1', $result[0]->candidates[0]['order_line_id']);

        // Red_interna slots
        $riSlots = array_slice($result, 1);
        $ri1Count = 0;
        $ri2Count = 0;
        foreach ($riSlots as $slot) {
            if ($slot->candidates[0]['order_line_id'] === 'ri1') {
                $ri1Count++;
            } elseif ($slot->candidates[0]['order_line_id'] === 'ri2') {
                $ri2Count++;
            }
        }

        // Equal weight → ri1 gets 2, ri2 gets 2
        $this->assertEquals(2, $ri1Count);
        $this->assertEquals(2, $ri2Count);
    }

    // ─── allocate: Red_Interna excluded when all slots taken ────────────────

    public function test_allocate_red_interna_excluded_when_all_slots_taken(): void
    {
        $lines = collect([
            $this->makeLine(['id' => 'p1', 'priority_tier' => 'patrocinio', 'slots_purchased' => 3]),
            $this->makeLine(['id' => 'e1', 'priority_tier' => 'estandar']),
            $this->makeLine(['id' => 'e2', 'priority_tier' => 'estandar']),
            $this->makeLine(['id' => 'ri1', 'priority_tier' => 'red_interna']),
        ]);

        $result = $this->allocator->allocate($lines, 5, 576);

        // Patrocinio: 3 slots, Estandar: 2 slots → all 5 filled
        $this->assertCount(5, $result);

        // Red_interna should NOT appear
        foreach ($result as $assignment) {
            foreach ($assignment->candidates as $candidate) {
                $this->assertNotEquals('ri1', $candidate['order_line_id']);
            }
        }
    }

    // ─── allocate: full waterfall ───────────────────────────────────────────

    public function test_allocate_full_waterfall_patrocinio_estandar_red_interna(): void
    {
        $lines = collect([
            $this->makeLine(['id' => 'p1', 'priority_tier' => 'patrocinio', 'slots_purchased' => 1]),
            $this->makeLine(['id' => 'e1', 'priority_tier' => 'estandar']),
            $this->makeLine(['id' => 'e2', 'priority_tier' => 'estandar']),
            $this->makeLine(['id' => 'ri1', 'priority_tier' => 'red_interna']),
            $this->makeLine(['id' => 'ri2', 'priority_tier' => 'red_interna']),
        ]);

        $result = $this->allocator->allocate($lines, 7, 576);

        // Patrocinio: 1 slot (position 0)
        // Estandar: 2 lines, 6 remaining → each gets 1 slot (positions 1,2)
        // Red_Interna: 4 remaining, equal weight → ri1 gets 2, ri2 gets 2
        $this->assertCount(7, $result);

        $this->assertEquals('p1', $result[0]->candidates[0]['order_line_id']);
        $this->assertEquals('fixed', $result[0]->strategy);

        $this->assertEquals('e1', $result[1]->candidates[0]['order_line_id']);
        $this->assertEquals('e2', $result[2]->candidates[0]['order_line_id']);
    }

    // ─── allocate: Red_Interna round-robin when over-subscribed ─────────────

    public function test_allocate_red_interna_round_robin_when_more_lines_than_remaining_slots(): void
    {
        $lines = collect([
            $this->makeLine(['id' => 'p1', 'priority_tier' => 'patrocinio', 'slots_purchased' => 1]),
            $this->makeLine(['id' => 'ri1', 'priority_tier' => 'red_interna']),
            $this->makeLine(['id' => 'ri2', 'priority_tier' => 'red_interna']),
            $this->makeLine(['id' => 'ri3', 'priority_tier' => 'red_interna']),
            $this->makeLine(['id' => 'ri4', 'priority_tier' => 'red_interna']),
        ]);

        // 1 patrocinio slot + 4 red_interna lines into 2 remaining slots
        $result = $this->allocator->allocate($lines, 3, 576);

        $this->assertCount(3, $result);

        // Position 0: patrocinio
        $this->assertEquals('p1', $result[0]->candidates[0]['order_line_id']);
        $this->assertEquals('fixed', $result[0]->strategy);

        // Positions 1,2: red_interna with round_robin (4 lines / 2 slots)
        $riSlots = [$result[1], $result[2]];
        foreach ($riSlots as $slot) {
            $this->assertEquals('ad', $slot->type);
            $this->assertEquals('round_robin', $slot->strategy);
            $this->assertCount(2, $slot->candidates);
        }
    }

    // ─── allocate: Patrocinio default slots_purchased = 1 ───────────────────

    public function test_allocate_patrocinio_defaults_to_1_slot_when_null(): void
    {
        $lines = collect([
            $this->makeLine(['id' => 'p1', 'priority_tier' => 'patrocinio', 'slots_purchased' => null]),
        ]);

        $result = $this->allocator->allocate($lines, 5, 576);

        // Default 1 slot purchased
        $this->assertCount(1, $result);
        $this->assertEquals('p1', $result[0]->candidates[0]['order_line_id']);
        $this->assertEquals('fixed', $result[0]->strategy);
    }

    // ─── allocate: positions are sequential ─────────────────────────────────

    public function test_allocate_positions_are_sequential(): void
    {
        $lines = collect([
            $this->makeLine(['id' => 'p1', 'priority_tier' => 'patrocinio', 'slots_purchased' => 2]),
            $this->makeLine(['id' => 'e1', 'priority_tier' => 'estandar']),
            $this->makeLine(['id' => 'ri1', 'priority_tier' => 'red_interna']),
        ]);

        $result = $this->allocator->allocate($lines, 5, 576);

        for ($i = 0; $i < count($result); $i++) {
            $this->assertEquals($i, $result[$i]->position);
        }
    }
}
