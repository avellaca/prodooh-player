<?php

namespace Tests\Feature;

use App\Models\Screen;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TenantScopeMiddlewareTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenantA;
    private Tenant $tenantB;
    private User $tenantAdminA;
    private User $tenantAdminB;
    private User $superAdmin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenantA = Tenant::factory()->create(['name' => 'Tenant A']);
        $this->tenantB = Tenant::factory()->create(['name' => 'Tenant B']);

        $this->tenantAdminA = User::factory()->tenantAdmin()->create([
            'tenant_id' => $this->tenantA->id,
        ]);

        $this->tenantAdminB = User::factory()->tenantAdmin()->create([
            'tenant_id' => $this->tenantB->id,
        ]);

        $this->superAdmin = User::factory()->superAdmin()->create();

        // Create screens for each tenant
        Screen::factory()->count(3)->create(['tenant_id' => $this->tenantA->id]);
        Screen::factory()->count(2)->create(['tenant_id' => $this->tenantB->id]);
    }

    public function test_tenant_admin_can_only_see_own_tenant_screens(): void
    {
        $response = $this->actingAs($this->tenantAdminA)
            ->getJson('/api/admin/screens');

        $response->assertOk();

        $screens = $response->json('data');
        $this->assertCount(3, $screens);

        foreach ($screens as $screen) {
            $this->assertEquals($this->tenantA->id, $screen['tenant_id']);
        }
    }

    public function test_tenant_admin_b_can_only_see_own_tenant_screens(): void
    {
        $response = $this->actingAs($this->tenantAdminB)
            ->getJson('/api/admin/screens');

        $response->assertOk();

        $screens = $response->json('data');
        $this->assertCount(2, $screens);

        foreach ($screens as $screen) {
            $this->assertEquals($this->tenantB->id, $screen['tenant_id']);
        }
    }

    public function test_super_admin_can_see_all_tenants_screens(): void
    {
        $response = $this->actingAs($this->superAdmin)
            ->getJson('/api/admin/screens');

        $response->assertOk();

        $screens = $response->json('data');
        $this->assertCount(5, $screens);
    }

    public function test_tenant_admin_cannot_access_other_tenants_resources(): void
    {
        // Tenant Admin A should never see Tenant B's screens
        $response = $this->actingAs($this->tenantAdminA)
            ->getJson('/api/admin/screens');

        $response->assertOk();

        $screens = $response->json('data');

        $tenantBIds = Screen::withoutGlobalScopes()
            ->where('tenant_id', $this->tenantB->id)
            ->pluck('id')
            ->toArray();

        foreach ($screens as $screen) {
            $this->assertNotContains($screen['id'], $tenantBIds);
        }
    }

    public function test_middleware_sets_tenant_context_for_tenant_admin(): void
    {
        $this->actingAs($this->tenantAdminA)
            ->getJson('/api/admin/screens');

        $this->assertEquals(
            $this->tenantA->id,
            app('current_tenant_id')
        );
    }

    public function test_middleware_does_not_set_tenant_context_for_super_admin(): void
    {
        $this->actingAs($this->superAdmin)
            ->getJson('/api/admin/screens');

        $this->assertFalse(app()->bound('current_tenant_id'));
    }

    public function test_unauthenticated_request_is_rejected(): void
    {
        $response = $this->getJson('/api/admin/screens');

        $response->assertUnauthorized();
    }
}
