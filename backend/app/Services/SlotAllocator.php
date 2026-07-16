<?php

namespace App\Services;

use App\Models\OrderLine;
use Illuminate\Support\Collection;

class SlotAllocator implements SlotAllocatorInterface
{
    /**
     * Asigna líneas a ad_slots siguiendo waterfall:
     * Patrocinio (fixed slots_purchased) → Estandar ASAP → Estandar Uniform → Red_Interna.
     *
     * @param Collection $activeLines Líneas activas para esta pantalla
     * @param int $adSlots Número de ad_slots disponibles
     * @param int $loopsPerDay Iteraciones del loop por día
     * @return array<int, SlotAssignment> Mapa posición → asignación
     */
    public function allocate(Collection $activeLines, int $adSlots, int $loopsPerDay): array
    {
        if ($adSlots <= 0) {
            return [];
        }

        // Group lines by priority tier
        $patrocinioLines = $activeLines->filter(fn ($line) => $this->getTier($line) === 'patrocinio');
        $estandarLines = $activeLines->filter(fn ($line) => $this->getTier($line) === 'estandar');
        $redInternaLines = $activeLines->filter(fn ($line) => $this->getTier($line) === 'red_interna');

        $assignments = [];
        $nextPosition = 0;

        // ─── Phase 1: Patrocinio — fixed guaranteed positions ───────────────
        $nextPosition = $this->allocatePatrocinio($patrocinioLines, $adSlots, $assignments, $nextPosition);

        // ─── Phase 2: Estandar — fill remaining slots ───────────────────────
        $remainingSlots = $adSlots - $nextPosition;
        if ($remainingSlots > 0 && $estandarLines->isNotEmpty()) {
            $nextPosition = $this->allocateEstandar($estandarLines, $remainingSlots, $assignments, $nextPosition);
        }

        // ─── Phase 3: Red_Interna — fill any remaining slots by share_weight ─
        $remainingSlots = $adSlots - $nextPosition;
        if ($remainingSlots > 0 && $redInternaLines->isNotEmpty()) {
            $nextPosition = $this->allocateRedInterna($redInternaLines, $remainingSlots, $assignments, $nextPosition);
        }

        return $assignments;
    }

    /**
     * Valida que las líneas de Patrocinio no excedan ad_slots.
     * Retorna null si OK, o un mensaje de error si hay exceso.
     */
    public function validatePatrocinioCapacity(Collection $patrocinioLines, int $adSlots): ?string
    {
        $totalSlotsPurchased = $this->sumSlotsPurchased($patrocinioLines);

        if ($totalSlotsPurchased > $adSlots) {
            return "Insuficientes ad_slots: se necesitan {$totalSlotsPurchased} slots de Patrocinio pero solo hay {$adSlots} ad_slots disponibles.";
        }

        return null;
    }

    /**
     * Allocate Patrocinio lines: each gets N fixed positions where N = slots_purchased.
     * Strategy is 'fixed' (same creative every iteration).
     *
     * @return int Next available position after patrocinio allocation
     */
    private function allocatePatrocinio(Collection $patrocinioLines, int $adSlots, array &$assignments, int $startPosition): int
    {
        if ($patrocinioLines->isEmpty()) {
            return $startPosition;
        }

        $position = $startPosition;

        foreach ($patrocinioLines as $line) {
            $slotsPurchased = $this->getSlotsPurchased($line);

            for ($i = 0; $i < $slotsPurchased && $position < $adSlots; $i++) {
                $assignments[$position] = new SlotAssignment(
                    position: $position,
                    type: 'ad',
                    strategy: 'fixed',
                    candidates: [$this->buildCandidate($line)],
                );
                $position++;
            }
        }

        return $position;
    }

    /**
     * Allocate Estandar lines (ASAP + Uniform) to remaining slots.
     * If more lines than slots, multiple candidates share a slot with round_robin.
     * If fewer or equal lines than slots, each line gets its own fixed slot.
     *
     * @return int Next available position after estandar allocation
     */
    private function allocateEstandar(Collection $estandarLines, int $remainingSlots, array &$assignments, int $startPosition): int
    {
        $position = $startPosition;
        $lineCount = $estandarLines->count();

        if ($lineCount <= $remainingSlots) {
            // Each line gets its own slot — fixed strategy (one candidate per slot)
            foreach ($estandarLines as $line) {
                $assignments[$position] = new SlotAssignment(
                    position: $position,
                    type: 'ad',
                    strategy: 'fixed',
                    candidates: [$this->buildCandidate($line)],
                );
                $position++;
            }
        } else {
            // More lines than slots: distribute lines across available slots with round_robin
            $slots = $this->distributeLinesToSlots($estandarLines, $remainingSlots);

            foreach ($slots as $slotCandidates) {
                $candidates = $slotCandidates->map(fn ($line) => $this->buildCandidate($line))->values()->all();
                $strategy = count($candidates) > 1 ? 'round_robin' : 'fixed';

                $assignments[$position] = new SlotAssignment(
                    position: $position,
                    type: 'ad',
                    strategy: $strategy,
                    candidates: $candidates,
                );
                $position++;
            }
        }

        return $position;
    }

    /**
     * Allocate Red_Interna lines to remaining slots, distributed proportionally by share_weight.
     * If more lines than slots, multiple candidates share a slot with round_robin.
     *
     * @return int Next available position after red_interna allocation
     */
    private function allocateRedInterna(Collection $redInternaLines, int $remainingSlots, array &$assignments, int $startPosition): int
    {
        $position = $startPosition;
        $lineCount = $redInternaLines->count();

        if ($lineCount <= $remainingSlots) {
            // Distribute slots proportionally by share_weight
            $distribution = $this->distributeByWeight($redInternaLines, $remainingSlots);

            foreach ($distribution as $item) {
                $line = $item['line'];
                $count = $item['count'];

                for ($i = 0; $i < $count && $position < ($startPosition + $remainingSlots); $i++) {
                    $assignments[$position] = new SlotAssignment(
                        position: $position,
                        type: 'ad',
                        strategy: 'fixed',
                        candidates: [$this->buildCandidate($line)],
                    );
                    $position++;
                }
            }
        } else {
            // More lines than slots: distribute lines across slots with round_robin
            $slots = $this->distributeLinesToSlots($redInternaLines, $remainingSlots);

            foreach ($slots as $slotCandidates) {
                $candidates = $slotCandidates->map(fn ($line) => $this->buildCandidate($line))->values()->all();
                $strategy = count($candidates) > 1 ? 'round_robin' : 'fixed';

                $assignments[$position] = new SlotAssignment(
                    position: $position,
                    type: 'ad',
                    strategy: $strategy,
                    candidates: $candidates,
                );
                $position++;
            }
        }

        return $position;
    }

    /**
     * Distribute lines proportionally by share_weight across available slots.
     * Uses largest remainder method for fair integer distribution.
     *
     * @return array<array{line: mixed, count: int}>
     */
    private function distributeByWeight(Collection $lines, int $totalSlots): array
    {
        $totalWeight = $lines->sum(fn ($line) => $this->getShareWeight($line));

        if ($totalWeight <= 0) {
            // Equal distribution if no weights defined
            return $this->distributeEqually($lines, $totalSlots);
        }

        $distribution = [];
        $remainders = [];

        foreach ($lines as $index => $line) {
            $weight = $this->getShareWeight($line);
            $exactShare = ($weight / $totalWeight) * $totalSlots;
            $baseCount = (int) floor($exactShare);
            $remainder = $exactShare - $baseCount;

            $distribution[] = [
                'line' => $line,
                'count' => $baseCount,
            ];
            $remainders[] = [
                'index' => count($distribution) - 1,
                'remainder' => $remainder,
            ];
        }

        // Distribute remaining slots using largest remainder method
        $allocated = array_sum(array_column($distribution, 'count'));
        $leftover = $totalSlots - $allocated;

        // Sort by remainder descending
        usort($remainders, fn ($a, $b) => $b['remainder'] <=> $a['remainder']);

        for ($i = 0; $i < $leftover && $i < count($remainders); $i++) {
            $distribution[$remainders[$i]['index']]['count']++;
        }

        // Filter out lines with 0 count
        return array_values(array_filter($distribution, fn ($d) => $d['count'] > 0));
    }

    /**
     * Distribute lines equally across slots (fallback when no weights).
     *
     * @return array<array{line: mixed, count: int}>
     */
    private function distributeEqually(Collection $lines, int $totalSlots): array
    {
        $lineCount = $lines->count();
        if ($lineCount === 0) {
            return [];
        }

        $perLine = (int) floor($totalSlots / $lineCount);
        $remainder = $totalSlots - ($perLine * $lineCount);

        $distribution = [];
        $index = 0;
        foreach ($lines as $line) {
            $count = $perLine + ($index < $remainder ? 1 : 0);
            if ($count > 0) {
                $distribution[] = [
                    'line' => $line,
                    'count' => $count,
                ];
            }
            $index++;
        }

        return $distribution;
    }

    /**
     * Distribute more lines than slots across available slots.
     * Each slot gets at least one candidate; extra lines are distributed round-robin.
     *
     * @return Collection<int, Collection> Array of slot → collection of lines
     */
    private function distributeLinesToSlots(Collection $lines, int $numSlots): Collection
    {
        $slots = collect();
        for ($i = 0; $i < $numSlots; $i++) {
            $slots->push(collect());
        }

        // Round-robin assignment of lines to slots
        $lineIndex = 0;
        foreach ($lines as $line) {
            $slotIndex = $lineIndex % $numSlots;
            $slots[$slotIndex]->push($line);
            $lineIndex++;
        }

        return $slots;
    }

    /**
     * Build a candidate array from an order line.
     */
    private function buildCandidate(mixed $line): array
    {
        $id = $this->getLineId($line);

        return [
            'order_line_id' => $id,
        ];
    }

    /**
     * Get the priority tier from a line (supports both model and array/object).
     */
    private function getTier(mixed $line): string
    {
        if ($line instanceof OrderLine) {
            return $line->priority_tier;
        }
        if (is_array($line)) {
            return $line['priority_tier'] ?? '';
        }
        return $line->priority_tier ?? '';
    }

    /**
     * Get slots_purchased from a line, defaulting to 1 for patrocinio.
     */
    private function getSlotsPurchased(mixed $line): int
    {
        if ($line instanceof OrderLine) {
            return $line->slots_purchased ?? 1;
        }
        if (is_array($line)) {
            return $line['slots_purchased'] ?? 1;
        }
        return $line->slots_purchased ?? 1;
    }

    /**
     * Get share_weight from a line, defaulting to 1.
     */
    private function getShareWeight(mixed $line): int
    {
        if ($line instanceof OrderLine) {
            return $line->share_weight ?? 1;
        }
        if (is_array($line)) {
            return $line['share_weight'] ?? 1;
        }
        return $line->share_weight ?? 1;
    }

    /**
     * Get line ID from a line (supports model, array, object).
     */
    private function getLineId(mixed $line): string
    {
        if ($line instanceof OrderLine) {
            return $line->id;
        }
        if (is_array($line)) {
            return $line['id'] ?? '';
        }
        return $line->id ?? '';
    }

    /**
     * Sum all slots_purchased for a collection of patrocinio lines.
     */
    private function sumSlotsPurchased(Collection $lines): int
    {
        return $lines->sum(fn ($line) => $this->getSlotsPurchased($line));
    }
}
