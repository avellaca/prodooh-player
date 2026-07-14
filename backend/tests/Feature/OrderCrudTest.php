<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class OrderCrudTest extends TestCase
{
    use RefreshDatabase;

    private function actingAsSuperAdmin(): User
    {
        $user = User::factory()->superAdmin()->create();
        $this->actingAs($user, 'sanctum');

        return $user;
    }

    private function actingAsTenantAdmin(?Tenant $tenant = null): User
    {
        $tenant ??= Tenant::factory()->create();
        $user = User::factory()->tenantAdmin()->create(['tenant_id' => $tenant->id]);
        $this->actingAs($user, 'sanctum');

        return $user;
    }

    // --- INDEX ---

    public function test_super_admin_can_list_all_orders(): void
    {
        $tenant1 = Tenant::factory()->create();
        $tenant2 = Tenant::factory()->create();
        Order::factory()->create(['tenant_id' => $tenant1->id]);
        Order::factory()->create(['tenant_id' => $tenant2->id]);

        $this->actingAsSuperAdmin();

        $response = $this->getJson('/api/admin/orders');

        $response->assertOk()
            ->assertJsonCount(2, 'data');
    }

    public function test_tenant_admin_can_only_list_own_orders(): void
    {
        $tenant1 = Tenant::factory()->create();
        $tenant2 = Tenant::factory()->create();
        Order::factory()->create(['tenant_id' => $tenant1->id]);
        Order::factory()->create(['tenant_id' => $tenant2->id]);

        $this->actingAsTenantAdmin($tenant1);

        $response = $this->getJson('/api/admin/orders');

        $response->assertOk()
            ->assertJsonCount(1, 'data');
    }

    public function test_index_includes_order_lines_count(): void
    {
        $tenant = Tenant::factory()->create();
        $order = Order::factory()->create(['tenant_id' => $tenant->id]);

        $this->actingAsTenantAdmin($tenant);

        $response = $this->getJson('/api/admin/orders');

        $response->assertOk()
            ->assertJsonPath('data.0.order_lines_count', 0);
    }

    public function test_unauthenticated_user_cannot_list_orders(): void
    {
        $response = $this->getJson('/api/admin/orders');

        $response->assertUnauthorized();
    }

    // --- STORE ---

    public function test_super_admin_can_create_order_for_any_tenant(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsSuperAdmin();

        $response = $this->postJson('/api/admin/orders', [
            'tenant_id' => $tenant->id,
            'name' => 'Campaña Verano 2025',
            'advertiser_name' => 'Nike',
            'starts_at' => '2025-06-01',
            'ends_at' => '2025-08-31',
            'status' => 'draft',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.name', 'Campaña Verano 2025')
            ->assertJsonPath('data.advertiser_name', 'Nike')
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.tenant_id', $tenant->id);

        $this->assertDatabaseHas('orders', [
            'tenant_id' => $tenant->id,
            'name' => 'Campaña Verano 2025',
        ]);
    }

    public function test_tenant_admin_can_create_order_with_implicit_tenant(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $response = $this->postJson('/api/admin/orders', [
            'name' => 'Pedido Local',
            'starts_at' => '2025-01-01',
            'ends_at' => '2025-01-31',
            'status' => 'draft',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.tenant_id', $tenant->id)
            ->assertJsonPath('data.name', 'Pedido Local');
    }

    public function test_super_admin_must_provide_tenant_id(): void
    {
        $this->actingAsSuperAdmin();

        $response = $this->postJson('/api/admin/orders', [
            'name' => 'No Tenant Order',
            'starts_at' => '2025-01-01',
            'ends_at' => '2025-01-31',
            'status' => 'draft',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['tenant_id']);
    }

    public function test_super_admin_can_provide_tenant_id_via_query_param(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsSuperAdmin();

        $response = $this->postJson('/api/admin/orders?tenant_id=' . $tenant->id, [
            'name' => 'Via Query Param',
            'starts_at' => '2025-01-01',
            'ends_at' => '2025-01-31',
            'status' => 'draft',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.tenant_id', $tenant->id);
    }

    public function test_store_validates_required_fields(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $response = $this->postJson('/api/admin/orders', []);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['name', 'starts_at', 'ends_at', 'status']);
    }

    public function test_store_validates_name_max_length(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $response = $this->postJson('/api/admin/orders', [
            'name' => str_repeat('a', 256),
            'starts_at' => '2025-01-01',
            'ends_at' => '2025-01-31',
            'status' => 'draft',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['name']);
    }

    public function test_store_rejects_ends_at_before_starts_at(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $response = $this->postJson('/api/admin/orders', [
            'name' => 'Invalid Dates',
            'starts_at' => '2025-06-15',
            'ends_at' => '2025-06-01',
            'status' => 'draft',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['ends_at']);
    }

    public function test_store_validates_status_enum(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $response = $this->postJson('/api/admin/orders', [
            'name' => 'Invalid Status',
            'starts_at' => '2025-01-01',
            'ends_at' => '2025-01-31',
            'status' => 'invalid_status',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['status']);
    }

    public function test_store_allows_nullable_advertiser_name(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $response = $this->postJson('/api/admin/orders', [
            'name' => 'Sin Anunciante',
            'advertiser_name' => null,
            'starts_at' => '2025-01-01',
            'ends_at' => '2025-01-31',
            'status' => 'draft',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.advertiser_name', null);
    }

    // --- SHOW ---

    public function test_super_admin_can_view_any_order(): void
    {
        $order = Order::factory()->create();
        $this->actingAsSuperAdmin();

        $response = $this->getJson("/api/admin/orders/{$order->id}");

        $response->assertOk()
            ->assertJsonPath('data.id', $order->id)
            ->assertJsonPath('data.name', $order->name);
    }

    public function test_tenant_admin_can_view_own_order(): void
    {
        $tenant = Tenant::factory()->create();
        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $this->actingAsTenantAdmin($tenant);

        $response = $this->getJson("/api/admin/orders/{$order->id}");

        $response->assertOk()
            ->assertJsonPath('data.id', $order->id);
    }

    public function test_tenant_admin_cannot_view_other_tenant_order(): void
    {
        $tenant1 = Tenant::factory()->create();
        $tenant2 = Tenant::factory()->create();
        $order = Order::factory()->create(['tenant_id' => $tenant2->id]);
        $this->actingAsTenantAdmin($tenant1);

        $response = $this->getJson("/api/admin/orders/{$order->id}");

        $response->assertNotFound();
    }

    public function test_show_includes_order_lines_count(): void
    {
        $tenant = Tenant::factory()->create();
        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $this->actingAsTenantAdmin($tenant);

        $response = $this->getJson("/api/admin/orders/{$order->id}");

        $response->assertOk()
            ->assertJsonPath('data.order_lines_count', 0);
    }

    public function test_show_returns_404_for_nonexistent_order(): void
    {
        $this->actingAsSuperAdmin();

        $response = $this->getJson('/api/admin/orders/nonexistent-id');

        $response->assertNotFound();
    }

    // --- UPDATE ---

    public function test_super_admin_can_update_any_order(): void
    {
        $order = Order::factory()->create(['name' => 'Original Name']);
        $this->actingAsSuperAdmin();

        $response = $this->putJson("/api/admin/orders/{$order->id}", [
            'name' => 'Updated Name',
            'status' => 'active',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.name', 'Updated Name')
            ->assertJsonPath('data.status', 'active');
    }

    public function test_tenant_admin_can_update_own_order(): void
    {
        $tenant = Tenant::factory()->create();
        $order = Order::factory()->create(['tenant_id' => $tenant->id, 'name' => 'Original']);
        $this->actingAsTenantAdmin($tenant);

        $response = $this->putJson("/api/admin/orders/{$order->id}", [
            'name' => 'Updated',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.name', 'Updated');
    }

    public function test_tenant_admin_cannot_update_other_tenant_order(): void
    {
        $tenant1 = Tenant::factory()->create();
        $tenant2 = Tenant::factory()->create();
        $order = Order::factory()->create(['tenant_id' => $tenant2->id]);
        $this->actingAsTenantAdmin($tenant1);

        $response = $this->putJson("/api/admin/orders/{$order->id}", [
            'name' => 'Hacked',
        ]);

        $response->assertNotFound();
    }

    public function test_update_validates_ends_at_after_starts_at(): void
    {
        $order = Order::factory()->create();
        $this->actingAsSuperAdmin();

        $response = $this->putJson("/api/admin/orders/{$order->id}", [
            'starts_at' => '2025-06-15',
            'ends_at' => '2025-06-01',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['ends_at']);
    }

    public function test_update_validates_status_enum(): void
    {
        $order = Order::factory()->create();
        $this->actingAsSuperAdmin();

        $response = $this->putJson("/api/admin/orders/{$order->id}", [
            'status' => 'cancelled',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['status']);
    }

    // --- DESTROY ---

    public function test_super_admin_can_delete_any_order(): void
    {
        $order = Order::factory()->create();
        $this->actingAsSuperAdmin();

        $response = $this->deleteJson("/api/admin/orders/{$order->id}");

        $response->assertOk()
            ->assertJsonPath('message', 'Order deleted successfully.');

        $this->assertDatabaseMissing('orders', ['id' => $order->id]);
    }

    public function test_tenant_admin_can_delete_own_order(): void
    {
        $tenant = Tenant::factory()->create();
        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $this->actingAsTenantAdmin($tenant);

        $response = $this->deleteJson("/api/admin/orders/{$order->id}");

        $response->assertOk();
        $this->assertDatabaseMissing('orders', ['id' => $order->id]);
    }

    public function test_tenant_admin_cannot_delete_other_tenant_order(): void
    {
        $tenant1 = Tenant::factory()->create();
        $tenant2 = Tenant::factory()->create();
        $order = Order::factory()->create(['tenant_id' => $tenant2->id]);
        $this->actingAsTenantAdmin($tenant1);

        $response = $this->deleteJson("/api/admin/orders/{$order->id}");

        $response->assertNotFound();
        $this->assertDatabaseHas('orders', ['id' => $order->id]);
    }

    public function test_destroy_returns_404_for_nonexistent_order(): void
    {
        $this->actingAsSuperAdmin();

        $response = $this->deleteJson('/api/admin/orders/nonexistent-id');

        $response->assertNotFound();
    }
}
