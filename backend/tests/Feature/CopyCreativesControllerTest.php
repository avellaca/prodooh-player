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

class CopyCreativesControllerTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;
    private User $tenantAdmin;
    private Order $order;
    private OrderLine $sourceOrderLine;
    private OrderLine $targetOrderLine;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::factory()->create();
        $this->tenantAdmin = User::factory()->tenantAdmin()->create([
            'tenant_id' => $this->tenant->id,
        ]);
        $this->order = Order::factory()->create([
            'tenant_id' => $this->tenant->id,
            'starts_at' => '2025-01-01',
            'ends_at' => '2025-12-31',
        ]);
        $this->sourceOrderLine = OrderLine::factory()->create([
            'order_id' => $this->order->id,
            'starts_at' => '2025-01-10',
            'ends_at' => '2025-01-31',
        ]);
        $this->targetOrderLine = OrderLine::factory()->create([
            'order_id' => $this->order->id,
            'starts_at' => '2025-02-01',
            'ends_at' => '2025-02-28',
        ]);
    }

    private function actingAsTenantAdmin(): self
    {
        return $this->actingAs($this->tenantAdmin, 'sanctum');
    }

    // ─── SUCCESS CASES ───────────────────────────────────────────────

    public function test_copies_creatives_to_target_with_matching_resolution(): void
    {
        // Source: screen 1920x1080 with a creative
        $sourceScreen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);
        $sourceTarget = OrderLineTarget::create([
            'order_line_id' => $this->sourceOrderLine->id,
            'screen_id' => $sourceScreen->id,
        ]);
        $content = Content::factory()->create([
            'tenant_id' => $this->tenant->id,
            'width' => 1920,
            'height' => 1080,
        ]);
        Creative::create([
            'order_line_target_id' => $sourceTarget->id,
            'content_id' => $content->id,
            'weight' => 100,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);

        // Target: screen 1920x1080
        $targetScreen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);
        $targetTarget = OrderLineTarget::create([
            'order_line_id' => $this->targetOrderLine->id,
            'screen_id' => $targetScreen->id,
        ]);

        $response = $this->actingAsTenantAdmin()
            ->postJson("/api/admin/order-lines/{$this->sourceOrderLine->id}/copy-creatives", [
                'target_order_line_id' => $this->targetOrderLine->id,
            ]);

        $response->assertStatus(201);
        $data = $response->json('data');
        $this->assertEquals(1, $data['created']);
        $this->assertEquals(0, $data['skipped']);
        $this->assertContains($targetScreen->id, $data['covered_screens']);

        // Verify creative was created in target
        $this->assertDatabaseHas('creatives', [
            'order_line_target_id' => $targetTarget->id,
            'content_id' => $content->id,
            'weight' => 100,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);
    }

    public function test_skips_content_with_no_matching_resolution_in_target(): void
    {
        // Source: 1920x1080 content
        $sourceScreen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);
        $sourceTarget = OrderLineTarget::create([
            'order_line_id' => $this->sourceOrderLine->id,
            'screen_id' => $sourceScreen->id,
        ]);
        $content = Content::factory()->create([
            'tenant_id' => $this->tenant->id,
            'width' => 1920,
            'height' => 1080,
        ]);
        Creative::create([
            'order_line_target_id' => $sourceTarget->id,
            'content_id' => $content->id,
            'weight' => 100,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);

        // Target: only 1080x1920 (portrait, no match)
        $targetScreen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'resolution_width' => 1080,
            'resolution_height' => 1920,
        ]);
        OrderLineTarget::create([
            'order_line_id' => $this->targetOrderLine->id,
            'screen_id' => $targetScreen->id,
        ]);

        $response = $this->actingAsTenantAdmin()
            ->postJson("/api/admin/order-lines/{$this->sourceOrderLine->id}/copy-creatives", [
                'target_order_line_id' => $this->targetOrderLine->id,
            ]);

        $response->assertStatus(201);
        $data = $response->json('data');
        $this->assertEquals(0, $data['created']);
        $this->assertEquals(1, $data['skipped']);
        $this->assertEmpty($data['covered_screens']);
    }

    public function test_returns_empty_result_when_source_has_no_creatives(): void
    {
        $targetScreen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);
        OrderLineTarget::create([
            'order_line_id' => $this->targetOrderLine->id,
            'screen_id' => $targetScreen->id,
        ]);

        $response = $this->actingAsTenantAdmin()
            ->postJson("/api/admin/order-lines/{$this->sourceOrderLine->id}/copy-creatives", [
                'target_order_line_id' => $this->targetOrderLine->id,
            ]);

        $response->assertStatus(201);
        $data = $response->json('data');
        $this->assertEquals(0, $data['created']);
        $this->assertEquals(0, $data['skipped']);
        $this->assertEmpty($data['covered_screens']);
    }

    public function test_skips_duplicate_content_already_assigned_in_target(): void
    {
        // Source creative
        $sourceScreen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);
        $sourceTarget = OrderLineTarget::create([
            'order_line_id' => $this->sourceOrderLine->id,
            'screen_id' => $sourceScreen->id,
        ]);
        $content = Content::factory()->create([
            'tenant_id' => $this->tenant->id,
            'width' => 1920,
            'height' => 1080,
        ]);
        Creative::create([
            'order_line_target_id' => $sourceTarget->id,
            'content_id' => $content->id,
            'weight' => 100,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);

        // Target already has the same content assigned
        $targetScreen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);
        $targetTarget = OrderLineTarget::create([
            'order_line_id' => $this->targetOrderLine->id,
            'screen_id' => $targetScreen->id,
        ]);
        Creative::create([
            'order_line_target_id' => $targetTarget->id,
            'content_id' => $content->id,
            'weight' => 100,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);

        $response = $this->actingAsTenantAdmin()
            ->postJson("/api/admin/order-lines/{$this->sourceOrderLine->id}/copy-creatives", [
                'target_order_line_id' => $this->targetOrderLine->id,
            ]);

        $response->assertStatus(201);
        $data = $response->json('data');
        $this->assertEquals(0, $data['created']); // No new creatives (already exists)
        $this->assertEquals(0, $data['skipped']); // Not skipped — resolution matched but duplicate
    }

    // ─── VALIDATION ERRORS ───────────────────────────────────────────

    public function test_rejects_copy_to_same_order_line(): void
    {
        $response = $this->actingAsTenantAdmin()
            ->postJson("/api/admin/order-lines/{$this->sourceOrderLine->id}/copy-creatives", [
                'target_order_line_id' => $this->sourceOrderLine->id,
            ]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['target_order_line_id']);
    }

    public function test_rejects_copy_to_nonexistent_order_line(): void
    {
        $response = $this->actingAsTenantAdmin()
            ->postJson("/api/admin/order-lines/{$this->sourceOrderLine->id}/copy-creatives", [
                'target_order_line_id' => '00000000-0000-0000-0000-000000000000',
            ]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['target_order_line_id']);
    }

    public function test_rejects_copy_to_different_tenant(): void
    {
        $otherTenant = Tenant::factory()->create();
        $otherOrder = Order::factory()->create([
            'tenant_id' => $otherTenant->id,
            'starts_at' => '2025-01-01',
            'ends_at' => '2025-12-31',
        ]);
        $otherOrderLine = OrderLine::factory()->create([
            'order_id' => $otherOrder->id,
            'starts_at' => '2025-01-10',
            'ends_at' => '2025-01-31',
        ]);

        $response = $this->actingAsTenantAdmin()
            ->postJson("/api/admin/order-lines/{$this->sourceOrderLine->id}/copy-creatives", [
                'target_order_line_id' => $otherOrderLine->id,
            ]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['target_order_line_id']);
    }

    public function test_returns_404_for_nonexistent_source_order_line(): void
    {
        $response = $this->actingAsTenantAdmin()
            ->postJson('/api/admin/order-lines/00000000-0000-0000-0000-000000000000/copy-creatives', [
                'target_order_line_id' => $this->targetOrderLine->id,
            ]);

        $response->assertStatus(404);
    }

    public function test_rejects_missing_target_order_line_id(): void
    {
        $response = $this->actingAsTenantAdmin()
            ->postJson("/api/admin/order-lines/{$this->sourceOrderLine->id}/copy-creatives", []);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['target_order_line_id']);
    }
}
