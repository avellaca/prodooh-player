<?php

namespace Tests\Property;

use App\Services\LoopConfigService;
use Eris\Generators;
use Eris\TestTrait;
use PHPUnit\Framework\TestCase;

/**
 * Property 10: Weight-to-Slot Assignment
 *
 * Generate random source weights summing to N slots; verify slot array has exact counts.
 *
 * **Validates: Requirements 7.2, 7.7**
 */
class WeightToSlotAssignmentPropertyTest extends TestCase
{
    use TestTrait;

    private LoopConfigService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new LoopConfigService();
    }

    /**
     * Property: When source weights sum exactly to the total number of slots,
     * the resulting slot array must contain exactly the specified count for each source.
     *
     * This validates equitable and non-equitable distribution scenarios:
     * - Default 4 slots x 10s with 25% SOV each (Req 7.2)
     * - Non-equitable distribution e.g. 6-slot loop with 3/1/1/1 (Req 7.7)
     *
     * **Validates: Requirements 7.2, 7.7**
     */
    public function test_weights_summing_to_total_produce_exact_slot_counts(): void
    {
        $this->forAll(
            Generators::choose(2, 4),   // number of sources (2 to 4)
            Generators::choose(2, 20)   // total slots in the loop
        )->then(function (int $numSources, int $totalSlots): void {
            $sources = array_slice(LoopConfigService::VALID_SOURCES, 0, $numSources);

            // Generate weights that sum exactly to totalSlots
            $weights = $this->distributeExactly($totalSlots, $numSources);

            $weightMap = [];
            foreach ($sources as $i => $source) {
                $weightMap[$source] = $weights[$i];
            }

            $slots = $this->service->buildFromWeights($weightMap, $totalSlots);

            // Total number of slots must equal totalSlots
            $this->assertCount(
                $totalSlots,
                $slots,
                "buildFromWeights must produce exactly {$totalSlots} slots. " .
                "Weights: " . json_encode($weightMap)
            );

            // Count occurrences of each source
            $sourceCounts = array_count_values(array_column($slots, 'source'));

            foreach ($weightMap as $source => $expectedCount) {
                $actualCount = $sourceCounts[$source] ?? 0;
                $this->assertEquals(
                    $expectedCount,
                    $actualCount,
                    "Source '{$source}' should have exactly {$expectedCount} slots " .
                    "but got {$actualCount}. Weights: " . json_encode($weightMap) .
                    ", totalSlots: {$totalSlots}"
                );
            }
        });
    }

    /**
     * Property: The default equitable configuration (4 slots, 4 sources, equal weight)
     * must produce exactly 1 slot per source (25% SOV each).
     *
     * **Validates: Requirements 7.2**
     */
    public function test_equitable_distribution_gives_equal_slots(): void
    {
        $this->forAll(
            Generators::choose(2, 12) // various loop sizes (must be divisible evenly)
        )->then(function (int $numSources): void {
            // Clamp to valid sources
            $numSources = min($numSources, 4);
            $totalSlots = $numSources; // 1 slot per source for equitable

            $sources = array_slice(LoopConfigService::VALID_SOURCES, 0, $numSources);
            $weightMap = [];
            foreach ($sources as $source) {
                $weightMap[$source] = 1;
            }

            $slots = $this->service->buildFromWeights($weightMap, $totalSlots);

            $this->assertCount($totalSlots, $slots);

            $sourceCounts = array_count_values(array_column($slots, 'source'));

            foreach ($sources as $source) {
                $this->assertEquals(
                    1,
                    $sourceCounts[$source] ?? 0,
                    "Equitable distribution: each source should get exactly 1 slot"
                );
            }
        });
    }

    /**
     * Property: Non-equitable weights that sum to totalSlots produce correct
     * non-uniform distribution. E.g., one source with weight 3 gets 50% of
     * a 6-slot loop.
     *
     * **Validates: Requirements 7.7**
     */
    public function test_non_equitable_distribution_respects_weights(): void
    {
        $this->forAll(
            Generators::choose(4, 12) // total slots
        )->then(function (int $totalSlots): void {
            // Create a dominant source with half the slots
            $dominantWeight = intdiv($totalSlots, 2);
            $remaining = $totalSlots - $dominantWeight;

            // Distribute remaining among other sources (up to 3)
            $otherSources = min(3, $remaining);
            $otherWeights = $this->distributeExactly($remaining, $otherSources);

            $sources = array_slice(LoopConfigService::VALID_SOURCES, 0, $otherSources + 1);
            $weightMap = [$sources[0] => $dominantWeight];
            for ($i = 0; $i < $otherSources; $i++) {
                $weightMap[$sources[$i + 1]] = $otherWeights[$i];
            }

            $slots = $this->service->buildFromWeights($weightMap, $totalSlots);

            $this->assertCount($totalSlots, $slots);

            $sourceCounts = array_count_values(array_column($slots, 'source'));

            // Verify dominant source has correct count
            $this->assertEquals(
                $dominantWeight,
                $sourceCounts[$sources[0]] ?? 0,
                "Dominant source '{$sources[0]}' should have {$dominantWeight} slots in a {$totalSlots}-slot loop"
            );

            // Verify each source has its expected count
            foreach ($weightMap as $source => $expectedCount) {
                $actualCount = $sourceCounts[$source] ?? 0;
                $this->assertEquals(
                    $expectedCount,
                    $actualCount,
                    "Source '{$source}' expected {$expectedCount} slots, got {$actualCount}. " .
                    "Weights: " . json_encode($weightMap)
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
            return $result;
        }

        // Generate random partition using sorted cut points
        $cuts = [];
        for ($i = 0; $i < $parts - 1; $i++) {
            $cuts[] = random_int(1, $total - 1);
        }
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
