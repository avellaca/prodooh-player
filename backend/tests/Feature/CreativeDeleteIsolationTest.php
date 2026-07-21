<?php

namespace Tests\Feature;

use App\Models\Content;
use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Integration test: Creative delete isolation.
 *
 * Validates Requirements 11.1 and 11.2:
 * - Creatives are individual per screen (not shared)
 * - Deleting a creative from screen A does not affect screen B's creatives
 */
class CreativeDeleteIsolationTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;
    private User $tenantAdmin;
    private Order $order;
    private OrderLine $orderLine;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::factory()->create();
        $this->tenantAdmin = User::factory()->tenantAdmin()->create([
            'tenant_id' => $this->tenant->id,
        ]);
        $this->order = Order::factory()->create([
            'tenant_id' => $this->tenant->id,
        ]);
        $this->orderLine = OrderLine::factory()->create([
            'order_id' => $this->order->id,
        ]);
    }

    private function actingAsTenantAdmin(): self
    {
        return $this->actingAs($this->tenantAdmin, 'sanctum');
    }

    /**
     * Test that deleting a creative from screen A leaves screen B creatives unchanged.
     *
     * Scenario:
     * - 2 screens with same resolution
     * - Same content assigned to both screens (individual Creative per screen)
     * - Delete creative from screen A
     * - Assert screen B's creative is still intact
     */
    public function test_delete_creative_from_screen_a_leaves_screen_b_unchanged(): void
    {
        // Arrange: 2 screens with same resolution
        $screenA = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);
        $screenB = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);

        // Create individual OrderLineTargets per screen
        $targetA = OrderLineTarget::create([
            'order_line_id' => $this->orderLine->id,
            'screen_id' => $screenA->id,
        ]);
        $targetB = OrderLineTarget::create([
            'order_line_id' => $this->orderLine->id,
            'screen_id' => $screenB->id,
        ]);

        // Same content assigned individually to both screens
        $content = Content::factory()->create([
            'tenant_id' => $this->tenant->id,
            'width' => 1920,
            'height' => 1080,
        ]);

        $creativeA = Creative::create([
            'order_line_target_id' => $targetA->id,
            'content_id' => $content->id,
            'weight' => 100,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);
        $creativeB = Creative::create([
            'order_line_target_id' => $targetB->id,
            'content_id' => $content->id,
            'weight' => 100,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);

        // Capture screen B state before deletion
        $creativeBId = $creativeB->id;
        $creativeBWeight = $creativeB->weight;
        $creativeBContentId = $creativeB->content_id;

        // Act: delete creative from screen A via API
        $response = $this->actingAsTenantAdmin()
            ->deleteJson("/api/admin/creatives/{$creativeA->id}");

        $response->assertStatus(200);

        // Assert: screen A creative is gone
        $this->assertDatabaseMissing('creatives', ['id' => $creativeA->id]);

        // Assert: screen B creative is unchanged
        $this->assertDatabaseHas('creatives', [
            'id' => $creativeBId,
            'order_line_target_id' => $targetB->id,
            'content_id' => $creativeBContentId,
            'weight' => $creativeBWeight,
        ]);

        // Assert: total creative count is 1 (only screen B's creative remains)
        $this->assertEquals(1, Creative::count());
    }

    /**
     * Test deletion isolation with multiple creatives per screen.
     *
     * Scenario:
     * - 2 screens, each with 2 creatives
     * - Delete one creative from screen A
     * - Screen B still has 2 creatives, screen A still has 1
     */
    public function test_delete_one_creative_preserves_all_other_creatives(): void
    {
        $screenA = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);
        $screenB = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);

        $targetA = OrderLineTarget::create([
            'order_line_id' => $this->orderLine->id,
            'screen_id' => $screenA->id,
        ]);
        $targetB = OrderLineTarget::create([
            'order_line_id' => $this->orderLine->id,
            'screen_id' => $screenB->id,
        ]);

        $content1 = Content::factory()->create([
            'tenant_id' => $this->tenant->id,
            'width' => 1920,
            'height' => 1080,
        ]);
        $content2 = Content::factory()->create([
            'tenant_id' => $this->tenant->id,
            'width' => 1920,
            'height' => 1080,
        ]);

        // Screen A has 2 creatives
        $creativeA1 = Creative::create([
            'order_line_target_id' => $targetA->id,
            'content_id' => $content1->id,
            'weight' => 100,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);
        $creativeA2 = Creative::create([
            'order_line_target_id' => $targetA->id,
            'content_id' => $content2->id,
            'weight' => 50,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);

        // Screen B has 2 creatives
        $creativeB1 = Creative::create([
            'order_line_target_id' => $targetB->id,
            'content_id' => $content1->id,
            'weight' => 100,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);
        $creativeB2 = Creative::create([
            'order_line_target_id' => $targetB->id,
            'content_id' => $content2->id,
            'weight' => 50,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);

        // Act: delete first creative from screen A
        $response = $this->actingAsTenantAdmin()
            ->deleteJson("/api/admin/creatives/{$creativeA1->id}");

        $response->assertStatus(200);

        // Assert: screen A has 1 creative remaining
        $this->assertEquals(1, Creative::where('order_line_target_id', $targetA->id)->count());
        $this->assertDatabaseHas('creatives', ['id' => $creativeA2->id]);
        $this->assertDatabaseMissing('creatives', ['id' => $creativeA1->id]);

        // Assert: screen B still has both creatives unchanged
        $this->assertEquals(2, Creative::where('order_line_target_id', $targetB->id)->count());
        $this->assertDatabaseHas('creatives', [
            'id' => $creativeB1->id,
            'content_id' => $content1->id,
            'weight' => 100,
        ]);
        $this->assertDatabaseHas('creatives', [
            'id' => $creativeB2->id,
            'content_id' => $content2->id,
            'weight' => 50,
        ]);
    }

    /**
     * Test that bulk-assign creates individual creatives per screen (not per group).
     *
     * Validates Requirement 11.1: each screen gets its own Creative record.
     */
    public function test_bulk_assign_creates_individual_creatives_per_screen(): void
    {
        $screenA = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);
        $screenB = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);

        OrderLineTarget::create([
            'order_line_id' => $this->orderLine->id,
            'screen_id' => $screenA->id,
        ]);
        OrderLineTarget::create([
            'order_line_id' => $this->orderLine->id,
            'screen_id' => $screenB->id,
        ]);

        $content = Content::factory()->create([
            'tenant_id' => $this->tenant->id,
            'width' => 1920,
            'height' => 1080,
        ]);

        // Act: use bulk-assign endpoint
        $response = $this->actingAsTenantAdmin()
            ->postJson("/api/admin/order-lines/{$this->orderLine->id}/creatives/bulk-assign", [
                'content_ids' => [$content->id],
                'weight' => 100,
            ]);

        $response->assertSuccessful();

        // Assert: one creative per screen (individual records, not shared)
        $creatives = Creative::where('content_id', $content->id)->get();
        $this->assertCount(2, $creatives);

        // Each creative belongs to a different target (different screen)
        $targetIds = $creatives->pluck('order_line_target_id')->unique();
        $this->assertCount(2, $targetIds);

        // Verify each creative is linked to a screen-level target
        foreach ($creatives as $creative) {
            $target = OrderLineTarget::find($creative->order_line_target_id);
            $this->assertNotNull($target->screen_id, 'Each creative should be linked to a screen-level target');
        }
    }

    /**
     * Test that deleting a creative via destroy endpoint returns correct response.
     */
    public function test_destroy_returns_success_message(): void
    {
        $screen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);

        $target = OrderLineTarget::create([
            'order_line_id' => $this->orderLine->id,
            'screen_id' => $screen->id,
        ]);

        $content = Content::factory()->create([
            'tenant_id' => $this->tenant->id,
            'width' => 1920,
            'height' => 1080,
        ]);

        $creative = Creative::create([
            'order_line_target_id' => $target->id,
            'content_id' => $content->id,
            'weight' => 100,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);

        $response = $this->actingAsTenantAdmin()
            ->deleteJson("/api/admin/creatives/{$creative->id}");

        $response->assertStatus(200);
        $response->assertJson(['message' => 'Creative deleted successfully.']);
        $this->assertDatabaseMissing('creatives', ['id' => $creative->id]);
    }
}
