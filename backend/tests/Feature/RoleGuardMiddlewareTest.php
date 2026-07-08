<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RoleGuardMiddlewareTest extends TestCase
{
    use RefreshDatabase;

    private User $superAdmin;
    private User $tenantAdmin;
    private string $superAdminToken;
    private string $tenantAdminToken;

    protected function setUp(): void
    {
        parent::setUp();

        $tenant = Tenant::factory()->create();

        $this->superAdmin = User::factory()->superAdmin()->create();
        $this->tenantAdmin = User::factory()->tenantAdmin()->create([
            'tenant_id' => $tenant->id,
        ]);

        $this->superAdminToken = $this->superAdmin->createToken('test-token')->plainTextToken;
        $this->tenantAdminToken = $this->tenantAdmin->createToken('test-token')->plainTextToken;
    }

    // --- Tenant management routes: super-admin only ---

    public function test_super_admin_can_list_tenants(): void
    {
        $response = $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken)
            ->getJson('/api/admin/tenants');

        $response->assertOk();
    }

    public function test_super_admin_can_create_tenant(): void
    {
        $response = $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken)
            ->postJson('/api/admin/tenants', ['name' => 'Test Tenant']);

        $response->assertStatus(201);
    }

    public function test_super_admin_can_view_tenant(): void
    {
        $tenant = Tenant::factory()->create();

        $response = $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken)
            ->getJson("/api/admin/tenants/{$tenant->id}");

        $response->assertOk();
    }

    public function test_super_admin_can_update_tenant(): void
    {
        $tenant = Tenant::factory()->create();

        $response = $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken)
            ->putJson("/api/admin/tenants/{$tenant->id}", ['name' => 'Updated']);

        $response->assertOk();
    }

    public function test_super_admin_can_delete_tenant(): void
    {
        $tenant = Tenant::factory()->create();

        $response = $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken)
            ->deleteJson("/api/admin/tenants/{$tenant->id}");

        $response->assertOk();
    }

    public function test_tenant_admin_cannot_list_tenants(): void
    {
        $response = $this->withHeader('Authorization', 'Bearer ' . $this->tenantAdminToken)
            ->getJson('/api/admin/tenants');

        $response->assertForbidden()
            ->assertJson([
                'error' => 'Forbidden',
                'message' => 'You do not have permission to access this resource.',
            ]);
    }

    public function test_tenant_admin_cannot_create_tenant(): void
    {
        $response = $this->withHeader('Authorization', 'Bearer ' . $this->tenantAdminToken)
            ->postJson('/api/admin/tenants');

        $response->assertForbidden();
    }

    public function test_tenant_admin_cannot_update_tenant(): void
    {
        $response = $this->withHeader('Authorization', 'Bearer ' . $this->tenantAdminToken)
            ->putJson('/api/admin/tenants/some-uuid');

        $response->assertForbidden();
    }

    public function test_tenant_admin_cannot_delete_tenant(): void
    {
        $response = $this->withHeader('Authorization', 'Bearer ' . $this->tenantAdminToken)
            ->deleteJson('/api/admin/tenants/some-uuid');

        $response->assertForbidden();
    }

    // --- Shared routes: accessible by both roles ---

    public function test_super_admin_can_access_screens(): void
    {
        $response = $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken)
            ->getJson('/api/admin/screens');

        $response->assertOk();
    }

    public function test_tenant_admin_can_access_screens(): void
    {
        $response = $this->withHeader('Authorization', 'Bearer ' . $this->tenantAdminToken)
            ->getJson('/api/admin/screens');

        $response->assertOk();
    }

    public function test_super_admin_can_access_playlists(): void
    {
        $response = $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken)
            ->getJson('/api/admin/playlists');

        $response->assertOk();
    }

    public function test_tenant_admin_can_access_playlists(): void
    {
        $response = $this->withHeader('Authorization', 'Bearer ' . $this->tenantAdminToken)
            ->getJson('/api/admin/playlists');

        $response->assertOk();
    }

    public function test_super_admin_can_access_content(): void
    {
        $response = $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken)
            ->getJson('/api/admin/content');

        $response->assertOk();
    }

    public function test_tenant_admin_can_access_content(): void
    {
        $response = $this->withHeader('Authorization', 'Bearer ' . $this->tenantAdminToken)
            ->getJson('/api/admin/content');

        $response->assertOk();
    }

    public function test_super_admin_can_access_analytics(): void
    {
        $response = $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken)
            ->getJson('/api/admin/analytics/playback');

        $response->assertOk();
    }

    public function test_tenant_admin_can_access_analytics(): void
    {
        $response = $this->withHeader('Authorization', 'Bearer ' . $this->tenantAdminToken)
            ->getJson('/api/admin/analytics/playback');

        $response->assertOk();
    }

    // --- Unauthenticated access ---

    public function test_unauthenticated_user_cannot_access_tenant_routes(): void
    {
        $response = $this->getJson('/api/admin/tenants');

        $response->assertUnauthorized();
    }

    public function test_unauthenticated_user_cannot_access_shared_routes(): void
    {
        $response = $this->getJson('/api/admin/screens');

        $response->assertUnauthorized();
    }
}
