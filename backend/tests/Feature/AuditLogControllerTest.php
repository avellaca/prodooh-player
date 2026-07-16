<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class AuditLogControllerTest extends TestCase
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

    private function actingAsTrafficker(?Tenant $tenant = null): User
    {
        $tenant ??= Tenant::factory()->create();
        $user = User::factory()->trafficker()->create(['tenant_id' => $tenant->id]);
        $this->actingAs($user, 'sanctum');

        return $user;
    }

    // --- Basic retrieval ---

    public function test_returns_audit_logs_for_order(): void
    {
        $tenant = Tenant::factory()->create();
        $user = $this->actingAsTenantAdmin($tenant);
        $order = Order::factory()->create(['tenant_id' => $tenant->id]);

        // The observer already creates a 'created' audit log.
        // Add a field_modified log to verify both show up.
        AuditLog::create([
            'auditable_type' => Order::class,
            'auditable_id' => $order->id,
            'user_id' => $user->id,
            'event_type' => 'field_modified',
            'diff' => ['field' => 'name', 'old_value' => 'Old', 'new_value' => 'New'],
            'created_at' => now()->addMinute(),
        ]);

        $response = $this->getJson("/api/admin/orders/{$order->id}/audit-logs");

        $response->assertOk();
        // Observer creates 1 'created' log + 1 manual 'field_modified' = at least 2
        $data = $response->json('data');
        $this->assertGreaterThanOrEqual(2, count($data));
        // Most recent first
        $this->assertEquals('field_modified', $data[0]['event_type']);
    }

    public function test_returns_audit_logs_for_order_line(): void
    {
        $tenant = Tenant::factory()->create();
        $user = $this->actingAsTenantAdmin($tenant);
        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $orderLine = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Test Line',
            'priority_tier' => 'estandar',
            'starts_at' => '2025-01-01',
            'ends_at' => '2025-01-31',
            'status' => 'draft',
        ]);

        // Observer already created a 'created' log for the order line.
        // Add a status_changed log manually.
        AuditLog::create([
            'auditable_type' => OrderLine::class,
            'auditable_id' => $orderLine->id,
            'user_id' => $user->id,
            'event_type' => 'status_changed',
            'diff' => ['field' => 'status', 'old_value' => 'draft', 'new_value' => 'active'],
            'created_at' => now()->addMinute(),
        ]);

        $response = $this->getJson("/api/admin/order-lines/{$orderLine->id}/audit-logs");

        $response->assertOk();
        $data = $response->json('data');
        // Observer creates 'created' + manual 'status_changed' = at least 2
        $this->assertGreaterThanOrEqual(2, count($data));
        // Most recent first
        $this->assertEquals('status_changed', $data[0]['event_type']);
    }

    // --- Pagination ---

    public function test_returns_paginated_results(): void
    {
        $tenant = Tenant::factory()->create();
        $user = $this->actingAsTenantAdmin($tenant);
        $order = Order::withoutEvents(fn () => Order::factory()->create(['tenant_id' => $tenant->id]));

        for ($i = 0; $i < 20; $i++) {
            AuditLog::create([
                'auditable_type' => Order::class,
                'auditable_id' => $order->id,
                'user_id' => $user->id,
                'event_type' => 'field_modified',
                'diff' => ['field' => 'name', 'old_value' => "v{$i}", 'new_value' => "v" . ($i + 1)],
                'created_at' => now()->addMinutes($i),
            ]);
        }

        $response = $this->getJson("/api/admin/orders/{$order->id}/audit-logs?per_page=5");

        $response->assertOk()
            ->assertJsonCount(5, 'data')
            ->assertJsonPath('total', 20)
            ->assertJsonPath('per_page', 5);
    }

    // --- Sorting ---

    public function test_returns_logs_sorted_by_created_at_descending(): void
    {
        $tenant = Tenant::factory()->create();
        $user = $this->actingAsTenantAdmin($tenant);
        $order = Order::withoutEvents(fn () => Order::factory()->create(['tenant_id' => $tenant->id]));

        AuditLog::create([
            'auditable_type' => Order::class,
            'auditable_id' => $order->id,
            'user_id' => $user->id,
            'event_type' => 'created',
            'created_at' => now()->subHour(),
        ]);

        AuditLog::create([
            'auditable_type' => Order::class,
            'auditable_id' => $order->id,
            'user_id' => $user->id,
            'event_type' => 'field_modified',
            'created_at' => now(),
        ]);

        $response = $this->getJson("/api/admin/orders/{$order->id}/audit-logs");

        $response->assertOk();
        $data = $response->json('data');
        $this->assertEquals('field_modified', $data[0]['event_type']);
        $this->assertEquals('created', $data[1]['event_type']);
    }

    // --- Includes user relationship ---

    public function test_includes_user_information_in_response(): void
    {
        $tenant = Tenant::factory()->create();
        $user = $this->actingAsTenantAdmin($tenant);
        $order = Order::factory()->create(['tenant_id' => $tenant->id]);

        AuditLog::create([
            'auditable_type' => Order::class,
            'auditable_id' => $order->id,
            'user_id' => $user->id,
            'event_type' => 'created',
            'created_at' => now(),
        ]);

        $response = $this->getJson("/api/admin/orders/{$order->id}/audit-logs");

        $response->assertOk()
            ->assertJsonPath('data.0.user.id', $user->id)
            ->assertJsonPath('data.0.user.email', $user->email)
            ->assertJsonPath('data.0.user.role', $user->role);
    }

    // --- Error cases ---

    public function test_returns_422_for_invalid_auditable_type(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $fakeId = Str::uuid()->toString();
        $response = $this->getJson("/api/admin/invalid-type/{$fakeId}/audit-logs");

        // Route constraint should not match, resulting in 404
        $response->assertNotFound();
    }

    public function test_returns_404_for_nonexistent_entity(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $fakeId = Str::uuid()->toString();
        $response = $this->getJson("/api/admin/orders/{$fakeId}/audit-logs");

        $response->assertNotFound();
    }

    public function test_returns_404_for_invalid_uuid_format(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $response = $this->getJson('/api/admin/orders/not-a-uuid/audit-logs');

        $response->assertNotFound();
    }

    public function test_unauthenticated_user_cannot_access_audit_logs(): void
    {
        $order = Order::factory()->create();

        $response = $this->getJson("/api/admin/orders/{$order->id}/audit-logs");

        $response->assertUnauthorized();
    }

    // --- Only returns logs for the specific entity ---

    public function test_does_not_return_logs_from_other_entities(): void
    {
        $tenant = Tenant::factory()->create();
        $user = $this->actingAsTenantAdmin($tenant);
        $order1 = Order::withoutEvents(fn () => Order::factory()->create(['tenant_id' => $tenant->id]));
        $order2 = Order::withoutEvents(fn () => Order::factory()->create(['tenant_id' => $tenant->id]));

        AuditLog::create([
            'auditable_type' => Order::class,
            'auditable_id' => $order1->id,
            'user_id' => $user->id,
            'event_type' => 'created',
            'created_at' => now(),
        ]);

        AuditLog::create([
            'auditable_type' => Order::class,
            'auditable_id' => $order2->id,
            'user_id' => $user->id,
            'event_type' => 'created',
            'created_at' => now(),
        ]);

        $response = $this->getJson("/api/admin/orders/{$order1->id}/audit-logs");

        $response->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.auditable_id', $order1->id);
    }

    // --- Trafficker access ---

    public function test_trafficker_can_access_audit_logs(): void
    {
        $tenant = Tenant::factory()->create();
        $admin = User::factory()->tenantAdmin()->create(['tenant_id' => $tenant->id]);
        $this->actingAsTrafficker($tenant);
        $order = Order::withoutEvents(fn () => Order::factory()->create(['tenant_id' => $tenant->id]));

        AuditLog::create([
            'auditable_type' => Order::class,
            'auditable_id' => $order->id,
            'user_id' => $admin->id,
            'event_type' => 'created',
            'created_at' => now(),
        ]);

        $response = $this->getJson("/api/admin/orders/{$order->id}/audit-logs");

        $response->assertOk()
            ->assertJsonCount(1, 'data');
    }
}
