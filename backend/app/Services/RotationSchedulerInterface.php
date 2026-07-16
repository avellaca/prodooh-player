<?php

namespace App\Services;

use Illuminate\Support\Collection;

interface RotationSchedulerInterface
{
    /**
     * Calcula las frecuencias de rotación para candidatos de un slot compartido.
     * Aplica ratio ASAP:Uniform según cantidad de creativos activos:
     * - ≤10 creativos: 1 ASAP cada 2 Uniform
     * - >10 creativos: 1 ASAP cada 3 Uniform
     *
     * Si solo existen líneas ASAP (sin Uniform), distribuye por share_weight sin ratio.
     *
     * @param Collection $candidates Líneas que comparten el slot (each item should have: order_line_id, delivery_pace, share_weight)
     * @param int $totalActiveCreatives Total de creativos activos en la pantalla
     * @return array<array{order_line_id: string, frequency: string}>
     */
    public function calculateRotation(Collection $candidates, int $totalActiveCreatives): array;

    /**
     * Distribuye líneas Red_Interna proporcionalmente al share_weight.
     *
     * Cada línea recibe slots proporcionales a su share_weight / total_weight.
     * Usa floor allocation + distribuye remainders a las líneas con mayor peso.
     *
     * @param Collection $redInternaLines Líneas Red_Interna (each item should have: order_line_id, share_weight)
     * @param int $availableSlots Número de slots disponibles para Red_Interna
     * @return array<array{order_line_id: string, slots_assigned: int}>
     */
    public function distributeByWeight(Collection $redInternaLines, int $availableSlots): array;
}
