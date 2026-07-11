<?php

namespace Tests\Property;

use App\Services\BresenhamInterleaver;
use Eris\Generators;
use Eris\TestTrait;
use PHPUnit\Framework\TestCase;

/**
 * Property 11: Bresenham even distribution
 * Property 12: Interleaver output completeness
 *
 * Feature: 06-player-reingenieria-motor
 *
 * **Validates: Requirements 4.1, 4.2, 4.3**
 */
class BresenhamInterleaverPropertyTest extends TestCase
{
    use TestTrait;

    private BresenhamInterleaver $interleaver;

    protected function setUp(): void
    {
        parent::setUp();
        $this->interleaver = new BresenhamInterleaver();
    }

    /**
     * Property 11: Bresenham even distribution
     *
     * For any set of lines with assigned counts summing to T (total_daily_spots),
     * the interleaver SHALL produce a sequence where each line's appearances are
     * approximately evenly spaced — the maximum gap between consecutive appearances
     * of any line with count_i spots SHALL be ≤ ceil(T / count_i) + numEntries.
     * (The +numEntries accounts for collision resolution drift when multiple lines
     * compete for the same ideal position, cascading forward.)
     *
     * Strategy: Generate random entries (1-10 entries) with random counts summing
     * to a random T (10-200). For each line in the result, find all positions where
     * it appears, calculate gaps between consecutive appearances, and assert the
     * max gap constraint.
     *
     * **Validates: Requirements 4.1, 4.2**
     */
    public function test_bresenham_even_distribution(): void
    {
        $iterations = 100;

        for ($iter = 0; $iter < $iterations; $iter++) {
            // Generate random T between 10 and 200
            $totalSlots = random_int(10, 200);

            // Generate random number of entries (1-10)
            $numEntries = random_int(1, min(10, $totalSlots));

            // Generate random counts that sum to T
            $counts = $this->distributeExactly($totalSlots, $numEntries);

            // Build entries array
            $entries = [];
            for ($i = 0; $i < $numEntries; $i++) {
                $entries[] = [
                    'order_line_id' => "line-{$i}",
                    'count' => $counts[$i],
                ];
            }

            // Filter out zero-count entries (distributeExactly may produce zeros)
            $entries = array_values(array_filter($entries, fn($e) => $e['count'] > 0));

            if (empty($entries)) {
                continue;
            }

            // Recalculate effective total after filtering
            $effectiveTotal = array_sum(array_column($entries, 'count'));

            $result = $this->interleaver->interleave($entries, $effectiveTotal);

            // For each line, verify the even distribution property
            foreach ($entries as $entry) {
                $orderLineId = $entry['order_line_id'];
                $countI = $entry['count'];

                if ($countI <= 1) {
                    // With 0 or 1 appearance, no gap to check
                    continue;
                }

                // Find all positions for this line
                $positions = [];
                foreach ($result as $item) {
                    if ($item['order_line_id'] === $orderLineId) {
                        $positions[] = $item['position'];
                    }
                }
                sort($positions);

                // Calculate max gap between consecutive appearances
                $maxGap = 0;
                for ($j = 1; $j < count($positions); $j++) {
                    $gap = $positions[$j] - $positions[$j - 1];
                    $maxGap = max($maxGap, $gap);
                }

                $numEntries = count($entries);
                $allowedMaxGap = (int) ceil($effectiveTotal / $countI) + $numEntries;

                $this->assertLessThanOrEqual(
                    $allowedMaxGap,
                    $maxGap,
                    "Property 11 violated: line '{$orderLineId}' has max gap {$maxGap}, " .
                    "allowed max is ceil({$effectiveTotal}/{$countI})+{$numEntries} = {$allowedMaxGap}. " .
                    "Iteration {$iter}, T={$effectiveTotal}, count_i={$countI}, " .
                    "positions=" . json_encode($positions) . ", " .
                    "entries=" . json_encode($entries)
                );
            }
        }
    }

    /**
     * Property 12: Interleaver output completeness
     *
     * For any input to the interleaver where lines have counts summing to T,
     * the output SHALL contain exactly T items, use every position from 0 to T-1
     * exactly once, and include exactly count_i appearances for each line i.
     *
     * Strategy: Generate random entries (1-10 entries, counts summing to T where
     * T is 10-200). Verify all three completeness sub-properties.
     *
     * **Validates: Requirements 4.3**
     */
    public function test_interleaver_output_completeness(): void
    {
        $iterations = 100;

        for ($iter = 0; $iter < $iterations; $iter++) {
            // Generate random T between 10 and 200
            $totalSlots = random_int(10, 200);

            // Generate random number of entries (1-10)
            $numEntries = random_int(1, min(10, $totalSlots));

            // Generate random counts that sum to T
            $counts = $this->distributeExactly($totalSlots, $numEntries);

            // Build entries array
            $entries = [];
            for ($i = 0; $i < $numEntries; $i++) {
                $entries[] = [
                    'order_line_id' => "line-{$i}",
                    'count' => $counts[$i],
                ];
            }

            // Filter out zero-count entries
            $nonZeroEntries = array_values(array_filter($entries, fn($e) => $e['count'] > 0));

            if (empty($nonZeroEntries)) {
                continue;
            }

            // The effective total is the sum of non-zero counts
            $effectiveTotal = array_sum(array_column($nonZeroEntries, 'count'));

            $result = $this->interleaver->interleave($entries, $effectiveTotal);

            // Sub-property 12a: Output has exactly T items
            $this->assertCount(
                $effectiveTotal,
                $result,
                "Property 12a violated: output should have exactly {$effectiveTotal} items, " .
                "got " . count($result) . ". Iteration {$iter}, " .
                "entries=" . json_encode($entries)
            );

            // Sub-property 12b: Positions are exactly 0..T-1 (each used once)
            $positions = array_column($result, 'position');
            sort($positions);
            $expectedPositions = range(0, $effectiveTotal - 1);

            $this->assertSame(
                $expectedPositions,
                $positions,
                "Property 12b violated: positions should be exactly 0.." . ($effectiveTotal - 1) . ". " .
                "Iteration {$iter}, got positions=" . json_encode($positions) . ", " .
                "entries=" . json_encode($entries)
            );

            // Sub-property 12c: Each line appears exactly count_i times
            foreach ($nonZeroEntries as $entry) {
                $orderLineId = $entry['order_line_id'];
                $expectedCount = $entry['count'];

                $actualCount = count(array_filter(
                    $result,
                    fn($item) => $item['order_line_id'] === $orderLineId
                ));

                $this->assertSame(
                    $expectedCount,
                    $actualCount,
                    "Property 12c violated: line '{$orderLineId}' should appear {$expectedCount} times, " .
                    "got {$actualCount}. Iteration {$iter}, T={$effectiveTotal}, " .
                    "entries=" . json_encode($entries)
                );
            }
        }
    }

    /**
     * Property 11 (Eris variant): Bresenham even distribution using Eris generators
     *
     * Uses Eris for random generation to complement the loop-based test above.
     *
     * **Validates: Requirements 4.1, 4.2**
     */
    public function test_bresenham_even_distribution_eris(): void
    {
        $this->forAll(
            Generators::choose(10, 100), // totalSlots (T)
            Generators::choose(1, 10)    // numEntries
        )->then(function (int $totalSlots, int $numEntries): void {
            // Clamp numEntries to not exceed totalSlots
            $numEntries = min($numEntries, $totalSlots);

            // Generate counts summing to totalSlots
            $counts = $this->distributeExactly($totalSlots, $numEntries);

            $entries = [];
            for ($i = 0; $i < $numEntries; $i++) {
                $entries[] = [
                    'order_line_id' => "line-{$i}",
                    'count' => $counts[$i],
                ];
            }

            // Filter zeros
            $entries = array_values(array_filter($entries, fn($e) => $e['count'] > 0));
            if (empty($entries)) {
                return;
            }

            $effectiveTotal = array_sum(array_column($entries, 'count'));
            $result = $this->interleaver->interleave($entries, $effectiveTotal);

            foreach ($entries as $entry) {
                $countI = $entry['count'];
                if ($countI <= 1) {
                    continue;
                }

                $positions = [];
                foreach ($result as $item) {
                    if ($item['order_line_id'] === $entry['order_line_id']) {
                        $positions[] = $item['position'];
                    }
                }
                sort($positions);

                $maxGap = 0;
                for ($j = 1; $j < count($positions); $j++) {
                    $maxGap = max($maxGap, $positions[$j] - $positions[$j - 1]);
                }

                $numEntries = count($entries);
                $allowedMaxGap = (int) ceil($effectiveTotal / $countI) + $numEntries;

                $this->assertLessThanOrEqual(
                    $allowedMaxGap,
                    $maxGap,
                    "Even distribution violated for '{$entry['order_line_id']}': " .
                    "max gap {$maxGap} > allowed {$allowedMaxGap}. " .
                    "T={$effectiveTotal}, count_i={$countI}, numEntries={$numEntries}"
                );
            }
        });
    }

    /**
     * Property 12 (Eris variant): Interleaver output completeness using Eris generators
     *
     * Uses Eris for random generation to complement the loop-based test above.
     *
     * **Validates: Requirements 4.3**
     */
    public function test_interleaver_output_completeness_eris(): void
    {
        $this->forAll(
            Generators::choose(10, 100), // totalSlots (T)
            Generators::choose(1, 8)     // numEntries
        )->then(function (int $totalSlots, int $numEntries): void {
            $numEntries = min($numEntries, $totalSlots);

            $counts = $this->distributeExactly($totalSlots, $numEntries);

            $entries = [];
            for ($i = 0; $i < $numEntries; $i++) {
                $entries[] = [
                    'order_line_id' => "line-{$i}",
                    'count' => $counts[$i],
                ];
            }

            $entries = array_values(array_filter($entries, fn($e) => $e['count'] > 0));
            if (empty($entries)) {
                return;
            }

            $effectiveTotal = array_sum(array_column($entries, 'count'));
            $result = $this->interleaver->interleave($entries, $effectiveTotal);

            // Completeness: exactly T items
            $this->assertCount($effectiveTotal, $result);

            // All positions 0..T-1 used exactly once
            $positions = array_column($result, 'position');
            sort($positions);
            $this->assertSame(range(0, $effectiveTotal - 1), $positions);

            // Each line appears count_i times
            foreach ($entries as $entry) {
                $actualCount = count(array_filter(
                    $result,
                    fn($item) => $item['order_line_id'] === $entry['order_line_id']
                ));
                $this->assertSame(
                    $entry['count'],
                    $actualCount,
                    "Line '{$entry['order_line_id']}' expected {$entry['count']} appearances, got {$actualCount}"
                );
            }
        });
    }

    /**
     * Distribute a total into $parts random positive integers that sum exactly to $total.
     *
     * Uses the "stars and bars" method: pick ($parts - 1) cut points from [1, total-1],
     * sort them, and compute differences.
     *
     * @return int[]
     */
    private function distributeExactly(int $total, int $parts): array
    {
        if ($parts === 1) {
            return [$total];
        }

        if ($total < $parts) {
            // Not enough to give each at least 1; give 1 to first $total, 0 to rest
            $result = array_fill(0, $parts, 0);
            for ($i = 0; $i < $total; $i++) {
                $result[$i] = 1;
            }
            shuffle($result);
            return $result;
        }

        // Generate random partition ensuring each part gets at least 1
        // using sorted random cut points in [1, total-1]
        $cuts = [];
        $available = range(1, $total - 1);
        shuffle($available);
        $cuts = array_slice($available, 0, $parts - 1);
        sort($cuts);

        $result = [];
        $prev = 0;
        foreach ($cuts as $cut) {
            $result[] = $cut - $prev;
            $prev = $cut;
        }
        $result[] = $total - $prev;

        return $result;
    }
}
