<?php

namespace App\Services;

use App\Models\Creative;
use Illuminate\Support\Collection;

interface CreativeSelectorInterface
{
    /**
     * Selecciona un creativo del pool dado con anti-repetición.
     *
     * @param Collection<int, Creative> $pool Pool de creativos activos para hoy
     * @param array<string> $recentHistory IDs recientes (más reciente primero)
     * @return Creative
     */
    public function select(Collection $pool, array $recentHistory): Creative;
}
