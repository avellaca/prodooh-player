<?php

namespace App\Services;

use App\Models\OrderLine;

interface AvailabilityAnalyzerInterface
{
    /**
     * Analiza si el target_spots de la línea es alcanzable dado el inventario actual.
     * Se ejecuta únicamente al momento de activación, no durante edición en draft.
     */
    public function analyze(OrderLine $line): AvailabilityResult;
}
