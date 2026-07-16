<?php

namespace Tests\Feature;

use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class LoopConfigControllerTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;
    private User $superAdmin;
    private User $tenantAdmin;
    private User $trafficker;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::factory()->create([
            'num_slots' => 10,
            'ssp_slots' => 2,
            'playlist_slots' => 1,
            'sync_interval_seconds' => 240,
            'cache_flush_interval_hours' => 24,
        ]);

        $this->superAdmin = User::factory()->superAdmin()->create();
        $this->tenantAdmin = User::factory()->tenantAdmin()->create(['tenant_id' => $this->tenant->id]);
        $this->trafficker = User::factory()->trafficker()->create(['tenant_id' => $this->tenant->id]);
    }

    // ─── PUT /api/admin/tenants/{id}/loop-config ─────────────────────────

    public function test_super_admin_can_update_loop_config(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum');

        $response = $this->putJson("/api/admin/tenants/{$this->tenant->id}/loop-config", [
            'num_slots' => 12,
            'ssp_slots' => 3,
            'playlist_slots' => 2,
        ]);

        $response->assertOk()
            ->assertJson([
                'num_slots' => 12,
                'ssp_slots' => 3,
                'playlist_slots' => 2,
            ]);

        $this->assertDatabaseHas('tenants', [
            'id' => $this->tenant->id,
            'num_slots' => 12,
            'ssp_slots' => 3,
            'playlist_slots' => 2,
        ]);
    }

    public function test_tenant_admin_can_update_own_tenant_loop_config(): void
    {
        $this->actingAs($this->tenantAdmin, 'sanctum');

        $response = $this->putJson("/api/admin/tenants/{$this->tenant->id}/loop-config", [
            'num_slots' => 15,
            'ssp_slots' => 4,
            'playlist_slots' => 2,
        ]);

        $response->assertOk()
            ->assertJson([
                'num_slots' => 15,
                'ssp_slots' => 4,
                'playlist_slots' => 2,
            ]);
    }

    public function test_tenant_admin_cannot_update_other_tenant_loop_config(): void
    {
        $otherTenant = Tenant::factory()->create();
        $this->actingAs($this->tenantAdmin, 'sanctum');

        $response = $this->putJson("/api/admin/tenants/{$otherTenant->id}/loop-config", [
            'num_slots' => 15,
            'ssp_slots' => 4,
            'playlist_slots' => 2,
        ]);

        $response->assertForbidden();
    }

    public function test_trafficker_cannot_update_loop_config(): void
    {
        $this->actingAs($this->trafficker, 'sanctum');

        $response = $this->putJson("/api/admin/tenants/{$this->tenant->id}/loop-config", [
            'num_slots' => 15,
            'ssp_slots' => 4,
            'playlist_slots' => 2,
        ]);

        $response->assertForbidden();
    }

    public function test_loop_config_rejects_invalid_num_slots_range(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum');

        $response = $this->putJson("/api/admin/tenants/{$this->tenant->id}/loop-config", [
            'num_slots' => 101,
            'ssp_slots' => 2,
            'playlist_slots' => 1,
        ]);

        $response->assertUnprocessable();
    }

    public function test_loop_config_rejects_when_no_ad_slots_remain(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum');

        $response = $this->putJson("/api/admin/tenants/{$this->tenant->id}/loop-config", [
            'num_slots' => 5,
            'ssp_slots' => 3,
            'playlist_slots' => 2,
        ]);

        $response->assertUnprocessable();
    }

    public function test_loop_config_rejects_negative_values(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum');

        $response = $this->putJson("/api/admin/tenants/{$this->tenant->id}/loop-config", [
            'num_slots' => 10,
            'ssp_slots' => -1,
            'playlist_slots' => 1,
        ]);

        $response->assertUnprocessable();
    }

    // ─── PUT /api/admin/tenants/{id}/network-settings ────────────────────

    public function test_super_admin_can_update_network_settings(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum');

        $response = $this->putJson("/api/admin/tenants/{$this->tenant->id}/network-settings", [
            'sync_interval_seconds' => 120,
            'cache_flush_interval_hours' => 48,
        ]);

        $response->assertOk()
            ->assertJson([
                'sync_interval_seconds' => 120,
                'cache_flush_interval_hours' => 48,
            ]);

        $this->assertDatabaseHas('tenants', [
            'id' => $this->tenant->id,
            'sync_interval_seconds' => 120,
            'cache_flush_interval_hours' => 48,
        ]);
    }

    public function test_tenant_admin_can_update_own_tenant_network_settings(): void
    {
        $this->actingAs($this->tenantAdmin, 'sanctum');

        $response = $this->putJson("/api/admin/tenants/{$this->tenant->id}/network-settings", [
            'sync_interval_seconds' => 60,
        ]);

        $response->assertOk()
            ->assertJson(['sync_interval_seconds' => 60]);
    }

    public function test_tenant_admin_cannot_update_other_tenant_network_settings(): void
    {
        $otherTenant = Tenant::factory()->create();
        $this->actingAs($this->tenantAdmin, 'sanctum');

        $response = $this->putJson("/api/admin/tenants/{$otherTenant->id}/network-settings", [
            'sync_interval_seconds' => 60,
        ]);

        $response->assertForbidden();
    }

    public function test_trafficker_cannot_update_network_settings(): void
    {
        $this->actingAs($this->trafficker, 'sanctum');

        $response = $this->putJson("/api/admin/tenants/{$this->tenant->id}/network-settings", [
            'sync_interval_seconds' => 60,
        ]);

        $response->assertForbidden();
    }

    public function test_network_settings_rejects_out_of_range_sync_interval(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum');

        $response = $this->putJson("/api/admin/tenants/{$this->tenant->id}/network-settings", [
            'sync_interval_seconds' => 10,
        ]);

        $response->assertUnprocessable();
    }

    public function test_network_settings_rejects_out_of_range_cache_flush(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum');

        $response = $this->putJson("/api/admin/tenants/{$this->tenant->id}/network-settings", [
            'cache_flush_interval_hours' => 800,
        ]);

        $response->assertUnprocessable();
    }

    // ─── POST /api/admin/tenants/{id}/loop-config/propagate ──────────────

    public function test_propagate_updates_descendants_without_override(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum');

        // Create screen groups — one with override, one without
        $groupWithOverride = ScreenGroup::factory()->create([
            'tenant_id' => $this->tenant->id,
            'num_slots' => 15,
        ]);
        $groupWithoutOverride = ScreenGroup::factory()->create([
            'tenant_id' => $this->tenant->id,
            'num_slots' => null,
        ]);

        // Create screens — one with override, one without
        $screenWithOverride = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'num_slots' => 8,
        ]);
        $screenWithoutOverride = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'num_slots' => null,
        ]);

        $response = $this->postJson("/api/admin/tenants/{$this->tenant->id}/loop-config/propagate");

        $response->assertOk()
            ->assertJson([
                'message' => 'Loop configuration propagated successfully.',
                'affected_screen_groups' => 1,
                'affected_screens' => 1,
                'num_slots' => 10,
            ]);

        // Group with override should keep its value
        $this->assertDatabaseHas('screen_groups', [
            'id' => $groupWithOverride->id,
            'num_slots' => 15,
        ]);

        // Group without override should get the tenant's num_slots
        $this->assertDatabaseHas('screen_groups', [
            'id' => $groupWithoutOverride->id,
            'num_slots' => 10,
        ]);

        // Screen with override should keep its value
        $this->assertDatabaseHas('screens', [
            'id' => $screenWithOverride->id,
            'num_slots' => 8,
        ]);

        // Screen without override should get the tenant's num_slots
        $this->assertDatabaseHas('screens', [
            'id' => $screenWithoutOverride->id,
            'num_slots' => 10,
        ]);
    }

    public function test_tenant_admin_can_propagate_own_tenant(): void
    {
        $this->actingAs($this->tenantAdmin, 'sanctum');

        ScreenGroup::factory()->create([
            'tenant_id' => $this->tenant->id,
            'num_slots' => null,
        ]);

        $response = $this->postJson("/api/admin/tenants/{$this->tenant->id}/loop-config/propagate");

        $response->assertOk();
    }

    public function test_tenant_admin_cannot_propagate_other_tenant(): void
    {
        $otherTenant = Tenant::factory()->create();
        $this->actingAs($this->tenantAdmin, 'sanctum');

        $response = $this->postJson("/api/admin/tenants/{$otherTenant->id}/loop-config/propagate");

        $response->assertForbidden();
    }

    public function test_trafficker_cannot_propagate(): void
    {
        $this->actingAs($this->trafficker, 'sanctum');

        $response = $this->postJson("/api/admin/tenants/{$this->tenant->id}/loop-config/propagate");

        $response->assertForbidden();
    }

    public function test_unauthenticated_cannot_access_loop_config_endpoints(): void
    {
        $this->putJson("/api/admin/tenants/{$this->tenant->id}/loop-config", [
            'num_slots' => 10,
            'ssp_slots' => 2,
            'playlist_slots' => 1,
        ])->assertUnauthorized();

        $this->putJson("/api/admin/tenants/{$this->tenant->id}/network-settings", [
            'sync_interval_seconds' => 120,
        ])->assertUnauthorized();

        $this->postJson("/api/admin/tenants/{$this->tenant->id}/loop-config/propagate")
            ->assertUnauthorized();
    }
}
