<?php

namespace App\Services;

use App\Models\Creative;
use App\Models\OrderLine;

interface CreativeSelectorInterface
{
    /**
     * Selects the creative for a turn of the given order line.
     * Respects weights and anti-repetition rule (window of min(pool_size-1, 5)).
     *
     * @param OrderLine $line
     * @param array<string> $recentHistory Array of recent creative IDs (most recent first)
     * @return Creative
     */
    public function select(OrderLine $line, array $recentHistory): Creative;
}
