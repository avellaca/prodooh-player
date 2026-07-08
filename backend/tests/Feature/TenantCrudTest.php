<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TenantCrudTest extends TestCase
{
    use RefreshDatabase;

    private function actingAsSuperAdmin(): User
    {
        $user = User::factory()->superAdmin()->create();
        $this->actingAs($user, 'sanctum');

        return $user;
    }

    private function actingAsTenantAdmin(): User
    {
        $tenant = Tenant::factory()->create();
        $user = User::factory()->tenantAdmin()->create(['tenant_id' => $tenant->id]);
        $this->actingAs($user, 'sanctum');

        return $user;
    }

    // ─── INDEX ──────────────────────────────────────────────────────────

    public function test_super_admin_can_list_tenants(): void
    {
        $this->actingAsSuperAdmin();
        Tenant::factory()->count(3)->create();

        $response = $this->getJson('/api/admin/tenants');

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [
                    '*' => ['id', 'name', 'default_duration_seconds', 'default_timezone'],
                ],
                'current_page',
                'last_page',
                'per_page',
                'total',
            ]);

        $this->assertCount(3, $response->json('data'));
    }

    public function test_tenants_list_is_paginated(): void
    {
        $this->actingAsSuperAdmin();
        Tenant::factory()->count(20)->create();

        $response = $this->getJson('/api/admin/tenants?per_page=5');

        $response->assertOk();
        $this->assertCount(5, $response->json('data'));
        $this->assertEquals(20, $response->json('total'));
    }

    // ─── STORE ──────────────────────────────────────────────────────────

    public function test_super_admin_can_create_tenant(): void
    {
        $this->actingAsSuperAdmin();

        $response = $this->postJson('/api/admin/tenants', [
            'name' => 'Acme Corp',
            'default_duration_seconds' => 15,
            'default_timezone' => 'America/Bogota',
            'transition_type' => 'fade',
            'transition_duration_ms' => 500,
        ]);

        $response->assertCreated()
            ->assertJsonStructure(['id', 'name', 'api_credential', 'default_duration_seconds'])
            ->assertJson([
                'name' => 'Acme Corp',
                'default_duration_seconds' => 15,
                'default_timezone' => 'America/Bogota',
                'transition_type' => 'fade',
                'transition_duration_ms' => 500,
            ]);

        // api_credential should be a valid UUID
        $apiCredential = $response->json('api_credential');
        $this->assertMatchesRegularExpression(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',
            $apiCredential
        );

        $this->assertDatabaseHas('tenants', ['name' => 'Acme Corp']);
    }

    public function test_create_tenant_requires_name(): void
    {
        $this->actingAsSuperAdmin();

        $response = $this->postJson('/api/admin/tenants', []);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['name']);
    }

    public function test_create_tenant_generates_unique_api_credential(): void
    {
        $this->actingAsSuperAdmin();

        $response1 = $this->postJson('/api/admin/tenants', ['name' => 'Tenant 1']);
        $response2 = $this->postJson('/api/admin/tenants', ['name' => 'Tenant 2']);

        $this->assertNotEquals(
            $response1->json('api_credential'),
            $response2->json('api_credential')
        );
    }

    // ─── SHOW ───────────────────────────────────────────────────────────

    public function test_super_admin_can_view_tenant(): void
    {
        $this->actingAsSuperAdmin();
        $tenant = Tenant::factory()->create(['name' => 'Test Tenant']);

        $response = $this->getJson("/api/admin/tenants/{$tenant->id}");

        $response->assertOk()
            ->assertJson(['id' => $tenant->id, 'name' => 'Test Tenant']);
    }

    public function test_show_returns_404_for_nonexistent_tenant(): void
    {
        $this->actingAsSuperAdmin();

        $response = $this->getJson('/api/admin/tenants/nonexistent-uuid');

        $response->assertNotFound();
    }

    // ─── UPDATE ─────────────────────────────────────────────────────────

    public function test_super_admin_can_update_tenant(): void
    {
        $this->actingAsSuperAdmin();
        $tenant = Tenant::factory()->create(['name' => 'Old Name']);

        $response = $this->putJson("/api/admin/tenants/{$tenant->id}", [
            'name' => 'New Name',
            'default_timezone' => 'America/Lima',
        ]);

        $response->assertOk()
            ->assertJson([
                'name' => 'New Name',
                'default_timezone' => 'America/Lima',
            ]);

        $this->assertDatabaseHas('tenants', ['id' => $tenant->id, 'name' => 'New Name']);
    }

    public function test_update_validates_transition_type(): void
    {
        $this->actingAsSuperAdmin();
        $tenant = Tenant::factory()->create();

        $response = $this->putJson("/api/admin/tenants/{$tenant->id}", [
            'transition_type' => 'invalid_type',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['transition_type']);
    }

    // ─── DESTROY ────────────────────────────────────────────────────────

    public function test_super_admin_can_delete_tenant(): void
    {
        $this->actingAsSuperAdmin();
        $tenant = Tenant::factory()->create();

        $response = $this->deleteJson("/api/admin/tenants/{$tenant->id}");

        $response->assertOk()
            ->assertJson(['message' => 'Tenant deleted successfully.']);

        $this->assertDatabaseMissing('tenants', ['id' => $tenant->id]);
    }

    public function test_delete_returns_404_for_nonexistent_tenant(): void
    {
        $this->actingAsSuperAdmin();

        $response = $this->deleteJson('/api/admin/tenants/nonexistent-uuid');

        $response->assertNotFound();
    }

    // ─── ACCESS CONTROL ─────────────────────────────────────────────────

    public function test_tenant_admin_cannot_access_tenant_endpoints(): void
    {
        $this->actingAsTenantAdmin();

        $this->getJson('/api/admin/tenants')->assertForbidden();
        $this->postJson('/api/admin/tenants', ['name' => 'Test'])->assertForbidden();
    }

    public function test_unauthenticated_user_cannot_access_tenant_endpoints(): void
    {
        $this->getJson('/api/admin/tenants')->assertUnauthorized();
        $this->postJson('/api/admin/tenants', ['name' => 'Test'])->assertUnauthorized();
    }
}
