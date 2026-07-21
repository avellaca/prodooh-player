<?php

namespace Tests\Property;

use App\Services\RotationScheduler;
use Illuminate\Support\Collection;
use Tests\TestCase;

/**
 * Property-based tests for RotationScheduler.
 *
 * Uses randomized inputs (100 iterations) to verify universal properties
 * about ASAP:Uniform rotation ratio and share_weight distribution.
 *
 * **Validates: Requirements 2.6, 2.7, 2.15**
 */
class RotationSchedulerPropertyTest extends TestCase
{
    private RotationScheduler $scheduler;

    protected function setUp(): void
    {
        parent::setUp();
        $this->scheduler = new RotationScheduler();
    }

    // ─── Property 8: Ratio ASAP:Uniform rotation ────────────────────────────

    /**
     * Property 8a: When ASAP and Uniform lines coexist and total creatives ≤ 10,
     * ASAP lines get frequency "1/3" and Uniform lines get frequency "2/3".
     *
     * For any combination of ASAP and Uniform candidates with totalActiveCreatives ≤ 10,
     * the ratio must be 1:2 (ASAP frequency = 1/(2+1) = "1/3", Uniform = "2/3").
     *
     * **Validates: Requirements 2.6**
     */
    public function test_asap_uniform_ratio_when_total_creatives_lte_10(): void
    {
        for ($i = 0; $i < 100; $i++) {
            // Generate random number of ASAP and Uniform lines (at least 1 of each)
            $asapCount = random_int(1, 5);
            $uniformCount = random_int(1, 5);

            // Total active creatives must be ≤ 10
            $totalActiveCreatives = random_int(1, 10);

            $candidates = $this->buildMixedCandidates($asapCount, $uniformCount);

            $result = $this->scheduler->calculateRotation($candidates, $totalActiveCreatives);

            // Verify we got results for all candidates
            $this->assertCount(
                $asapCount + $uniformCount,
                $result,
                "Property 8a (iter {$i}): Should return frequency for all {$asapCount} ASAP + {$uniformCount} Uniform candidates"
            );

            // Verify ASAP lines get "1/3" frequency
            $asapResults = array_filter($result, fn ($r) => str_starts_with($r['order_line_id'], 'asap-'));
            foreach ($asapResults as $asapResult) {
                $this->assertEquals(
                    '1/3',
                    $asapResult['frequency'],
                    "Property 8a (iter {$i}): ASAP line {$asapResult['order_line_id']} should have frequency '1/3' when total creatives={$totalActiveCreatives} (≤10), got '{$asapResult['frequency']}'"
                );
            }

            // Verify Uniform lines get "2/3" frequency
            $uniformResults = array_filter($result, fn ($r) => str_starts_with($r['order_line_id'], 'uniform-'));
            foreach ($uniformResults as $uniformResult) {
                $this->assertEquals(
                    '2/3',
                    $uniformResult['frequency'],
                    "Property 8a (iter {$i}): Uniform line {$uniformResult['order_line_id']} should have frequency '2/3' when total creatives={$totalActiveCreatives} (≤10), got '{$uniformResult['frequency']}'"
                );
            }
        }
    }

    /**
     * Property 8b: When ASAP and Uniform lines coexist and total creatives > 10,
     * ASAP lines get frequency "1/4" and Uniform lines get frequency "3/4".
     *
     * For any combination of ASAP and Uniform candidates with totalActiveCreatives > 10,
     * the ratio must be 1:3 (ASAP frequency = 1/(3+1) = "1/4", Uniform = "3/4").
     *
     * **Validates: Requirements 2.7**
     */
    public function test_asap_uniform_ratio_when_total_creatives_gt_10(): void
    {
        for ($i = 0; $i < 100; $i++) {
            // Generate random number of ASAP and Uniform lines (at least 1 of each)
            $asapCount = random_int(1, 8);
            $uniformCount = random_int(1, 8);

            // Total active creatives must be > 10
            $totalActiveCreatives = random_int(11, 50);

            $candidates = $this->buildMixedCandidates($asapCount, $uniformCount);

            $result = $this->scheduler->calculateRotation($candidates, $totalActiveCreatives);

            // Verify we got results for all candidates
            $this->assertCount(
                $asapCount + $uniformCount,
                $result,
                "Property 8b (iter {$i}): Should return frequency for all {$asapCount} ASAP + {$uniformCount} Uniform candidates"
            );

            // Verify ASAP lines get "1/4" frequency
            $asapResults = array_filter($result, fn ($r) => str_starts_with($r['order_line_id'], 'asap-'));
            foreach ($asapResults as $asapResult) {
                $this->assertEquals(
                    '1/4',
                    $asapResult['frequency'],
                    "Property 8b (iter {$i}): ASAP line {$asapResult['order_line_id']} should have frequency '1/4' when total creatives={$totalActiveCreatives} (>10), got '{$asapResult['frequency']}'"
                );
            }

            // Verify Uniform lines get "3/4" frequency
            $uniformResults = array_filter($result, fn ($r) => str_starts_with($r['order_line_id'], 'uniform-'));
            foreach ($uniformResults as $uniformResult) {
                $this->assertEquals(
                    '3/4',
                    $uniformResult['frequency'],
                    "Property 8b (iter {$i}): Uniform line {$uniformResult['order_line_id']} should have frequency '3/4' when total creatives={$totalActiveCreatives} (>10), got '{$uniformResult['frequency']}'"
                );
            }
        }
    }

    /**
     * Property 8c: When only ASAP lines exist (no Uniform), distribution is equal
     * since all lines effectively have weight=1.
     *
     * For any set of ASAP-only candidates, each line should get frequency 1/N
     * (where N is the number of ASAP lines), simplified as a fraction.
     *
     * **Validates: Requirements 2.15**
     */
    public function test_asap_only_distributes_equally_without_ratio(): void
    {
        for ($i = 0; $i < 100; $i++) {
            // Generate random number of ASAP lines (no Uniform)
            $asapCount = random_int(1, 6);
            $totalActiveCreatives = random_int(1, 30);

            $candidates = collect();
            for ($j = 0; $j < $asapCount; $j++) {
                $candidates->push([
                    'order_line_id' => "asap-{$j}",
                    'delivery_pace' => 'asap',
                ]);
            }

            $result = $this->scheduler->calculateRotation($candidates, $totalActiveCreatives);

            // Verify we got results for all candidates
            $this->assertCount(
                $asapCount,
                $result,
                "Property 8c (iter {$i}): Should return frequency for all {$asapCount} ASAP candidates"
            );

            // All ASAP lines get equal frequency: 1/N (simplified)
            $gcd = $this->gcd(1, $asapCount);
            $expectedNumerator = (int) (1 / $gcd);
            $expectedDenominator = (int) ($asapCount / $gcd);
            $expectedFrequency = "{$expectedNumerator}/{$expectedDenominator}";

            foreach ($result as $entry) {
                $this->assertEquals(
                    $expectedFrequency,
                    $entry['frequency'],
                    "Property 8c (iter {$i}): ASAP-only line '{$entry['order_line_id']}' " .
                    "should have frequency '{$expectedFrequency}', got '{$entry['frequency']}'"
                );
            }
        }
    }

    /**
     * Property 8d: The threshold boundary is exact — totalActiveCreatives = 10 uses ratio 1:2,
     * totalActiveCreatives = 11 uses ratio 1:3.
     *
     * Tests the boundary condition to ensure the threshold is correctly applied.
     *
     * **Validates: Requirements 2.6, 2.7**
     */
    public function test_threshold_boundary_exactly_at_10_and_11(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $asapCount = random_int(1, 5);
            $uniformCount = random_int(1, 5);
            $candidates = $this->buildMixedCandidates($asapCount, $uniformCount);

            // Test at exactly 10 (should use ratio 1:2 → frequencies "1/3" and "2/3")
            $resultAt10 = $this->scheduler->calculateRotation($candidates, 10);
            $asapAt10 = array_filter($resultAt10, fn ($r) => str_starts_with($r['order_line_id'], 'asap-'));
            foreach ($asapAt10 as $entry) {
                $this->assertEquals(
                    '1/3',
                    $entry['frequency'],
                    "Property 8d (iter {$i}): At threshold=10, ASAP should be '1/3', got '{$entry['frequency']}'"
                );
            }

            // Test at exactly 11 (should use ratio 1:3 → frequencies "1/4" and "3/4")
            $resultAt11 = $this->scheduler->calculateRotation($candidates, 11);
            $asapAt11 = array_filter($resultAt11, fn ($r) => str_starts_with($r['order_line_id'], 'asap-'));
            foreach ($asapAt11 as $entry) {
                $this->assertEquals(
                    '1/4',
                    $entry['frequency'],
                    "Property 8d (iter {$i}): At threshold=11, ASAP should be '1/4', got '{$entry['frequency']}'"
                );
            }
        }
    }

    // ─── Helper Methods ─────────────────────────────────────────────────────

    /**
     * Build a collection with random ASAP and Uniform candidates.
     */
    private function buildMixedCandidates(int $asapCount, int $uniformCount): Collection
    {
        $candidates = collect();

        for ($j = 0; $j < $asapCount; $j++) {
            $candidates->push([
                'order_line_id' => "asap-{$j}",
                'delivery_pace' => 'asap',
            ]);
        }

        for ($j = 0; $j < $uniformCount; $j++) {
            $candidates->push([
                'order_line_id' => "uniform-{$j}",
                'delivery_pace' => 'uniform',
            ]);
        }

        return $candidates;
    }

    /**
     * Calculate the Greatest Common Divisor of two integers.
     */
    private function gcd(int $a, int $b): int
    {
        $a = abs($a);
        $b = abs($b);

        while ($b !== 0) {
            $temp = $b;
            $b = $a % $b;
            $a = $temp;
        }

        return $a ?: 1;
    }
}
