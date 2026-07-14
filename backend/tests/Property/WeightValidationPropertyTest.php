<?php

namespace Tests\Property;

use App\Models\Content;
use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\Tenant;
use App\Models\User;
use Eris\Generators;
use Eris\TestTrait;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Property Test: Weight validation (Property 5)
 *
 * Property 5: Validación de weight como entero positivo
 *
 * For any creative creation request, the weight field must be validated
 * as a positive integer >= 1. Values that are 0, negative, decimal (float),
 * or strings must be rejected with HTTP 422.
 *
 * **Validates: Requirements 4.6**
 */
class WeightValidationPropertyTest extends TestCase
{
    use RefreshDatabase, TestTrait;

    /**
     * Prevent seeding — Eris TestTrait's $seed property (random seed integer)
     * conflicts with Laravel's shouldSeed() which checks property_exists($this, 'seed').
     */
    protected function shouldSeed(): bool
    {
        return false;
    }

    /**
     * Helper: create test fixtures for a creative creation request.
     *
     * Returns an array with [admin, target, content, today].
     */
    private function createTestFixtures(): array
    {
        $tenant = Tenant::factory()->create();
        $admin = User::factory()->superAdmin()->create();

        // Authenticate before creating entities that trigger observers
        $this->actingAs($admin);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $orderLine = OrderLine::factory()->create([
            'order_id' => $order->id,
            'starts_at' => now()->subDays(5),
            'ends_at' => now()->addDays(30),
        ]);
        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);
        $target = OrderLineTarget::factory()->create([
            'order_line_id' => $orderLine->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);
        $content = Content::factory()->create([
            'tenant_id' => $tenant->id,
            'width' => 1920,
            'height' => 1080,
        ]);

        $today = now()->toDateString();

        return [$admin, $target, $content, $today];
    }

    /**
     * Helper: clean up all test data in correct order to avoid observer conflicts.
     */
    private function cleanupTestData(): void
    {
        Creative::withoutGlobalScopes()->forceDelete();
        OrderLineTarget::query()->delete();
        Screen::withoutGlobalScopes()->delete();
        Content::withoutGlobalScopes()->delete();
        // Delete OrderLines without triggering observers to avoid cascade issues
        OrderLine::withoutEvents(function () {
            OrderLine::query()->forceDelete();
        });
        Order::withoutGlobalScopes()->delete();
        User::query()->delete();
        Tenant::query()->delete();
    }

    /**
     * Property 5: Valid weights (integers >= 1) are accepted with 201.
     *
     * Generate arbitrary positive integers >= 1 and verify that a creative
     * creation request with that weight succeeds with HTTP 201.
     *
     * **Validates: Requirements 4.6**
     */
    public function test_valid_weight_integers_accepted(): void
    {
        $this->limitTo(5)->forAll(
            Generators::choose(1, 1000) // valid weights: integers >= 1
        )->then(function (int $weight): void {
            [$admin, $target, $content, $today] = $this->createTestFixtures();

            $response = $this->actingAs($admin)
                ->postJson("/api/admin/order-line-targets/{$target->id}/creatives", [
                    'content_id' => $content->id,
                    'weight' => $weight,
                    'active_dates' => [$today],
                ]);

            $response->assertStatus(201,
                "Property 5: weight={$weight} (valid integer >= 1) should be accepted with 201, got {$response->status()}"
            );

            $this->cleanupTestData();
        });
    }

    /**
     * Property 5: Zero weight is rejected with 422.
     *
     * Weight of 0 does not satisfy integer >= 1 and must be rejected.
     *
     * **Validates: Requirements 4.6**
     */
    public function test_zero_weight_rejected(): void
    {
        [$admin, $target, $content, $today] = $this->createTestFixtures();

        $response = $this->actingAs($admin)
            ->postJson("/api/admin/order-line-targets/{$target->id}/creatives", [
                'content_id' => $content->id,
                'weight' => 0,
                'active_dates' => [$today],
            ]);

        $response->assertStatus(422,
            "Property 5: weight=0 must be rejected with 422"
        );
        $response->assertJsonValidationErrors('weight');
    }

    /**
     * Property 5: Negative weights are rejected with 422.
     *
     * Generate arbitrary negative integers and verify they are rejected.
     *
     * **Validates: Requirements 4.6**
     */
    public function test_negative_weight_rejected(): void
    {
        $this->limitTo(5)->forAll(
            Generators::choose(-1000, -1) // negative integers
        )->then(function (int $negativeWeight): void {
            [$admin, $target, $content, $today] = $this->createTestFixtures();

            $response = $this->actingAs($admin)
                ->postJson("/api/admin/order-line-targets/{$target->id}/creatives", [
                    'content_id' => $content->id,
                    'weight' => $negativeWeight,
                    'active_dates' => [$today],
                ]);

            $response->assertStatus(422,
                "Property 5: weight={$negativeWeight} (negative) must be rejected with 422, got {$response->status()}"
            );
            $response->assertJsonValidationErrors('weight');

            $this->cleanupTestData();
        });
    }

    /**
     * Property 5: Decimal (float) weights are rejected with 422.
     *
     * Generate arbitrary float values and verify they are rejected.
     *
     * **Validates: Requirements 4.6**
     */
    public function test_decimal_weight_rejected(): void
    {
        $decimalValues = [0.5, 1.5, 2.7, 3.14, 99.9];

        foreach ($decimalValues as $decimalWeight) {
            [$admin, $target, $content, $today] = $this->createTestFixtures();

            $response = $this->actingAs($admin)
                ->postJson("/api/admin/order-line-targets/{$target->id}/creatives", [
                    'content_id' => $content->id,
                    'weight' => $decimalWeight,
                    'active_dates' => [$today],
                ]);

            $response->assertStatus(422,
                "Property 5: weight={$decimalWeight} (decimal) must be rejected with 422, got {$response->status()}"
            );
            $response->assertJsonValidationErrors('weight');

            $this->cleanupTestData();
        }
    }

    /**
     * Property 5: String weights are rejected with 422.
     *
     * Non-numeric string values must be rejected.
     *
     * **Validates: Requirements 4.6**
     */
    public function test_string_weight_rejected(): void
    {
        $stringValues = ['abc', 'one', '', 'null', '1.5', 'true'];

        foreach ($stringValues as $stringWeight) {
            [$admin, $target, $content, $today] = $this->createTestFixtures();

            $response = $this->actingAs($admin)
                ->postJson("/api/admin/order-line-targets/{$target->id}/creatives", [
                    'content_id' => $content->id,
                    'weight' => $stringWeight,
                    'active_dates' => [$today],
                ]);

            $response->assertStatus(422,
                "Property 5: weight='{$stringWeight}' (string) must be rejected with 422, got {$response->status()}"
            );
            $response->assertJsonValidationErrors('weight');

            $this->cleanupTestData();
        }
    }
}
