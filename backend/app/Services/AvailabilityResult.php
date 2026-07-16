<?php

namespace App\Services;

class AvailabilityResult
{
    public function __construct(
        public readonly bool $isSufficient,
        public readonly int $targetSpots,
        public readonly int $availableCapacity,
        public readonly float $saturationPercent,
        public readonly ?string $warningMessage,
    ) {}
}
