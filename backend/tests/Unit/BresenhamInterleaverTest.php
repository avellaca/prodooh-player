<?php

namespace Tests\Unit;

use App\Services\BresenhamInterleaver;
use PHPUnit\Framework\TestCase;

class BresenhamInterleaverTest extends TestCase
{
    private BresenhamInterleaver $interleaver;

    protected function setUp(): void
    {
        parent::setUp();
        $this->interleaver = new BresenhamInterleaver();
    }

    public function test_empty_entries_returns_empty_array(): void
    {
        $result = $this->interleaver->interleave([], 10);
        $this->assertSame([], $result);
    }

    public function test_zero_total_slots_returns_empty_array(): void
    {
        $entries = [['order_line_id' => 'line-a', 'count' => 5]];
        $result = $this->interleaver->interleave($entries, 0);
        $this->assertSame([], $result);
    }

    public function test_single_entry_fills_all_positions(): void
    {
        $entries = [['order_line_id' => 'line-a', 'count' => 5]];
        $result = $this->interleaver->interleave($entries, 5);

        $this->assertCount(5, $result);

        // All positions 0-4 should be covered
        $positions = array_column($result, 'position');
        sort($positions);
        $this->assertSame([0, 1, 2, 3, 4], $positions);

        // All entries should be line-a
        foreach ($result as $item) {
            $this->assertSame('line-a', $item['order_line_id']);
        }
    }

    public function test_two_entries_distributed_proportionally(): void
    {
        // Example from req 4.4: 40 of 52 and 12 of 52
        $entries = [
            ['order_line_id' => 'line-a', 'count' => 40],
            ['order_line_id' => 'line-b', 'count' => 12],
        ];
        $result = $this->interleaver->interleave($entries, 52);

        // Must have exactly 52 items
        $this->assertCount(52, $result);

        // Positions must cover 0..51 exactly once
        $positions = array_column($result, 'position');
        sort($positions);
        $this->assertSame(range(0, 51), $positions);

        // Each line must appear the correct number of times
        $countA = count(array_filter($result, fn($item) => $item['order_line_id'] === 'line-a'));
        $countB = count(array_filter($result, fn($item) => $item['order_line_id'] === 'line-b'));
        $this->assertSame(40, $countA);
        $this->assertSame(12, $countB);
    }

    public function test_entries_with_count_zero_are_skipped(): void
    {
        $entries = [
            ['order_line_id' => 'line-a', 'count' => 3],
            ['order_line_id' => 'line-b', 'count' => 0],
            ['order_line_id' => 'line-c', 'count' => 2],
        ];
        $result = $this->interleaver->interleave($entries, 5);

        $this->assertCount(5, $result);

        $countA = count(array_filter($result, fn($item) => $item['order_line_id'] === 'line-a'));
        $countB = count(array_filter($result, fn($item) => $item['order_line_id'] === 'line-b'));
        $countC = count(array_filter($result, fn($item) => $item['order_line_id'] === 'line-c'));

        $this->assertSame(3, $countA);
        $this->assertSame(0, $countB);
        $this->assertSame(2, $countC);
    }

    public function test_even_distribution_no_blocks(): void
    {
        // 3 entries each with 4 spots in a 12-slot day
        $entries = [
            ['order_line_id' => 'line-a', 'count' => 4],
            ['order_line_id' => 'line-b', 'count' => 4],
            ['order_line_id' => 'line-c', 'count' => 4],
        ];
        $result = $this->interleaver->interleave($entries, 12);

        $this->assertCount(12, $result);

        // Verify positions are unique and cover 0..11
        $positions = array_column($result, 'position');
        sort($positions);
        $this->assertSame(range(0, 11), $positions);

        // Verify each line appears exactly 4 times
        foreach (['line-a', 'line-b', 'line-c'] as $lineId) {
            $count = count(array_filter($result, fn($item) => $item['order_line_id'] === $lineId));
            $this->assertSame(4, $count);
        }

        // Verify distribution: max gap between consecutive appearances should be <= ceil(12/4) + 1 = 4
        foreach (['line-a', 'line-b', 'line-c'] as $lineId) {
            $linePositions = array_values(array_map(
                fn($item) => $item['position'],
                array_filter($result, fn($item) => $item['order_line_id'] === $lineId)
            ));
            sort($linePositions);

            for ($i = 1; $i < count($linePositions); $i++) {
                $gap = $linePositions[$i] - $linePositions[$i - 1];
                $this->assertLessThanOrEqual(4, $gap, "Gap too large for $lineId: $gap at positions {$linePositions[$i-1]} and {$linePositions[$i]}");
            }
        }
    }

    public function test_output_sorted_by_position(): void
    {
        $entries = [
            ['order_line_id' => 'line-a', 'count' => 3],
            ['order_line_id' => 'line-b', 'count' => 2],
        ];
        $result = $this->interleaver->interleave($entries, 5);

        // Verify output is sorted by position
        for ($i = 1; $i < count($result); $i++) {
            $this->assertGreaterThan(
                $result[$i - 1]['position'],
                $result[$i]['position'],
                'Output must be sorted by position'
            );
        }
    }

    public function test_result_items_have_correct_structure(): void
    {
        $entries = [['order_line_id' => 'uuid-123', 'count' => 3]];
        $result = $this->interleaver->interleave($entries, 3);

        foreach ($result as $item) {
            $this->assertArrayHasKey('position', $item);
            $this->assertArrayHasKey('order_line_id', $item);
            $this->assertIsInt($item['position']);
            $this->assertIsString($item['order_line_id']);
        }
    }
}
