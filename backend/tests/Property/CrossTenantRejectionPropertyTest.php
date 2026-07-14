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
 * Property 4: Rechazo de referencias cross-tenant
 *
 * Generate content belonging to tenant A and attempt to assign it as a creative
 * in the context of tenant B. Verify: rejected with validation error when A ≠ B.
 *
 * **Validates: Requirements 4.5**
 */
class CrossTenantRejectionPropertyTest extends TestCase
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
     * Property 4: Cross-tenant content assignment is always rejected.
     *
     * For any two distinct tenants A and B, content belonging to tenant A
     * MUST be rejected with 422 when attempting to assign it as a creative
     * under a target belonging to tenant B.
     *
     * Strategy:
     * 1. Create tenantA and tenantB
     * 2. Create content belonging to tenantA
     * 3. Create order/orderLine/screen/target under tenantB
     * 4. Authenticate as tenantB admin
     * 5. Attempt POST /order-line-targets/{targetId}/creatives with tenantA's content
     * 6. Verify: rejected with 422
     *
     * **Validates: Requirements 4.5**
     */
    public function test_cross_tenant_content_rejected_on_creative_assignment(): void
    {
        $this->limitTo(5)->forAll(
            Generators::choose(1920, 3840),  // resolution width
            Generators::choose(1080, 2160),  // resolution height
            Generators::choose(1, 100)       // weight
        )->then(function (int $width, int $height, int $weight): void {
            // 1. Create two distinct tenants (no auth during setup to avoid scope issues)
            $tenantA = Tenant::factory()->create();
            $tenantB = Tenant::factory()->create();

            // 2. Create content belonging to tenantA with specific resolution
            $contentA = Content::factory()->create([
                'tenant_id' => $tenantA->id,
                'width' => $width,
                'height' => $height,
            ]);

            // 3. Create order/orderLine/screen/target under tenantB
            $order = Order::factory()->create(['tenant_id' => $tenantB->id]);
            $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);
            $screen = Screen::factory()->create([
                'tenant_id' => $tenantB->id,
                'resolution_width' => $width,
                'resolution_height' => $height,
            ]);
            $target = OrderLineTarget::factory()->create([
                'order_line_id' => $orderLine->id,
                'screen_id' => $screen->id,
                'screen_group_id' => null,
            ]);

            // 4. Authenticate as tenantB admin for the API call
            $adminB = User::factory()->tenantAdmin()->create([
                'tenant_id' => $tenantB->id,
            ]);

            // 5. Attempt to assign tenantA's content to tenantB's target
            $activeDates = [now()->addDay()->format('Y-m-d')];

            $response = $this->actingAs($adminB)
                ->postJson("/api/admin/order-line-targets/{$target->id}/creatives", [
                    'content_id' => $contentA->id,
                    'weight' => $weight,
                    'active_dates' => $activeDates,
                ]);

            // 6. Verify: rejected with 422 validation error
            $response->assertStatus(422);
            $response->assertJsonValidationErrors('content_id');

            // Verify: no creative was created
            $this->assertEquals(
                0,
                Creative::where('order_line_target_id', $target->id)->count(),
                "Property 4: No creative should be created when content belongs to a different tenant"
            );

            // Cleanup for next iteration
            auth()->forgetGuards();
            Creative::withoutGlobalScopes()->delete();
            OrderLineTarget::query()->delete();
            Screen::withoutGlobalScopes()->delete();
            OrderLine::query()->delete();
            Order::withoutGlobalScopes()->delete();
            Content::withoutGlobalScopes()->delete();
            User::query()->delete();
            Tenant::query()->delete();
        });
    }

    /**
     * Property 4 (control): Same-tenant content assignment is accepted.
     *
     * Ensures the rejection is specifically due to tenant mismatch — when
     * content belongs to the same tenant, the assignment succeeds (201).
     *
     * **Validates: Requirements 4.5**
     */
    public function test_same_tenant_content_accepted_on_creative_assignment(): void
    {
        $this->limitTo(5)->forAll(
            Generators::choose(1920, 3840),  // resolution width
            Generators::choose(1080, 2160),  // resolution height
            Generators::choose(1, 100)       // weight
        )->then(function (int $width, int $height, int $weight): void {
            // Create a single tenant with all resources (no auth during setup)
            $tenant = Tenant::factory()->create();

            $content = Content::factory()->create([
                'tenant_id' => $tenant->id,
                'width' => $width,
                'height' => $height,
            ]);

            $order = Order::factory()->create(['tenant_id' => $tenant->id]);
            $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);
            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'resolution_width' => $width,
                'resolution_height' => $height,
            ]);
            $target = OrderLineTarget::factory()->create([
                'order_line_id' => $orderLine->id,
                'screen_id' => $screen->id,
                'screen_group_id' => null,
            ]);

            // Authenticate as tenant admin for the API call
            $admin = User::factory()->tenantAdmin()->create([
                'tenant_id' => $tenant->id,
            ]);

            $activeDates = [now()->addDay()->format('Y-m-d')];

            $response = $this->actingAs($admin)
                ->postJson("/api/admin/order-line-targets/{$target->id}/creatives", [
                    'content_id' => $content->id,
                    'weight' => $weight,
                    'active_dates' => $activeDates,
                ]);

            // Same tenant: should succeed with 201
            $response->assertStatus(201);

            // Verify creative was created
            $this->assertEquals(
                1,
                Creative::where('order_line_target_id', $target->id)->count(),
                "Property 4 (control): Creative should be created when content belongs to the same tenant"
            );

            // Cleanup for next iteration
            auth()->forgetGuards();
            Creative::withoutGlobalScopes()->delete();
            OrderLineTarget::query()->delete();
            Screen::withoutGlobalScopes()->delete();
            OrderLine::query()->delete();
            Order::withoutGlobalScopes()->delete();
            Content::withoutGlobalScopes()->delete();
            User::query()->delete();
            Tenant::query()->delete();
        });
    }
}
