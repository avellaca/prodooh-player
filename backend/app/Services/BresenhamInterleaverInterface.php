<?php

namespace App\Services;

interface BresenhamInterleaverInterface
{
    /**
     * Distributes entries across totalSlots positions using Bresenham-style
     * proportional interleaving (anti-block distribution).
     *
     * Each entry specifies an order_line_id and the number of times (count)
     * it should appear. The sum of all counts MUST equal totalSlots.
     *
     * The algorithm spaces each entry's appearances evenly across the full
     * sequence, resolving collisions by placing in the next free position.
     *
     * @param array<array{order_line_id: string, count: int}> $entries
     * @param int $totalSlots
     * @return array<array{position: int, order_line_id: string}>
     */
    public function interleave(array $entries, int $totalSlots): array;
}
