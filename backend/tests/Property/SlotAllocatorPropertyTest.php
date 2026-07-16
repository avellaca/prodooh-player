<?php

namespace Tests\Property;

use App\Services\SlotAllocator;
use App\Services\SlotAssignment;
use Illuminate\Support\Collection;
use Tests\TestCase;

/**
 * Property-based tests for SlotAllocator.
 *
 * Uses randomized inputs (100 iterations) to verify universal properties
 * about waterfall allocation, round-robin over-subscription, and
 * Red_Interna proportional distribution.
 *
 * **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.9, 2.10**
 */
class SlotAllocatorPropertyTest extends TestCase
{
    private SlotAllocator $allocator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->allocator = new SlotAllocator();
    }

    // ─── Helper methods ─────────────────────────────────────────────────────

    private function makeLine(string $id, string $tier, int $slotsPurchased = 1, int $shareWeight = 1): array
    {
        return [
            'id' => $id,
            'priority_tier' => $tier,
            'slots_purchased' => $slotsPurchased,
            'share_weight' => $shareWeight,
        ];
    }

    private function randomTierLines(int $count, string $tier, int $minSlots = 1, int $maxSlots = 3, int $minWeight = 1, int $maxWeight = 10): Collection
    {
        $lines = [];
        for ($i = 0; $i < $count; $i++) {
            $slotsPurchased = ($tier === 'patrocinio') ? random_int($minSlots, $maxSlots) : 1;
            $shareWeight = random_int($minWeight, $maxWeight);
            $lines[] = $this->makeLine("{$tier}-{$i}", $tier, $slotsPurchased, $shareWeight);
        }

        return collect($lines);
    }

    // ─── Property 6: Waterfall allocation with strict priority ──────────────

    /**
     * Property 6a: Patrocinio lines always fill first with fixed strategy.
     *
     * For any set of active lines from multiple tiers, Patrocinio lines must
     * occupy the first positions in the allocation with 'fixed' strategy,
     * consuming exactly their slots_purchased count.
     *
     * **Validates: Requirements 2.2, 2.3**
     */
    public function test_patrocinio_fills_first_with_fixed_strategy(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $adSlots = random_int(3, 20);
            $patrocinioCount = random_int(1, 3);

            // Generate patrocinio lines whose sum doesn't exceed adSlots
            $patrocinioLines = collect();
            $totalSlotsPurchased = 0;
            for ($j = 0; $j < $patrocinioCount; $j++) {
                $maxForThisLine = min(3, $adSlots - $totalSlotsPurchased - ($patrocinioCount - $j - 1));
                if ($maxForThisLine < 1) {
                    break;
                }
                $slots = random_int(1, $maxForThisLine);
                $patrocinioLines->push($this->makeLine("pat-{$j}", 'patrocinio', $slots));
                $totalSlotsPurchased += $slots;
            }

            // Add some estandar and red_interna lines
            $estandarLines = $this->randomTierLines(random_int(0, 3), 'estandar');
            $redInternaLines = $this->randomTierLines(random_int(0, 3), 'red_interna');

            $allLines = $patrocinioLines->merge($estandarLines)->merge($redInternaLines);
            $assignments = $this->allocator->allocate($allLines, $adSlots, 576);

            // Verify patrocinio occupies positions 0..totalSlotsPurchased-1 with 'fixed' strategy
            $patrocinioPositions = 0;
            foreach ($assignments as $position => $assignment) {
                if ($position < $totalSlotsPurchased) {
                    $this->assertEquals(
                        'fixed',
                        $assignment->strategy,
                        "Property 6a (iter {$i}): Patrocinio slot at position {$position} must have 'fixed' strategy"
                    );
                    $this->assertEquals(
                        'ad',
                        $assignment->type,
                        "Property 6a (iter {$i}): Patrocinio slot at position {$position} must be type 'ad'"
                    );
                    // Verify it's a patrocinio line
                    $candidateId = $assignment->candidates[0]['order_line_id'] ?? '';
                    $this->assertStringStartsWith(
                        'pat-',
                        $candidateId,
                        "Property 6a (iter {$i}): Position {$position} should be a Patrocinio line, got '{$candidateId}'"
                    );
                    $patrocinioPositions++;
                }
            }

            $this->assertEquals(
                $totalSlotsPurchased,
                $patrocinioPositions,
                "Property 6a (iter {$i}): Expected {$totalSlotsPurchased} patrocinio positions, got {$patrocinioPositions}"
            );
        }
    }

    /**
     * Property 6b: Estandar fills after Patrocinio, before Red_Interna.
     *
     * For any allocation with all three tiers, Estandar lines occupy positions
     * after Patrocinio and before Red_Interna.
     *
     * **Validates: Requirements 2.2**
     */
    public function test_estandar_fills_after_patrocinio_before_red_interna(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $adSlots = random_int(6, 15);

            // Patrocinio: 1-2 lines, 1 slot each (so we have room)
            $patrocinioLines = $this->randomTierLines(random_int(1, 2), 'patrocinio', 1, 1);
            $totalPatrocinioSlots = $patrocinioLines->sum(fn ($l) => $l['slots_purchased']);

            // Estandar: 1-2 lines (fit in remaining)
            $estandarCount = random_int(1, 2);
            $estandarLines = $this->randomTierLines($estandarCount, 'estandar');

            // Red_Interna: 1-2 lines (fill the rest)
            $redInternaLines = $this->randomTierLines(random_int(1, 2), 'red_interna');

            $allLines = $patrocinioLines->merge($estandarLines)->merge($redInternaLines);
            $assignments = $this->allocator->allocate($allLines, $adSlots, 576);

            // Identify the tier of each position
            $lastPatrocinioPos = -1;
            $firstEstandarPos = PHP_INT_MAX;
            $lastEstandarPos = -1;
            $firstRedInternaPos = PHP_INT_MAX;

            foreach ($assignments as $position => $assignment) {
                $candidateId = $assignment->candidates[0]['order_line_id'] ?? '';

                if (str_starts_with($candidateId, 'pat-')) {
                    $lastPatrocinioPos = max($lastPatrocinioPos, $position);
                } elseif (str_starts_with($candidateId, 'estandar-')) {
                    $firstEstandarPos = min($firstEstandarPos, $position);
                    $lastEstandarPos = max($lastEstandarPos, $position);
                } elseif (str_starts_with($candidateId, 'red_interna-')) {
                    $firstRedInternaPos = min($firstRedInternaPos, $position);
                }
            }

            // Estandar should come after Patrocinio
            if ($lastPatrocinioPos >= 0 && $firstEstandarPos < PHP_INT_MAX) {
                $this->assertGreaterThan(
                    $lastPatrocinioPos,
                    $firstEstandarPos,
                    "Property 6b (iter {$i}): Estandar (first at {$firstEstandarPos}) must come after Patrocinio (last at {$lastPatrocinioPos})"
                );
            }

            // Red_Interna should come after Estandar
            if ($lastEstandarPos >= 0 && $firstRedInternaPos < PHP_INT_MAX) {
                $this->assertGreaterThan(
                    $lastEstandarPos,
                    $firstRedInternaPos,
                    "Property 6b (iter {$i}): Red_Interna (first at {$firstRedInternaPos}) must come after Estandar (last at {$lastEstandarPos})"
                );
            }
        }
    }

    /**
     * Property 6c: validatePatrocinioCapacity rejects when sum of slots_purchased > ad_slots.
     *
     * For any set of Patrocinio lines where the sum of slots_purchased exceeds ad_slots,
     * validatePatrocinioCapacity must return an error message.
     *
     * **Validates: Requirements 2.4**
     */
    public function test_validate_patrocinio_capacity_rejects_when_exceeding_ad_slots(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $adSlots = random_int(1, 10);

            // Generate lines whose sum exceeds ad_slots
            $totalSlots = 0;
            $lines = collect();
            while ($totalSlots <= $adSlots) {
                $slots = random_int(1, 5);
                $lines->push($this->makeLine("pat-{$lines->count()}", 'patrocinio', $slots));
                $totalSlots += $slots;
            }

            $result = $this->allocator->validatePatrocinioCapacity($lines, $adSlots);

            $this->assertNotNull(
                $result,
                "Property 6c (iter {$i}): Should reject when total slots_purchased ({$totalSlots}) > ad_slots ({$adSlots})"
            );
            $this->assertIsString($result);
        }
    }

    /**
     * Property 6d: validatePatrocinioCapacity accepts when sum of slots_purchased <= ad_slots.
     *
     * For any set of Patrocinio lines where the sum of slots_purchased does not exceed ad_slots,
     * validatePatrocinioCapacity must return null (no error).
     *
     * **Validates: Requirements 2.4**
     */
    public function test_validate_patrocinio_capacity_accepts_when_within_ad_slots(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $adSlots = random_int(3, 20);

            // Generate lines whose sum is <= ad_slots
            $totalSlots = 0;
            $lines = collect();
            $lineCount = random_int(1, min(5, $adSlots));
            for ($j = 0; $j < $lineCount; $j++) {
                $maxForThis = $adSlots - $totalSlots - ($lineCount - $j - 1);
                if ($maxForThis < 1) {
                    break;
                }
                $slots = random_int(1, $maxForThis);
                $lines->push($this->makeLine("pat-{$j}", 'patrocinio', $slots));
                $totalSlots += $slots;
            }

            $result = $this->allocator->validatePatrocinioCapacity($lines, $adSlots);

            $this->assertNull(
                $result,
                "Property 6d (iter {$i}): Should accept when total slots_purchased ({$totalSlots}) <= ad_slots ({$adSlots})"
            );
        }
    }

    /**
     * Property 6e: When Patrocinio + Estandar fill all ad_slots, Red_Interna does not appear.
     *
     * For any allocation where Patrocinio + Estandar lines consume all available ad_slots,
     * Red_Interna lines must not appear in the result.
     *
     * **Validates: Requirements 2.9**
     */
    public function test_red_interna_excluded_when_higher_tiers_fill_all_slots(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $adSlots = random_int(2, 10);

            // Patrocinio takes some slots
            $patrocinioSlots = random_int(1, $adSlots - 1);
            $patrocinioLines = collect([$this->makeLine('pat-0', 'patrocinio', $patrocinioSlots)]);

            // Estandar fills the rest
            $remainingForEstandar = $adSlots - $patrocinioSlots;
            $estandarLines = $this->randomTierLines($remainingForEstandar, 'estandar');

            // Red_Interna present but should not appear
            $redInternaLines = $this->randomTierLines(random_int(1, 3), 'red_interna');

            $allLines = $patrocinioLines->merge($estandarLines)->merge($redInternaLines);
            $assignments = $this->allocator->allocate($allLines, $adSlots, 576);

            // Verify no red_interna in assignments
            foreach ($assignments as $position => $assignment) {
                foreach ($assignment->candidates as $candidate) {
                    $this->assertFalse(
                        str_starts_with($candidate['order_line_id'], 'red_interna-'),
                        "Property 6e (iter {$i}): Red_Interna should not appear when higher tiers fill all {$adSlots} ad_slots. Found at position {$position}."
                    );
                }
            }
        }
    }

    // ─── Property 7: Round-robin when tier is over-subscribed ────────────────

    /**
     * Property 7a: When more Estandar lines than remaining slots, all lines appear as candidates with round_robin.
     *
     * For any situation where the number of Estandar lines exceeds the remaining
     * ad_slots for that tier, the template must assign multiple candidates per slot
     * with 'round_robin' strategy (slots with >1 candidate), and all lines must appear
     * in the result. Some slots may get only 1 candidate (fixed) depending on distribution.
     *
     * **Validates: Requirements 2.5**
     */
    public function test_round_robin_when_estandar_oversubscribed(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $adSlots = random_int(2, 8);
            // No patrocinio, so estandar gets all ad_slots
            // Ensure at least 2x slots so every slot gets multiple candidates
            $estandarCount = random_int($adSlots * 2, $adSlots * 3);
            $estandarLines = $this->randomTierLines($estandarCount, 'estandar');

            $assignments = $this->allocator->allocate($estandarLines, $adSlots, 576);

            // Verify all lines appear as candidates across all slots
            $allCandidateIds = [];
            $hasRoundRobin = false;

            foreach ($assignments as $position => $assignment) {
                foreach ($assignment->candidates as $candidate) {
                    $allCandidateIds[] = $candidate['order_line_id'];
                }

                if (count($assignment->candidates) > 1) {
                    $hasRoundRobin = true;
                    $this->assertEquals(
                        'round_robin',
                        $assignment->strategy,
                        "Property 7a (iter {$i}): Position {$position} with multiple candidates should use 'round_robin'"
                    );
                }
            }

            // With 2x+ lines vs slots, at least one slot must have round_robin
            $this->assertTrue(
                $hasRoundRobin,
                "Property 7a (iter {$i}): With {$estandarCount} lines > {$adSlots} slots, at least one slot must use round_robin"
            );

            // Verify all estandar lines appear in at least one slot
            $uniqueIds = array_unique($allCandidateIds);
            foreach ($estandarLines as $line) {
                $this->assertContains(
                    $line['id'],
                    $uniqueIds,
                    "Property 7a (iter {$i}): Estandar line '{$line['id']}' should appear as a candidate"
                );
            }
        }
    }

    /**
     * Property 7b: When more Red_Interna lines than remaining slots, all lines appear as candidates with round_robin.
     *
     * For any situation where Red_Interna lines exceed remaining ad_slots after Patrocinio/Estandar,
     * the template must assign multiple candidates per slot with 'round_robin' strategy (for slots
     * with >1 candidate), and all lines must appear in the result.
     *
     * **Validates: Requirements 2.5**
     */
    public function test_round_robin_when_red_interna_oversubscribed(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $adSlots = random_int(2, 8);
            // No other tiers, so red_interna gets all ad_slots
            // Ensure at least 2x slots so every slot gets multiple candidates
            $redInternaCount = random_int($adSlots * 2, $adSlots * 3);
            $redInternaLines = $this->randomTierLines($redInternaCount, 'red_interna');

            $assignments = $this->allocator->allocate($redInternaLines, $adSlots, 576);

            // Verify all lines appear as candidates
            $allCandidateIds = [];
            $hasRoundRobin = false;

            foreach ($assignments as $position => $assignment) {
                foreach ($assignment->candidates as $candidate) {
                    $allCandidateIds[] = $candidate['order_line_id'];
                }

                if (count($assignment->candidates) > 1) {
                    $hasRoundRobin = true;
                    $this->assertEquals(
                        'round_robin',
                        $assignment->strategy,
                        "Property 7b (iter {$i}): Position {$position} with multiple candidates should use 'round_robin'"
                    );
                }
            }

            // With 2x+ lines vs slots, at least one slot must have round_robin
            $this->assertTrue(
                $hasRoundRobin,
                "Property 7b (iter {$i}): With {$redInternaCount} Red_Interna lines > {$adSlots} slots, at least one slot must use round_robin"
            );

            // Verify all red_interna lines appear in at least one slot
            $uniqueIds = array_unique($allCandidateIds);
            foreach ($redInternaLines as $line) {
                $this->assertContains(
                    $line['id'],
                    $uniqueIds,
                    "Property 7b (iter {$i}): Red_Interna line '{$line['id']}' should appear as a candidate"
                );
            }
        }
    }

    /**
     * Property 7c: When lines equal or fewer than slots, strategy is 'fixed' (no round-robin needed).
     *
     * For any situation where the number of lines of a tier is <= available slots,
     * each line gets its own slot with 'fixed' strategy.
     *
     * **Validates: Requirements 2.5**
     */
    public function test_fixed_strategy_when_lines_fit_in_slots(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $adSlots = random_int(3, 15);
            // Estandar count <= ad_slots
            $estandarCount = random_int(1, $adSlots);
            $estandarLines = $this->randomTierLines($estandarCount, 'estandar');

            $assignments = $this->allocator->allocate($estandarLines, $adSlots, 576);

            // Each estandar line should have its own fixed slot
            $estandarAssignments = array_filter($assignments, function ($a) {
                return isset($a->candidates[0]['order_line_id']) &&
                    str_starts_with($a->candidates[0]['order_line_id'], 'estandar-');
            });

            foreach ($estandarAssignments as $position => $assignment) {
                $this->assertEquals(
                    'fixed',
                    $assignment->strategy,
                    "Property 7c (iter {$i}): Position {$position} should use 'fixed' when {$estandarCount} lines <= {$adSlots} slots"
                );
                $this->assertCount(
                    1,
                    $assignment->candidates,
                    "Property 7c (iter {$i}): Position {$position} should have exactly 1 candidate with 'fixed' strategy"
                );
            }
        }
    }

    // ─── Property 9: Red_Interna proportional distribution by share_weight ──

    /**
     * Property 9a: Red_Interna slots are distributed proportionally to share_weight.
     *
     * For any set of Red_Interna lines with random share_weights filling available slots,
     * the number of slots each line receives must be proportional to its share_weight
     * (within rounding tolerance of ±1 slot due to integer distribution).
     *
     * **Validates: Requirements 2.10**
     */
    public function test_red_interna_proportional_distribution_by_share_weight(): void
    {
        for ($i = 0; $i < 100; $i++) {
            // Generate enough slots so distribution is meaningful
            $adSlots = random_int(4, 20);
            $redInternaCount = random_int(2, min(4, $adSlots));

            // Create lines with distinct share_weights
            $lines = collect();
            for ($j = 0; $j < $redInternaCount; $j++) {
                $weight = random_int(1, 10);
                $lines->push($this->makeLine("red_interna-{$j}", 'red_interna', 1, $weight));
            }

            // Only Red_Interna — they get all ad_slots
            $assignments = $this->allocator->allocate($lines, $adSlots, 576);

            // Count how many slots each line received
            $slotCounts = [];
            foreach ($lines as $line) {
                $slotCounts[$line['id']] = 0;
            }

            foreach ($assignments as $assignment) {
                // For fixed strategy, count the single candidate
                if ($assignment->strategy === 'fixed') {
                    $id = $assignment->candidates[0]['order_line_id'] ?? '';
                    if (isset($slotCounts[$id])) {
                        $slotCounts[$id]++;
                    }
                }
            }

            // Verify proportionality within rounding tolerance
            $totalWeight = $lines->sum(fn ($l) => $l['share_weight']);
            $totalAssigned = array_sum($slotCounts);

            foreach ($lines as $line) {
                $expectedExact = ($line['share_weight'] / $totalWeight) * $totalAssigned;
                $actual = $slotCounts[$line['id']];

                // Allow ±1 slot tolerance for integer rounding (largest remainder method)
                $this->assertGreaterThanOrEqual(
                    floor($expectedExact) - 1,
                    $actual,
                    "Property 9a (iter {$i}): Line '{$line['id']}' (weight={$line['share_weight']}) got {$actual} slots, " .
                    "expected ~" . round($expectedExact, 2) . " (floor-1=" . (floor($expectedExact) - 1) . ")"
                );
                $this->assertLessThanOrEqual(
                    ceil($expectedExact) + 1,
                    $actual,
                    "Property 9a (iter {$i}): Line '{$line['id']}' (weight={$line['share_weight']}) got {$actual} slots, " .
                    "expected ~" . round($expectedExact, 2) . " (ceil+1=" . (ceil($expectedExact) + 1) . ")"
                );
            }
        }
    }

    /**
     * Property 9b: Total Red_Interna slots assigned equals available slots.
     *
     * For any allocation where only Red_Interna lines exist, the total number of
     * assigned slots must equal ad_slots (all available capacity is used).
     *
     * **Validates: Requirements 2.10**
     */
    public function test_red_interna_uses_all_available_slots(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $adSlots = random_int(2, 15);
            $redInternaCount = random_int(1, min($adSlots, 5));
            $lines = collect();
            for ($j = 0; $j < $redInternaCount; $j++) {
                $weight = random_int(1, 10);
                $lines->push($this->makeLine("red_interna-{$j}", 'red_interna', 1, $weight));
            }

            $assignments = $this->allocator->allocate($lines, $adSlots, 576);

            $this->assertCount(
                $adSlots,
                $assignments,
                "Property 9b (iter {$i}): Red_Interna should use all {$adSlots} available slots when no other tiers, got " . count($assignments)
            );
        }
    }

    /**
     * Property 9c: Higher share_weight lines get equal or more slots than lower weight lines.
     *
     * For any two Red_Interna lines where weight_A > weight_B, line A must receive
     * >= slots than line B (within the constraints of integer rounding).
     *
     * **Validates: Requirements 2.10**
     */
    public function test_higher_share_weight_gets_more_or_equal_slots(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $adSlots = random_int(4, 20);

            // Create exactly 2 lines with different weights
            $weightA = random_int(5, 10);
            $weightB = random_int(1, 4);  // Always less than A

            $lines = collect([
                $this->makeLine('red_interna-high', 'red_interna', 1, $weightA),
                $this->makeLine('red_interna-low', 'red_interna', 1, $weightB),
            ]);

            $assignments = $this->allocator->allocate($lines, $adSlots, 576);

            // Count slots for each
            $highCount = 0;
            $lowCount = 0;
            foreach ($assignments as $assignment) {
                if ($assignment->strategy === 'fixed') {
                    $id = $assignment->candidates[0]['order_line_id'] ?? '';
                    if ($id === 'red_interna-high') {
                        $highCount++;
                    } elseif ($id === 'red_interna-low') {
                        $lowCount++;
                    }
                }
            }

            $this->assertGreaterThanOrEqual(
                $lowCount,
                $highCount,
                "Property 9c (iter {$i}): Line with weight {$weightA} got {$highCount} slots, " .
                "line with weight {$weightB} got {$lowCount} slots. Higher weight should get >= slots."
            );
        }
    }
}
