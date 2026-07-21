<?php

namespace Tests\Property;

use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\Tenant;
use App\Models\User;
use App\Services\PlaybackModeResolver;
use Eris\Generators;
use Eris\TestTrait;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Property Test: Resolución del modo de reproducción efectivo (Property 2)
 *
 * For any OrderLineTarget, the effective playback mode SHALL be:
 * (a) playback_mode_override if not null, or
 * (b) orderLine.playback_mode if override is null.
 * Only 'round_robin' and 'sequential' are valid values.
 *
 * **Validates: Requirements 7.1, 8.1, 8.2, 8.3**
 */
class PlaybackModeResolverPropertyTest extends TestCase
{
    use RefreshDatabase, TestTrait;

    /**
     * Prevent seeding — Eris TestTrait's $seed property conflicts with Laravel's shouldSeed().
     */
    protected function shouldSeed(): bool
    {
        return false;
    }

    /**
     * Valid playback modes used throughout the property tests.
     */
    private const VALID_MODES = ['round_robin', 'sequential'];

    /**
     * Helper: clean up all test data in correct order.
     */
    private function cleanupTestData(): void
    {
        OrderLineTarget::query()->delete();
        Screen::withoutGlobalScopes()->delete();
        OrderLine::withoutEvents(function () {
            OrderLine::query()->forceDelete();
        });
        \App\Models\AuditLog::query()->delete();
        Order::withoutGlobalScopes()->delete();
        User::query()->delete();
        Tenant::query()->delete();
    }

    /**
     * Property 2: When override is set, the resolver returns the override value.
     *
     * For any combination of orderLine.playback_mode and target.playback_mode_override
     * (both valid), when override is NOT null, the effective mode SHALL be the override.
     *
     * **Validates: Requirements 8.1**
     */
    public function test_override_takes_precedence_over_order_line_mode(): void
    {
        $this->limitTo(10)->forAll(
            Generators::elements(self::VALID_MODES[0], self::VALID_MODES[1]),  // orderLine playback_mode
            Generators::elements(self::VALID_MODES[0], self::VALID_MODES[1])   // target override
        )->then(function (string $orderLineMode, string $overrideMode): void {
            $tenant = Tenant::factory()->create();
            $admin = User::factory()->superAdmin()->create();
            $this->actingAs($admin);

            $order = Order::factory()->create(['tenant_id' => $tenant->id]);
            $orderLine = OrderLine::factory()->create([
                'order_id' => $order->id,
                'playback_mode' => $orderLineMode,
            ]);
            $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
            $target = OrderLineTarget::factory()->create([
                'order_line_id' => $orderLine->id,
                'screen_id' => $screen->id,
                'screen_group_id' => null,
                'playback_mode_override' => $overrideMode,
            ]);

            // Reload target with relation to ensure fresh data
            $target->load('orderLine');

            $effectiveMode = PlaybackModeResolver::resolve($target);

            // PROPERTY: When override is set, effective mode == override
            $this->assertEquals(
                $overrideMode,
                $effectiveMode,
                "When override is '{$overrideMode}', effective mode must be '{$overrideMode}' "
                . "regardless of orderLine mode '{$orderLineMode}'"
            );

            // PROPERTY: Result is always a valid mode
            $this->assertContains(
                $effectiveMode,
                self::VALID_MODES,
                "Effective mode '{$effectiveMode}' must be one of: " . implode(', ', self::VALID_MODES)
            );

            $this->cleanupTestData();
        });
    }

    /**
     * Property 2: When override is null, the resolver inherits from orderLine.playback_mode.
     *
     * For any valid orderLine.playback_mode, when the target has no override (null),
     * the effective mode SHALL be the orderLine's playback_mode.
     *
     * **Validates: Requirements 8.2, 8.3**
     */
    public function test_inherits_order_line_mode_when_override_is_null(): void
    {
        $this->limitTo(10)->forAll(
            Generators::elements(self::VALID_MODES[0], self::VALID_MODES[1])  // orderLine playback_mode
        )->then(function (string $orderLineMode): void {
            $tenant = Tenant::factory()->create();
            $admin = User::factory()->superAdmin()->create();
            $this->actingAs($admin);

            $order = Order::factory()->create(['tenant_id' => $tenant->id]);
            $orderLine = OrderLine::factory()->create([
                'order_id' => $order->id,
                'playback_mode' => $orderLineMode,
            ]);
            $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
            $target = OrderLineTarget::factory()->create([
                'order_line_id' => $orderLine->id,
                'screen_id' => $screen->id,
                'screen_group_id' => null,
                'playback_mode_override' => null,
            ]);

            $target->load('orderLine');

            $effectiveMode = PlaybackModeResolver::resolve($target);

            // PROPERTY: When override is null, effective mode == orderLine.playback_mode
            $this->assertEquals(
                $orderLineMode,
                $effectiveMode,
                "When override is null, effective mode must inherit orderLine mode '{$orderLineMode}'"
            );

            // PROPERTY: Result is always a valid mode
            $this->assertContains(
                $effectiveMode,
                self::VALID_MODES,
                "Effective mode '{$effectiveMode}' must be one of: " . implode(', ', self::VALID_MODES)
            );

            $this->cleanupTestData();
        });
    }

    /**
     * Property 2: Default playback_mode for a new OrderLine is 'round_robin'.
     *
     * When a new OrderLine is created without specifying playback_mode,
     * the database default SHALL be 'round_robin', and resolving a target
     * without override SHALL return 'round_robin'.
     *
     * **Validates: Requirements 7.1**
     */
    public function test_defaults_to_round_robin_for_new_order_line(): void
    {
        $tenant = Tenant::factory()->create();
        $admin = User::factory()->superAdmin()->create();
        $this->actingAs($admin);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        // Create OrderLine without specifying playback_mode — DB default is 'round_robin'
        $orderLine = OrderLine::factory()->create([
            'order_id' => $order->id,
        ]);
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
        $target = OrderLineTarget::factory()->create([
            'order_line_id' => $orderLine->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
            'playback_mode_override' => null,
        ]);

        $target->load('orderLine');

        $effectiveMode = PlaybackModeResolver::resolve($target);

        // PROPERTY: Default is always 'round_robin'
        $this->assertEquals(
            'round_robin',
            $effectiveMode,
            "When OrderLine has default playback_mode and target has no override, effective mode must be 'round_robin'"
        );

        // PROPERTY: The orderLine.playback_mode itself should be 'round_robin' by default
        $this->assertEquals(
            'round_robin',
            $orderLine->fresh()->playback_mode,
            "OrderLine default playback_mode must be 'round_robin'"
        );
    }

    /**
     * Property 2: The resolution is deterministic and consistent across calls.
     *
     * For any given state of OrderLineTarget (with or without override),
     * calling resolve() multiple times SHALL always produce the same result.
     *
     * **Validates: Requirements 7.1, 8.1, 8.2**
     */
    public function test_resolution_is_deterministic(): void
    {
        $this->limitTo(10)->forAll(
            Generators::elements(self::VALID_MODES[0], self::VALID_MODES[1]),            // orderLine mode
            Generators::elements(self::VALID_MODES[0], self::VALID_MODES[1], 'none')     // override (or 'none' for null)
        )->then(function (string $orderLineMode, string $overrideChoice): void {
            $override = $overrideChoice === 'none' ? null : $overrideChoice;

            $tenant = Tenant::factory()->create();
            $admin = User::factory()->superAdmin()->create();
            $this->actingAs($admin);

            $order = Order::factory()->create(['tenant_id' => $tenant->id]);
            $orderLine = OrderLine::factory()->create([
                'order_id' => $order->id,
                'playback_mode' => $orderLineMode,
            ]);
            $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
            $target = OrderLineTarget::factory()->create([
                'order_line_id' => $orderLine->id,
                'screen_id' => $screen->id,
                'screen_group_id' => null,
                'playback_mode_override' => $override,
            ]);

            $target->load('orderLine');

            // Call resolve multiple times
            $result1 = PlaybackModeResolver::resolve($target);
            $result2 = PlaybackModeResolver::resolve($target);
            $result3 = PlaybackModeResolver::resolve($target);

            // PROPERTY: All calls return same value (deterministic)
            $this->assertEquals($result1, $result2, "Resolve must be deterministic across calls");
            $this->assertEquals($result2, $result3, "Resolve must be deterministic across calls");

            // PROPERTY: All results are valid modes
            $this->assertContains($result1, self::VALID_MODES);

            $this->cleanupTestData();
        });
    }

    /**
     * Property 2: The resolved mode is always one of the two valid values.
     *
     * Exhaustive check that for all valid combinations of inputs,
     * the output is constrained to the valid domain.
     *
     * **Validates: Requirements 7.1, 8.1, 8.2, 8.3**
     */
    public function test_resolved_mode_always_in_valid_domain(): void
    {
        $this->limitTo(15)->forAll(
            Generators::elements(self::VALID_MODES[0], self::VALID_MODES[1]),            // orderLine mode
            Generators::elements(self::VALID_MODES[0], self::VALID_MODES[1], 'none')     // override (or 'none' for null)
        )->then(function (string $orderLineMode, string $overrideChoice): void {
            $override = $overrideChoice === 'none' ? null : $overrideChoice;

            $tenant = Tenant::factory()->create();
            $admin = User::factory()->superAdmin()->create();
            $this->actingAs($admin);

            $order = Order::factory()->create(['tenant_id' => $tenant->id]);
            $orderLine = OrderLine::factory()->create([
                'order_id' => $order->id,
                'playback_mode' => $orderLineMode,
            ]);
            $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
            $target = OrderLineTarget::factory()->create([
                'order_line_id' => $orderLine->id,
                'screen_id' => $screen->id,
                'screen_group_id' => null,
                'playback_mode_override' => $override,
            ]);

            $target->load('orderLine');

            $effectiveMode = PlaybackModeResolver::resolve($target);

            // PROPERTY: Output is always in the valid set
            $this->assertContains(
                $effectiveMode,
                self::VALID_MODES,
                "Resolved mode '{$effectiveMode}' must be 'round_robin' or 'sequential'"
            );

            // PROPERTY: Correct resolution logic
            if ($override !== null) {
                $this->assertEquals($override, $effectiveMode,
                    "With override='{$override}', effective mode must be the override");
            } else {
                $this->assertEquals($orderLineMode, $effectiveMode,
                    "Without override, effective mode must be orderLine mode '{$orderLineMode}'");
            }

            $this->cleanupTestData();
        });
    }
}
