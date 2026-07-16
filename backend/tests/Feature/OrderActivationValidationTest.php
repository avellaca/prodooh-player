<?php

namespace Tests\Feature;

use App\Models\Content;
use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Tests for Order activation validation (Requirement 5.6).
 *
 * IF un usuario intenta activar una orden que no tiene al menos 1 OrderLine
 * con al menos 1 Creative asignado, THEN THE Backend SHALL rechazar la
 * activación con un mensaje de error descriptivo.
 */
class OrderActivationValidationTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;
    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::factory()->create();
        $this->user = User::factory()->tenantAdmin()->create(['tenant_id' => $this->tenant->id]);
        $this->actingAs($this->user, 'sanctum');
    }

    public function test_rejects_activation_when_order_has_no_order_lines(): void
    {
        $order = Order::factory()->create([
            'tenant_id' => $this->tenant->id,
            'status' => 'draft',
        ]);

        $response = $this->putJson("/api/admin/orders/{$order->id}", [
            'status' => 'active',
        ]);

        $response->assertStatus(422)
            ->assertJsonPath('message', 'Cannot activate order.')
            ->assertJsonValidationErrors(['status']);
    }

    public function test_rejects_activation_when_order_lines_have_no_creatives(): void
    {
        $order = Order::factory()->create([
            'tenant_id' => $this->tenant->id,
            'status' => 'draft',
        ]);

        // Create an OrderLine without any creatives
        OrderLine::factory()->create([
            'order_id' => $order->id,
        ]);

        $response = $this->putJson("/api/admin/orders/{$order->id}", [
            'status' => 'active',
        ]);

        $response->assertStatus(422)
            ->assertJsonPath('message', 'Cannot activate order.')
            ->assertJsonValidationErrors(['status']);
    }

    public function test_rejects_activation_when_order_line_has_target_but_no_creative(): void
    {
        $order = Order::factory()->create([
            'tenant_id' => $this->tenant->id,
            'status' => 'draft',
        ]);

        $orderLine = OrderLine::factory()->create([
            'order_id' => $order->id,
        ]);

        $screenGroup = ScreenGroup::factory()->create(['tenant_id' => $this->tenant->id]);
        $screen = Screen::factory()->create(['group_id' => $screenGroup->id]);

        // Target exists but no creative assigned
        OrderLineTarget::factory()->create([
            'order_line_id' => $orderLine->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);

        $response = $this->putJson("/api/admin/orders/{$order->id}", [
            'status' => 'active',
        ]);

        $response->assertStatus(422)
            ->assertJsonPath('message', 'Cannot activate order.')
            ->assertJsonValidationErrors(['status']);
    }

    public function test_allows_activation_when_order_line_has_creative(): void
    {
        $order = Order::factory()->create([
            'tenant_id' => $this->tenant->id,
            'status' => 'draft',
        ]);

        $orderLine = OrderLine::factory()->create([
            'order_id' => $order->id,
        ]);

        $screenGroup = ScreenGroup::factory()->create(['tenant_id' => $this->tenant->id]);
        $screen = Screen::factory()->create(['group_id' => $screenGroup->id]);

        $target = OrderLineTarget::factory()->create([
            'order_line_id' => $orderLine->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);

        $content = Content::factory()->create(['tenant_id' => $this->tenant->id]);

        Creative::factory()->create([
            'order_line_target_id' => $target->id,
            'order_line_id' => $orderLine->id,
            'content_id' => $content->id,
        ]);

        $response = $this->putJson("/api/admin/orders/{$order->id}", [
            'status' => 'active',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.status', 'active');
    }

    public function test_error_message_is_descriptive(): void
    {
        $order = Order::factory()->create([
            'tenant_id' => $this->tenant->id,
            'status' => 'draft',
        ]);

        $response = $this->putJson("/api/admin/orders/{$order->id}", [
            'status' => 'active',
        ]);

        $response->assertStatus(422);

        $json = $response->json();
        $this->assertArrayHasKey('errors', $json);
        $this->assertArrayHasKey('status', $json['errors']);
        $this->assertStringContainsString(
            'no tiene al menos 1 línea de orden con al menos 1 creativo asignado',
            $json['errors']['status'][0]
        );
    }

    public function test_non_activation_status_changes_are_not_blocked(): void
    {
        $order = Order::factory()->create([
            'tenant_id' => $this->tenant->id,
            'status' => 'draft',
        ]);

        // Changing to 'paused' should not trigger the activation validation
        $response = $this->putJson("/api/admin/orders/{$order->id}", [
            'status' => 'paused',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.status', 'paused');
    }

    public function test_multiple_order_lines_only_one_needs_creative(): void
    {
        $order = Order::factory()->create([
            'tenant_id' => $this->tenant->id,
            'status' => 'draft',
        ]);

        // First order line without creative
        OrderLine::factory()->create([
            'order_id' => $order->id,
        ]);

        // Second order line WITH creative
        $orderLine2 = OrderLine::factory()->create([
            'order_id' => $order->id,
        ]);

        $screenGroup = ScreenGroup::factory()->create(['tenant_id' => $this->tenant->id]);
        $screen = Screen::factory()->create(['group_id' => $screenGroup->id]);

        $target = OrderLineTarget::factory()->create([
            'order_line_id' => $orderLine2->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);

        $content = Content::factory()->create(['tenant_id' => $this->tenant->id]);

        Creative::factory()->create([
            'order_line_target_id' => $target->id,
            'order_line_id' => $orderLine2->id,
            'content_id' => $content->id,
        ]);

        $response = $this->putJson("/api/admin/orders/{$order->id}", [
            'status' => 'active',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.status', 'active');
    }
}
