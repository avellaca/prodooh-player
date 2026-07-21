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
 * Property Test: Weight validation on update (Property 18)
 *
 * Property 18: Validación de peso rechaza valores inválidos
 *
 * For any value less than 1 or non-integer, updating a Creative's weight
 * SHALL be rejected with a validation error. For any integer >= 1, the
 * update SHALL succeed.
 *
 * **Validates: Requirements 12.4**
 */
class WeightUpdateValidationPropertyTest extends TestCase
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
     * Helper: create test fixtures including an existing Creative.
     *
     * Returns [admin, creative, tenant].
     */
    private function createTestFixtures(): array
    {
        $tenant = Tenant::factory()->create();
        $admin = User::factory()->superAdmin()->create();

        $this->actingAs($admin);

        // Bind tenant context for super_admin (simulates X-Tenant-Id header / query param)
        app()->instance('current_tenant_id', $tenant->id);

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

        $creative = Creative::factory()->create([
            'order_line_target_id' => $target->id,
            'content_id' => $content->id,
            'weight' => 100,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);

        return [$admin, $creative, $tenant];
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
        OrderLine::withoutEvents(function () {
            OrderLine::query()->forceDelete();
        });
        Order::withoutGlobalScopes()->delete();
        User::query()->delete();
        Tenant::query()->delete();
    }

    /**
     * Property 18: Valid weights (integers >= 1) update successfully.
     *
     * For any integer >= 1, updating a Creative's weight SHALL succeed
     * with HTTP 200 and the new weight SHALL be persisted.
     *
     * **Validates: Requirements 12.4**
     */
    public function test_valid_weight_update_accepted(): void
    {
        [$admin, $creative, $tenant] = $this->createTestFixtures();

        $this->limitTo(20)->forAll(
            Generators::choose(1, 10000) // valid weights: integers >= 1
        )->then(function (int $weight) use ($admin, $creative, $tenant): void {
            $response = $this->actingAs($admin)
                ->putJson("/api/admin/creatives/{$creative->id}?tenant_id={$tenant->id}", [
                    'weight' => $weight,
                ]);

            $response->assertStatus(200,
                "Property 18: weight={$weight} (valid integer >= 1) should be accepted on update with 200, got {$response->status()}"
            );

            // Verify weight was persisted
            $this->assertEquals(
                $weight,
                $creative->fresh()->weight,
                "Property 18: weight={$weight} should be persisted after successful update"
            );
        });
    }

    /**
     * Property 18: Zero weight is rejected on update with 422.
     *
     * Weight of 0 does not satisfy integer >= 1 and must be rejected.
     * The original weight must remain unchanged.
     *
     * **Validates: Requirements 12.4**
     */
    public function test_zero_weight_update_rejected(): void
    {
        [$admin, $creative, $tenant] = $this->createTestFixtures();
        // Reset weight to known value
        $creative->update(['weight' => 100]);
        $originalWeight = 100;

        $response = $this->actingAs($admin)
            ->putJson("/api/admin/creatives/{$creative->id}?tenant_id={$tenant->id}", [
                'weight' => 0,
            ]);

        $response->assertStatus(422,
            "Property 18: weight=0 must be rejected on update with 422"
        );
        $response->assertJsonValidationErrors('weight');

        // Verify original weight unchanged
        $this->assertEquals(
            $originalWeight,
            $creative->fresh()->weight,
            "Property 18: original weight must remain unchanged after rejected update"
        );
    }

    /**
     * Property 18: Negative weights are rejected on update with 422.
     *
     * For any negative integer, updating weight SHALL be rejected and the
     * original value SHALL remain unchanged.
     *
     * **Validates: Requirements 12.4**
     */
    public function test_negative_weight_update_rejected(): void
    {
        [$admin, $creative, $tenant] = $this->createTestFixtures();

        $this->limitTo(20)->forAll(
            Generators::choose(-10000, -1) // negative integers
        )->then(function (int $negativeWeight) use ($admin, $creative, $tenant): void {
            // Reset weight to known value before each test
            $creative->update(['weight' => 100]);
            $originalWeight = 100;

            $response = $this->actingAs($admin)
                ->putJson("/api/admin/creatives/{$creative->id}?tenant_id={$tenant->id}", [
                    'weight' => $negativeWeight,
                ]);

            $response->assertStatus(422,
                "Property 18: weight={$negativeWeight} (negative) must be rejected on update with 422, got {$response->status()}"
            );
            $response->assertJsonValidationErrors('weight');

            // Verify original weight unchanged
            $this->assertEquals(
                $originalWeight,
                $creative->fresh()->weight,
                "Property 18: original weight must remain unchanged after rejected update with weight={$negativeWeight}"
            );
        });
    }

    /**
     * Property 18: Decimal (float) weights are rejected on update with 422.
     *
     * Non-integer numeric values must be rejected and original weight
     * must remain unchanged.
     *
     * **Validates: Requirements 12.4**
     */
    public function test_decimal_weight_update_rejected(): void
    {
        [$admin, $creative, $tenant] = $this->createTestFixtures();
        $decimalValues = [0.1, 0.5, 1.5, 2.7, 3.14, 99.9, 0.99, 1.01];

        foreach ($decimalValues as $decimalWeight) {
            // Reset weight to known value
            $creative->update(['weight' => 100]);
            $originalWeight = 100;

            $response = $this->actingAs($admin)
                ->putJson("/api/admin/creatives/{$creative->id}?tenant_id={$tenant->id}", [
                    'weight' => $decimalWeight,
                ]);

            $response->assertStatus(422,
                "Property 18: weight={$decimalWeight} (decimal) must be rejected on update with 422, got {$response->status()}"
            );
            $response->assertJsonValidationErrors('weight');

            // Verify original weight unchanged
            $this->assertEquals(
                $originalWeight,
                $creative->fresh()->weight,
                "Property 18: original weight must remain unchanged after rejected update with weight={$decimalWeight}"
            );
        }
    }

    /**
     * Property 18: String (non-numeric) weights are rejected on update with 422.
     *
     * Non-numeric string values must be rejected and original weight
     * must remain unchanged.
     *
     * **Validates: Requirements 12.4**
     */
    public function test_string_weight_update_rejected(): void
    {
        [$admin, $creative, $tenant] = $this->createTestFixtures();
        $stringValues = ['abc', 'one', '', 'null', '1.5', 'true', 'NaN', 'infinity'];

        foreach ($stringValues as $stringWeight) {
            // Reset weight to known value
            $creative->update(['weight' => 100]);
            $originalWeight = 100;

            $response = $this->actingAs($admin)
                ->putJson("/api/admin/creatives/{$creative->id}?tenant_id={$tenant->id}", [
                    'weight' => $stringWeight,
                ]);

            $response->assertStatus(422,
                "Property 18: weight='{$stringWeight}' (string) must be rejected on update with 422, got {$response->status()}"
            );
            $response->assertJsonValidationErrors('weight');

            // Verify original weight unchanged
            $this->assertEquals(
                $originalWeight,
                $creative->fresh()->weight,
                "Property 18: original weight must remain unchanged after rejected update with weight='{$stringWeight}'"
            );
        }
    }
}
