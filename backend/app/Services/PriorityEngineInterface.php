<?php

namespace App\Services;

use App\Models\OrderLine;
use App\Models\Screen;
use Illuminate\Support\Collection;

interface PriorityEngineInterface
{
    /**
     * Recalcula el manifiesto para una pantalla.
     * Usa total_daily_spots en rollover diario, o capacidad_restante en recálculo intra-día.
     */
    public function recalculate(string $screenId, bool $isIntraDay = false): array;

    /**
     * Calcula total_daily_spots para una pantalla.
     * Fórmula: floor(window_seconds / duration_seconds)
     */
    public function calculateTotalDailySpots(Screen $screen): int;

    /**
     * Calcula daily_budget para una línea de pedido.
     * uniform → ceil((target - delivered) / remaining_days)
     * asap → target - delivered
     * null target → null
     */
    public function calculateDailyBudget(OrderLine $line): ?int;

    /**
     * Filtra las líneas activas que aplican a una pantalla dada hoy.
     *
     * @return Collection<int, OrderLine>
     */
    public function filterActiveLines(Screen $screen): Collection;
}
