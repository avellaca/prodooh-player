<?php

namespace App\Services;

class BresenhamInterleaver implements BresenhamInterleaverInterface
{
    /**
     * {@inheritdoc}
     */
    public function interleave(array $entries, int $totalSlots): array
    {
        if ($totalSlots <= 0 || empty($entries)) {
            return [];
        }

        // Filter out entries with count = 0
        $entries = array_values(array_filter($entries, fn(array $entry) => ($entry['count'] ?? 0) > 0));

        if (empty($entries)) {
            return [];
        }

        // Build a list of (target_position, order_line_id) sorted by target position.
        // For each entry i with count_i, calculate step_i = T / count_i
        // For each k from 0 to count_i - 1, target position = round(k * step_i)
        $placements = [];

        foreach ($entries as $entry) {
            $orderLineId = $entry['order_line_id'];
            $count = $entry['count'];
            $step = $totalSlots / $count;

            for ($k = 0; $k < $count; $k++) {
                $targetPosition = (int) round($k * $step);
                // Clamp to valid range [0, T-1]
                $targetPosition = min($targetPosition, $totalSlots - 1);
                $placements[] = [
                    'target' => $targetPosition,
                    'order_line_id' => $orderLineId,
                ];
            }
        }

        // Sort by target position (stable sort preserves insertion order for ties)
        usort($placements, function (array $a, array $b) {
            return $a['target'] <=> $b['target'];
        });

        // Assign actual positions resolving collisions with next free position
        $occupied = array_fill(0, $totalSlots, false);
        $result = [];

        foreach ($placements as $placement) {
            $position = $this->findFreePosition($placement['target'], $occupied, $totalSlots);
            $occupied[$position] = true;
            $result[] = [
                'position' => $position,
                'order_line_id' => $placement['order_line_id'],
            ];
        }

        // Sort result by position for output
        usort($result, function (array $a, array $b) {
            return $a['position'] <=> $b['position'];
        });

        return $result;
    }

    /**
     * Find the next free position starting from the target.
     * Wraps around if necessary.
     */
    private function findFreePosition(int $target, array $occupied, int $totalSlots): int
    {
        // Try from target forward
        for ($i = $target; $i < $totalSlots; $i++) {
            if (!$occupied[$i]) {
                return $i;
            }
        }

        // Wrap around from the beginning
        for ($i = 0; $i < $target; $i++) {
            if (!$occupied[$i]) {
                return $i;
            }
        }

        // Should never reach here if sum of counts == totalSlots
        return $target;
    }
}
