<?php

namespace Tests\Property;

use App\Models\Order;
use App\Models\OrderLine;
use App\Observers\OrderLineObserver;
use App\Services\AuditServiceInterface;
use App\Services\DateContainmentValidator;
use App\Services\LoopTemplateGeneratorInterface;
use Tests\TestCase;

/**
 * Property-based test for pace enforcement in OrderLineObserver.
 *
 * Uses randomized inputs (100 iterations) to verify Property 11:
 * Pace forced by tier — For any OrderLine: if priority_tier is "patrocinio" or "red_interna",
 * delivery_pace must be "uniform" regardless of input. If priority_tier is "estandar",
 * delivery_pace must be the user-specified value (asap or uniform).
 *
 * **Validates: Requirements 3.1, 3.2, 3.3**
 */
class PaceEnforcementPropertyTest extends TestCase
{
    private OrderLineObserver $observer;

    /** All valid priority tiers in the system */
    private const PRIORITY_TIERS = ['patrocinio', 'estandar', 'red_interna'];

    /** All possible delivery_pace values (including invalid ones for robustness) */
    private const PACE_VALUES = ['asap', 'uniform', 'fast', 'slow', 'invalid', '', 'random'];

    protected function setUp(): void
    {
        parent::setUp();
        $generator = $this->createMock(LoopTemplateGeneratorInterface::class);
        $auditService = $this->createMock(AuditServiceInterface::class);
        $this->observer = new OrderLineObserver(new DateContainmentValidator(), $generator, $auditService);
    }

    /**
     * Helper to create an OrderLine with given tier and pace without persisting.
     */
    private function makeOrderLine(string $priorityTier, string $deliveryPace): OrderLine
    {
        $orderLine = new OrderLine();
        $orderLine->order_id = fake()->uuid();
        $orderLine->name = 'Test Line ' . fake()->word();
        $orderLine->priority_tier = $priorityTier;
        $orderLine->delivery_pace = $deliveryPace;
        $orderLine->starts_at = '2025-01-01';
        $orderLine->ends_at = '2025-12-31';
        $orderLine->target_spots = random_int(1, 10000);
        $orderLine->share_weight = random_int(1, 100);
        $orderLine->setRelation('order', new Order());

        return $orderLine;
    }

    // ─── Property 11: Pace forced by tier ───────────────────────────────────

    /**
     * Property 11a: For any OrderLine with priority_tier "patrocinio" or "red_interna",
     * after the creating hook, delivery_pace MUST be "uniform" regardless of the input pace.
     *
     * **Validates: Requirements 3.1, 3.2**
     */
    public function test_patrocinio_and_red_interna_always_force_uniform_on_creating(): void
    {
        $forcedTiers = ['patrocinio', 'red_interna'];

        for ($i = 0; $i < 100; $i++) {
            // Random forced tier
            $tier = $forcedTiers[array_rand($forcedTiers)];
            // Random pace value (including valid and invalid)
            $inputPace = self::PACE_VALUES[array_rand(self::PACE_VALUES)];

            $orderLine = $this->makeOrderLine($tier, $inputPace);

            $this->observer->creating($orderLine);

            $this->assertEquals(
                'uniform',
                $orderLine->delivery_pace,
                "Property 11a (iter {$i}): priority_tier='{$tier}' with input pace='{$inputPace}' " .
                "must have delivery_pace forced to 'uniform' after creating hook, " .
                "got '{$orderLine->delivery_pace}'"
            );
        }
    }

    /**
     * Property 11b: For any OrderLine with priority_tier "patrocinio" or "red_interna",
     * after the updating hook, delivery_pace MUST be "uniform" regardless of the input pace.
     *
     * **Validates: Requirements 3.1, 3.2**
     */
    public function test_patrocinio_and_red_interna_always_force_uniform_on_updating(): void
    {
        $forcedTiers = ['patrocinio', 'red_interna'];

        for ($i = 0; $i < 100; $i++) {
            $tier = $forcedTiers[array_rand($forcedTiers)];
            $inputPace = self::PACE_VALUES[array_rand(self::PACE_VALUES)];

            // Create an order line and sync original state
            $orderLine = $this->makeOrderLine($tier, 'uniform');
            $orderLine->syncOriginal();

            // Simulate updating to a random pace
            $orderLine->delivery_pace = $inputPace;

            $this->observer->updating($orderLine);

            $this->assertEquals(
                'uniform',
                $orderLine->delivery_pace,
                "Property 11b (iter {$i}): priority_tier='{$tier}' updated with pace='{$inputPace}' " .
                "must have delivery_pace forced to 'uniform' after updating hook, " .
                "got '{$orderLine->delivery_pace}'"
            );
        }
    }

    /**
     * Property 11c: For any OrderLine with priority_tier "estandar",
     * after the creating hook, delivery_pace MUST be the user-specified value
     * when the value is "asap" or "uniform".
     *
     * **Validates: Requirements 3.3**
     */
    public function test_estandar_preserves_valid_user_specified_pace_on_creating(): void
    {
        $validPaces = ['asap', 'uniform'];

        for ($i = 0; $i < 100; $i++) {
            $inputPace = $validPaces[array_rand($validPaces)];

            $orderLine = $this->makeOrderLine('estandar', $inputPace);

            $this->observer->creating($orderLine);

            $this->assertEquals(
                $inputPace,
                $orderLine->delivery_pace,
                "Property 11c (iter {$i}): priority_tier='estandar' with valid pace='{$inputPace}' " .
                "must preserve user-specified value after creating hook, " .
                "got '{$orderLine->delivery_pace}'"
            );
        }
    }

    /**
     * Property 11d: For any OrderLine with priority_tier "estandar",
     * after the updating hook, delivery_pace MUST be the user-specified value
     * when the value is "asap" or "uniform".
     *
     * **Validates: Requirements 3.3**
     */
    public function test_estandar_preserves_valid_user_specified_pace_on_updating(): void
    {
        $validPaces = ['asap', 'uniform'];

        for ($i = 0; $i < 100; $i++) {
            $inputPace = $validPaces[array_rand($validPaces)];

            $orderLine = $this->makeOrderLine('estandar', 'uniform');
            $orderLine->syncOriginal();
            $orderLine->delivery_pace = $inputPace;

            $this->observer->updating($orderLine);

            $this->assertEquals(
                $inputPace,
                $orderLine->delivery_pace,
                "Property 11d (iter {$i}): priority_tier='estandar' updated with valid pace='{$inputPace}' " .
                "must preserve user-specified value after updating hook, " .
                "got '{$orderLine->delivery_pace}'"
            );
        }
    }

    /**
     * Property 11e: Combined property — For any random combination of priority_tier
     * and delivery_pace, the observer enforces the correct outcome universally.
     *
     * This test generates fully random OrderLines and verifies the property holds
     * across all possible tier/pace combinations in both creating and updating hooks.
     *
     * **Validates: Requirements 3.1, 3.2, 3.3**
     */
    public function test_pace_enforcement_holds_universally_for_random_inputs(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $tier = self::PRIORITY_TIERS[array_rand(self::PRIORITY_TIERS)];
            $inputPace = self::PACE_VALUES[array_rand(self::PACE_VALUES)];

            // Test creating hook
            $orderLine = $this->makeOrderLine($tier, $inputPace);
            $this->observer->creating($orderLine);

            if (in_array($tier, ['patrocinio', 'red_interna'], true)) {
                $this->assertEquals(
                    'uniform',
                    $orderLine->delivery_pace,
                    "Property 11e creating (iter {$i}): tier='{$tier}', input='{$inputPace}' → " .
                    "must be 'uniform', got '{$orderLine->delivery_pace}'"
                );
            } elseif ($tier === 'estandar') {
                if (in_array($inputPace, ['asap', 'uniform'], true)) {
                    $this->assertEquals(
                        $inputPace,
                        $orderLine->delivery_pace,
                        "Property 11e creating (iter {$i}): tier='estandar', valid input='{$inputPace}' → " .
                        "must preserve value, got '{$orderLine->delivery_pace}'"
                    );
                } else {
                    // Invalid pace for estandar defaults to 'uniform'
                    $this->assertEquals(
                        'uniform',
                        $orderLine->delivery_pace,
                        "Property 11e creating (iter {$i}): tier='estandar', invalid input='{$inputPace}' → " .
                        "must default to 'uniform', got '{$orderLine->delivery_pace}'"
                    );
                }
            }

            // Test updating hook
            $orderLine2 = $this->makeOrderLine($tier, 'uniform');
            $orderLine2->syncOriginal();
            $orderLine2->delivery_pace = $inputPace;
            $this->observer->updating($orderLine2);

            if (in_array($tier, ['patrocinio', 'red_interna'], true)) {
                $this->assertEquals(
                    'uniform',
                    $orderLine2->delivery_pace,
                    "Property 11e updating (iter {$i}): tier='{$tier}', input='{$inputPace}' → " .
                    "must be 'uniform', got '{$orderLine2->delivery_pace}'"
                );
            } elseif ($tier === 'estandar') {
                if (in_array($inputPace, ['asap', 'uniform'], true)) {
                    $this->assertEquals(
                        $inputPace,
                        $orderLine2->delivery_pace,
                        "Property 11e updating (iter {$i}): tier='estandar', valid input='{$inputPace}' → " .
                        "must preserve value, got '{$orderLine2->delivery_pace}'"
                    );
                } else {
                    $this->assertEquals(
                        'uniform',
                        $orderLine2->delivery_pace,
                        "Property 11e updating (iter {$i}): tier='estandar', invalid input='{$inputPace}' → " .
                        "must default to 'uniform', got '{$orderLine2->delivery_pace}'"
                    );
                }
            }
        }
    }
}
