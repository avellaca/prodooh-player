<?php

namespace App\Services;

use Illuminate\Support\Collection;

interface SlotAllocatorInterface
{
    /**
     * Asigna líneas a ad_slots siguiendo waterfall: Patrocinio > Estandar ASAP > Estandar Uniform > Red_Interna.
     *
     * @param Collection $activeLines Líneas activas para esta pantalla
     * @param int $adSlots Número de ad_slots disponibles
     * @param int $loopsPerDay Iteraciones del loop por día (para calcular frequency)
     * @return array<int, SlotAssignment> Mapa posición → asignación
     */
    public function allocate(Collection $activeLines, int $adSlots, int $loopsPerDay): array;

    /**
     * Valida que las líneas de Patrocinio no excedan ad_slots.
     * Retorna null si OK, o un mensaje de error si hay exceso.
     */
    public function validatePatrocinioCapacity(Collection $patrocinioLines, int $adSlots): ?string;
}
