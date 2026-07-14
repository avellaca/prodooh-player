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
 * Property Test for exact resolution validation (Content vs Screen).
 *
 * Property 1: Validación de resolución exacta (Content vs Screen)
 *
 * For any content with dimensions (w1, h1) and any screen with resolution (w2, h2),
 * assigning a creative linking that content to a target of that screen SHALL be
 * accepted if and only if w1 === w2 AND h1 === h2.
 * If dimensions don't match exactly, the system SHALL reject with error 422.
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 3.4, 5.4**
 */
class ResolutionExactPropertyTest extends TestCase
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
     * Property 1: Validación de resolución exacta (Content vs Screen)
     *
     * For any content (W1, H1) and screen (W2, H2):
     * - If W1 === W2 AND H1 === H2: POST /order-line-targets/{targetId}/creatives → 201
     * - Otherwise: POST /order-line-targets/{targetId}/creatives → 422
     *
     * **Validates: Requirements 2.1, 2.2, 2.3, 3.4, 5.4**
     */
    public function test_resolution_exact_match_acceptance_or_rejection(): void
    {
        $this->limitTo(5)->forAll(
            Generators::choose(100, 3840),  // content width (W1)
            Generators::choose(100, 2160),  // content height (H1)
            Generators::choose(100, 3840),  // screen width (W2)
            Generators::choose(100, 2160)   // screen height (H2)
        )->then(function (int $contentWidth, int $contentHeight, int $screenWidth, int $screenHeight): void {
            // Setup: tenant, order, order line, admin user
            $tenant = Tenant::factory()->create();
            $admin = User::factory()->superAdmin()->create();
            $order = Order::factory()->create(['tenant_id' => $tenant->id]);
            $orderLine = OrderLine::factory()->create([
                'order_id' => $order->id,
                'starts_at' => now()->subDays(3),
                'ends_at' => now()->addDays(20),
            ]);

            // Create screen with random resolution (W2, H2)
            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'resolution_width' => $screenWidth,
                'resolution_height' => $screenHeight,
            ]);

            // Create target for that screen
            $target = OrderLineTarget::factory()->create([
                'order_line_id' => $orderLine->id,
                'screen_id' => $screen->id,
                'screen_group_id' => null,
            ]);

            // Create content with random resolution (W1, H1)
            $content = Content::factory()->create([
                'tenant_id' => $tenant->id,
                'width' => $contentWidth,
                'height' => $contentHeight,
            ]);

            // Attempt to assign creative
            $response = $this->actingAs($admin)
                ->postJson("/api/admin/order-line-targets/{$target->id}/creatives", [
                    'content_id' => $content->id,
                    'weight' => 1,
                    'active_dates' => [now()->format('Y-m-d')],
                ]);

            $resolutionsMatch = ($contentWidth === $screenWidth && $contentHeight === $screenHeight);

            if ($resolutionsMatch) {
                $response->assertStatus(201);
                $this->assertDatabaseHas('creatives', [
                    'order_line_target_id' => $target->id,
                    'content_id' => $content->id,
                ]);
            } else {
                $response->assertStatus(422);
                $this->assertDatabaseMissing('creatives', [
                    'order_line_target_id' => $target->id,
                    'content_id' => $content->id,
                ]);
            }

            // Cleanup for next iteration
            Creative::withoutGlobalScopes()->delete();
            OrderLineTarget::query()->delete();
            Screen::withoutGlobalScopes()->delete();
            Content::withoutGlobalScopes()->delete();
            OrderLine::query()->delete();
            Order::query()->delete();
            User::query()->delete();
            Tenant::query()->delete();
        });
    }
}
