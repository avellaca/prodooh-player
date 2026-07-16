<?php

namespace App\Services;

/**
 * Value Object que representa la asignación de un slot.
 */
class SlotAssignment
{
    public function __construct(
        public readonly int $position,
        public readonly string $type,        // 'ad' | 'ssp' | 'playlist'
        public readonly string $strategy,    // 'fixed' | 'round_robin'
        public readonly array $candidates,   // Lista ordenada de candidatos
    ) {}
}
