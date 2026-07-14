<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\TestCase;

class OrderLineTargetCrudTest extends TestCase
{
    use DatabaseTransactions;

    private function actingAsTenantAdmin(?Tenant $tenant = null): User
    {
        $tenant ??= Tenant::factory()->create();
        $user = User::factory()->tenantAdmin()->create(['tenant_id' => $tenant->id]);
        $this->actingAs($user, 'sanctum');

        return $user;
    }

    private function actingAsSuperAdmin(): User
    {
        $user = User::factory()->superAdmin()->create();
        $this->actingAs($user, 'sanctum');

        return $user;
    }

    // --- STORE: XOR Validation ---

    public function test_store_rejects_when_both_screen_id_and_screen_group_id_present(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
        $group = ScreenGroup::factory()->create(['tenant_id' => $tenant->id]);

        $response = $this->postJson("/api/admin/order-lines/{$orderLine->id}/targets", [
            'screen_id' => $screen->id,
            'screen_group_id' => $group->id,
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['screen_id', 'screen_group_id']);
    }

    public function test_store_rejects_when_neither_screen_id_nor_screen_group_id_present(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);

        $response = $this->postJson("/api/admin/order-lines/{$orderLine->id}/targets", []);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['screen_id', 'screen_group_id']);
    }

    public function test_store_rejects_when_both_are_null(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);

        $response = $this->postJson("/api/admin/order-lines/{$orderLine->id}/targets", [
            'screen_id' => null,
            'screen_group_id' => null,
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['screen_id', 'screen_group_id']);
    }

    // --- STORE: Success cases ---

    public function test_store_creates_target_with_screen_id(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);

        $response = $this->postJson("/api/admin/order-lines/{$orderLine->id}/targets", [
            'screen_id' => $screen->id,
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.order_line_id', $orderLine->id)
            ->assertJsonPath('data.screen_id', $screen->id)
            ->assertJsonPath('data.screen_group_id', null);

        $this->assertDatabaseHas('order_line_targets', [
            'order_line_id' => $orderLine->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);
    }

    public function test_store_creates_target_with_screen_group_id(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);
        $group = ScreenGroup::factory()->create(['tenant_id' => $tenant->id]);

        $response = $this->postJson("/api/admin/order-lines/{$orderLine->id}/targets", [
            'screen_group_id' => $group->id,
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.order_line_id', $orderLine->id)
            ->assertJsonPath('data.screen_id', null)
            ->assertJsonPath('data.screen_group_id', $group->id);

        $this->assertDatabaseHas('order_line_targets', [
            'order_line_id' => $orderLine->id,
            'screen_id' => null,
            'screen_group_id' => $group->id,
        ]);
    }

    // --- STORE: Tenant validation ---

    public function test_store_rejects_screen_from_different_tenant(): void
    {
        $tenant1 = Tenant::factory()->create();
        $tenant2 = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant1);

        $order = Order::factory()->create(['tenant_id' => $tenant1->id]);
        $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);
        $screenOtherTenant = Screen::factory()->create(['tenant_id' => $tenant2->id]);

        $response = $this->postJson("/api/admin/order-lines/{$orderLine->id}/targets", [
            'screen_id' => $screenOtherTenant->id,
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['screen_id']);
    }

    public function test_store_rejects_screen_group_from_different_tenant(): void
    {
        $tenant1 = Tenant::factory()->create();
        $tenant2 = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant1);

        $order = Order::factory()->create(['tenant_id' => $tenant1->id]);
        $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);
        $groupOtherTenant = ScreenGroup::factory()->create(['tenant_id' => $tenant2->id]);

        $response = $this->postJson("/api/admin/order-lines/{$orderLine->id}/targets", [
            'screen_group_id' => $groupOtherTenant->id,
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['screen_group_id']);
    }

    public function test_store_rejects_nonexistent_screen_id(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);

        $response = $this->postJson("/api/admin/order-lines/{$orderLine->id}/targets", [
            'screen_id' => 'nonexistent-uuid',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['screen_id']);
    }

    public function test_store_rejects_nonexistent_screen_group_id(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);

        $response = $this->postJson("/api/admin/order-lines/{$orderLine->id}/targets", [
            'screen_group_id' => 'nonexistent-uuid',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['screen_group_id']);
    }

    // --- STORE: Order line not found ---

    public function test_store_returns_404_for_nonexistent_order_line(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $response = $this->postJson('/api/admin/order-lines/nonexistent-uuid/targets', [
            'screen_id' => 'some-uuid',
        ]);

        $response->assertNotFound();
    }

    // --- DESTROY ---

    public function test_destroy_removes_target(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);

        $target = OrderLineTarget::create([
            'order_line_id' => $orderLine->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);

        $response = $this->deleteJson("/api/admin/order-line-targets/{$target->id}");

        $response->assertOk()
            ->assertJsonPath('message', 'Target removed successfully.');

        $this->assertDatabaseMissing('order_line_targets', ['id' => $target->id]);
    }

    public function test_destroy_returns_404_for_nonexistent_target(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $response = $this->deleteJson('/api/admin/order-line-targets/nonexistent-uuid');

        $response->assertNotFound();
    }
}
