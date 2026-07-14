<?php

namespace App\Services;

use App\Models\Creative;
use Illuminate\Support\Collection;

class CreativeSelector implements CreativeSelectorInterface
{
    /**
     * Selecciona un creativo del pool dado con anti-repetición.
     *
     * Respects weights and anti-repetition rule (window of min(pool_size-1, 5)).
     * The pool is expected to already be filtered to valid/active creatives.
     *
     * @param Collection<int, Creative> $pool Pool de creativos activos
     * @param array<string> $recentHistory IDs recientes (más reciente primero)
     * @return Creative
     */
    public function select(Collection $pool, array $recentHistory): Creative
    {
        // Pool of 1 creative: no anti-repetition restriction
        if ($pool->count() === 1) {
            return $pool->first();
        }

        // Calculate anti-repetition window size: min(pool_size - 1, 5)
        $windowSize = min($pool->count() - 1, 5);

        // Get the IDs to exclude based on the anti-repetition window
        $excludedIds = array_slice($recentHistory, 0, $windowSize);

        // Filter eligible creatives (pool minus excluded)
        $eligible = $pool->filter(function (Creative $creative) use ($excludedIds) {
            return !in_array($creative->id, $excludedIds);
        });

        // Edge case: if all creatives are excluded, fall back to full pool
        if ($eligible->isEmpty()) {
            $eligible = $pool;
        }

        return $this->weightedRandomSelect($eligible);
    }

    /**
     * Select a creative using weighted random selection.
     * Probability of selecting creative_j = weight_j / sum(weights).
     *
     * @param Collection<int, Creative> $creatives
     * @return Creative
     */
    protected function weightedRandomSelect(Collection $creatives): Creative
    {
        $totalWeight = $creatives->sum('weight');

        // Edge case: all weights are 0, select uniformly
        if ($totalWeight <= 0) {
            return $creatives->random();
        }

        $random = mt_rand(1, $totalWeight);
        $cumulative = 0;

        foreach ($creatives as $creative) {
            $cumulative += $creative->weight;
            if ($random <= $cumulative) {
                return $creative;
            }
        }

        // Fallback (should not reach here)
        return $creatives->last();
    }
}
