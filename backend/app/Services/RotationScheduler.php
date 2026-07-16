<?php

namespace App\Services;

use Illuminate\Support\Collection;

class RotationScheduler implements RotationSchedulerInterface
{
    /**
     * Threshold for ASAP:Uniform ratio change.
     * ≤10 creatives → ratio 1:2, >10 creatives → ratio 1:3
     */
    private const CREATIVE_THRESHOLD = 10;

    /**
     * {@inheritdoc}
     */
    public function calculateRotation(Collection $candidates, int $totalActiveCreatives): array
    {
        if ($candidates->isEmpty()) {
            return [];
        }

        $asapLines = $candidates->filter(fn ($c) => ($c['delivery_pace'] ?? null) === 'asap');
        $uniformLines = $candidates->filter(fn ($c) => ($c['delivery_pace'] ?? null) === 'uniform');

        // Case 1: Both ASAP and Uniform lines present — apply ratio
        if ($asapLines->isNotEmpty() && $uniformLines->isNotEmpty()) {
            return $this->calculateWithRatio($asapLines, $uniformLines, $totalActiveCreatives);
        }

        // Case 2: Only ASAP lines (no Uniform) — distribute by share_weight without ratio
        if ($asapLines->isNotEmpty() && $uniformLines->isEmpty()) {
            return $this->distributeByShareWeight($asapLines);
        }

        // Case 3: Only Uniform lines — distribute equally
        return $this->distributeEqually($uniformLines);
    }

    /**
     * {@inheritdoc}
     */
    public function distributeByWeight(Collection $redInternaLines, int $availableSlots): array
    {
        if ($redInternaLines->isEmpty() || $availableSlots <= 0) {
            return [];
        }

        $totalWeight = $redInternaLines->sum(fn ($line) => (int) ($line['share_weight'] ?? 1));

        if ($totalWeight <= 0) {
            // Fallback: distribute equally if all weights are 0
            $totalWeight = $redInternaLines->count();
            $redInternaLines = $redInternaLines->map(function ($line) {
                $line['share_weight'] = 1;
                return $line;
            });
        }

        // Floor allocation
        $assignments = [];
        $remainders = [];
        $allocatedSlots = 0;

        foreach ($redInternaLines as $line) {
            $weight = (int) ($line['share_weight'] ?? 1);
            $exactShare = ($weight / $totalWeight) * $availableSlots;
            $floorShare = (int) floor($exactShare);
            $remainder = $exactShare - $floorShare;

            $assignments[] = [
                'order_line_id' => $line['order_line_id'],
                'slots_assigned' => $floorShare,
                'weight' => $weight,
            ];

            $remainders[] = [
                'index' => count($assignments) - 1,
                'remainder' => $remainder,
                'weight' => $weight,
            ];

            $allocatedSlots += $floorShare;
        }

        // Distribute remaining slots to lines with highest remainder, tie-break by weight
        $remainingSlots = $availableSlots - $allocatedSlots;

        if ($remainingSlots > 0) {
            usort($remainders, function ($a, $b) {
                // Sort by remainder descending, then by weight descending for tie-breaking
                $cmp = $b['remainder'] <=> $a['remainder'];
                if ($cmp !== 0) {
                    return $cmp;
                }
                return $b['weight'] <=> $a['weight'];
            });

            for ($i = 0; $i < $remainingSlots && $i < count($remainders); $i++) {
                $idx = $remainders[$i]['index'];
                $assignments[$idx]['slots_assigned']++;
            }
        }

        // Remove internal 'weight' key from output
        return array_map(function ($assignment) {
            return [
                'order_line_id' => $assignment['order_line_id'],
                'slots_assigned' => $assignment['slots_assigned'],
            ];
        }, $assignments);
    }

    /**
     * Calculate rotation with ASAP:Uniform ratio.
     *
     * Ratio determines how often ASAP lines appear relative to Uniform:
     * - ratio=2 means: in a cycle of 3 iterations, ASAP appears 1 time, Uniform appears 2 times
     * - ratio=3 means: in a cycle of 4 iterations, ASAP appears 1 time, Uniform appears 3 times
     *
     * ASAP frequency = "1/(ratio+1)" (e.g., "1/3" for ratio=2, "1/4" for ratio=3)
     * Uniform frequency = "ratio/(ratio+1)" (e.g., "2/3" for ratio=2, "3/4" for ratio=3)
     */
    private function calculateWithRatio(Collection $asapLines, Collection $uniformLines, int $totalActiveCreatives): array
    {
        $ratio = $totalActiveCreatives <= self::CREATIVE_THRESHOLD ? 2 : 3;
        $cycleLength = $ratio + 1; // Total iterations in one cycle

        $result = [];

        // ASAP lines get frequency "1/{cycleLength}"
        // Each ASAP line appears 1 out of every {cycleLength} iterations
        $asapCount = $asapLines->count();
        foreach ($asapLines as $line) {
            $result[] = [
                'order_line_id' => $line['order_line_id'],
                'frequency' => "1/{$cycleLength}",
            ];
        }

        // Uniform lines get frequency "{ratio}/{cycleLength}"
        // Each Uniform line appears {ratio} out of every {cycleLength} iterations
        foreach ($uniformLines as $line) {
            $result[] = [
                'order_line_id' => $line['order_line_id'],
                'frequency' => "{$ratio}/{$cycleLength}",
            ];
        }

        return $result;
    }

    /**
     * Distribute ASAP-only lines by share_weight (no ratio applies).
     *
     * Each line gets a frequency proportional to its share_weight relative to total.
     * Frequency expressed as "{weight}/{total_weight}".
     */
    private function distributeByShareWeight(Collection $lines): array
    {
        $totalWeight = $lines->sum(fn ($line) => (int) ($line['share_weight'] ?? 1));

        if ($totalWeight <= 0) {
            $totalWeight = $lines->count();
        }

        $result = [];

        foreach ($lines as $line) {
            $weight = (int) ($line['share_weight'] ?? 1);
            if ($weight <= 0) {
                $weight = 1;
            }

            // Simplify the fraction
            $gcd = $this->gcd($weight, $totalWeight);
            $numerator = $weight / $gcd;
            $denominator = $totalWeight / $gcd;

            $result[] = [
                'order_line_id' => $line['order_line_id'],
                'frequency' => "{$numerator}/{$denominator}",
            ];
        }

        return $result;
    }

    /**
     * Distribute uniform-only lines equally.
     *
     * Each line gets frequency "1/{count}".
     */
    private function distributeEqually(Collection $lines): array
    {
        $count = $lines->count();

        if ($count === 0) {
            return [];
        }

        $result = [];

        foreach ($lines as $line) {
            $result[] = [
                'order_line_id' => $line['order_line_id'],
                'frequency' => "1/{$count}",
            ];
        }

        return $result;
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
