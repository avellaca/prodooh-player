<?php

namespace Tests\Property;

use App\Models\Playlist;
use App\Models\Screen;
use App\Models\Tenant;
use App\Models\User;
use Eris\Generators;
use Eris\TestTrait;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Property 17: Tenant Data Isolation
 *
 * Generate random users (tenant-admin/super-admin) and resources across multiple tenants.
 * Verify tenant-admin sees only own tenant resources; super-admin sees all.
 *
 * **Validates: Requirements 11.4, 12.1, 12.2, 12.3**
 */
class TenantDataIsolationPropertyTest extends TestCase
{
    use RefreshDatabase, TestTrait;

    /**
     * Property: A tenant-admin user can only see screens belonging to their own tenant.
     * For any random distribution of screens across N tenants, a tenant-admin
     * for tenant T must see exactly the screens assigned to T and nothing else.
     *
     * **Validates: Requirements 12.1, 12.3**
     */
    public function test_tenant_admin_sees_only_own_tenant_screens(): void
    {
        $this->forAll(
            Generators::choose(2, 5),  // number of tenants
            Generators::choose(1, 4)   // screens per tenant
        )->then(function (int $numTenants, int $screensPerTenant): void {
            // Create tenants with screens
            $tenants = [];
            $tenantScreenCounts = [];

            for ($i = 0; $i < $numTenants; $i++) {
                $tenant = Tenant::factory()->create();
                $tenants[] = $tenant;
                Screen::factory()->count($screensPerTenant)->create([
                    'tenant_id' => $tenant->id,
                ]);
                $tenantScreenCounts[$tenant->id] = $screensPerTenant;
            }

            // For each tenant, verify its admin sees only its own screens
            foreach ($tenants as $tenant) {
                $tenantAdmin = User::factory()->tenantAdmin()->create([
                    'tenant_id' => $tenant->id,
                ]);

                $response = $this->actingAs($tenantAdmin)
                    ->getJson('/api/admin/screens');

                $response->assertOk();
                $screens = $response->json('data');

                // Must see exactly the correct count
                $this->assertCount(
                    $tenantScreenCounts[$tenant->id],
                    $screens,
                    "Tenant-admin for tenant {$tenant->id} should see exactly {$tenantScreenCounts[$tenant->id]} screens"
                );

                // Every returned screen must belong to the admin's tenant
                foreach ($screens as $screen) {
                    $this->assertEquals(
                        $tenant->id,
                        $screen['tenant_id'],
                        "Tenant-admin must only see screens of their own tenant"
                    );
                }
            }

            // Clean up for next iteration
            Screen::withoutGlobalScopes()->delete();
            User::query()->delete();
            Tenant::query()->delete();
        });
    }

    /**
     * Property: A super-admin can see all screens across all tenants without restriction.
     *
     * **Validates: Requirements 11.4**
     */
    public function test_super_admin_sees_all_tenant_screens(): void
    {
        $this->forAll(
            Generators::choose(2, 5),  // number of tenants
            Generators::choose(1, 4)   // screens per tenant
        )->then(function (int $numTenants, int $screensPerTenant): void {
            $totalScreens = 0;

            for ($i = 0; $i < $numTenants; $i++) {
                $tenant = Tenant::factory()->create();
                Screen::factory()->count($screensPerTenant)->create([
                    'tenant_id' => $tenant->id,
                ]);
                $totalScreens += $screensPerTenant;
            }

            $superAdmin = User::factory()->superAdmin()->create();

            $response = $this->actingAs($superAdmin)
                ->getJson('/api/admin/screens');

            $response->assertOk();
            $screens = $response->json('data');

            $this->assertCount(
                $totalScreens,
                $screens,
                "Super-admin must see all {$totalScreens} screens across all tenants"
            );

            // Clean up for next iteration
            Screen::withoutGlobalScopes()->delete();
            User::query()->delete();
            Tenant::query()->delete();
        });
    }

    /**
     * Property: A tenant-admin can only see playlists belonging to their own tenant.
     * For any random distribution of playlists across N tenants, a tenant-admin
     * for tenant T must see exactly the playlists assigned to T.
     *
     * **Validates: Requirements 12.2, 12.3**
     */
    public function test_tenant_admin_sees_only_own_tenant_playlists(): void
    {
        $this->forAll(
            Generators::choose(2, 4),  // number of tenants
            Generators::choose(1, 3)   // playlists per tenant
        )->then(function (int $numTenants, int $playlistsPerTenant): void {
            $tenants = [];
            $tenantPlaylistCounts = [];

            for ($i = 0; $i < $numTenants; $i++) {
                $tenant = Tenant::factory()->create();
                $tenants[] = $tenant;
                Playlist::factory()->count($playlistsPerTenant)->create([
                    'tenant_id' => $tenant->id,
                ]);
                $tenantPlaylistCounts[$tenant->id] = $playlistsPerTenant;
            }

            // For each tenant, verify its admin sees only its own playlists
            foreach ($tenants as $tenant) {
                $tenantAdmin = User::factory()->tenantAdmin()->create([
                    'tenant_id' => $tenant->id,
                ]);

                $response = $this->actingAs($tenantAdmin)
                    ->getJson('/api/admin/playlists');

                $response->assertOk();
                $playlists = $response->json('data');

                // Must see exactly the correct count
                $this->assertCount(
                    $tenantPlaylistCounts[$tenant->id],
                    $playlists,
                    "Tenant-admin for tenant {$tenant->id} should see exactly {$tenantPlaylistCounts[$tenant->id]} playlists"
                );

                // Every returned playlist must belong to the admin's tenant
                foreach ($playlists as $playlist) {
                    $this->assertEquals(
                        $tenant->id,
                        $playlist['tenant_id'],
                        "Tenant-admin must only see playlists of their own tenant"
                    );
                }
            }

            // Clean up for next iteration
            Playlist::withoutGlobalScopes()->delete();
            User::query()->delete();
            Tenant::query()->delete();
        });
    }

    /**
     * Property: A tenant-admin cannot access a specific screen belonging to another tenant.
     * For any pair of tenants A and B, admin of A cannot retrieve screen of B by direct ID access.
     *
     * **Validates: Requirements 12.3**
     */
    public function test_tenant_admin_cannot_access_other_tenant_screen_by_id(): void
    {
        $this->forAll(
            Generators::choose(2, 4),  // number of tenants
            Generators::choose(1, 3)   // screens per tenant
        )->then(function (int $numTenants, int $screensPerTenant): void {
            $tenants = [];
            $tenantScreens = [];

            for ($i = 0; $i < $numTenants; $i++) {
                $tenant = Tenant::factory()->create();
                $tenants[] = $tenant;
                $screens = Screen::factory()->count($screensPerTenant)->create([
                    'tenant_id' => $tenant->id,
                ]);
                $tenantScreens[$tenant->id] = $screens->pluck('id')->toArray();
            }

            // For each tenant-admin, attempt to access screens from other tenants
            foreach ($tenants as $index => $tenant) {
                $tenantAdmin = User::factory()->tenantAdmin()->create([
                    'tenant_id' => $tenant->id,
                ]);

                // Try to access a screen from each OTHER tenant
                foreach ($tenants as $otherIndex => $otherTenant) {
                    if ($index === $otherIndex) {
                        continue;
                    }

                    $otherScreenId = $tenantScreens[$otherTenant->id][0];

                    $response = $this->actingAs($tenantAdmin)
                        ->getJson("/api/admin/screens/{$otherScreenId}");

                    // Should either be 404 (not found due to scope) or 403 (forbidden)
                    $this->assertTrue(
                        in_array($response->status(), [403, 404]),
                        "Tenant-admin of tenant {$tenant->id} should NOT be able to access screen {$otherScreenId} of tenant {$otherTenant->id}. Got status: {$response->status()}"
                    );
                }
            }

            // Clean up for next iteration
            Screen::withoutGlobalScopes()->delete();
            User::query()->delete();
            Tenant::query()->delete();
        });
    }

    /**
     * Property: Super-admin can access any specific screen across any tenant by ID.
     *
     * **Validates: Requirements 11.4**
     */
    public function test_super_admin_can_access_any_tenant_screen_by_id(): void
    {
        $this->forAll(
            Generators::choose(2, 4),  // number of tenants
            Generators::choose(1, 3)   // screens per tenant
        )->then(function (int $numTenants, int $screensPerTenant): void {
            $allScreenIds = [];

            for ($i = 0; $i < $numTenants; $i++) {
                $tenant = Tenant::factory()->create();
                $screens = Screen::factory()->count($screensPerTenant)->create([
                    'tenant_id' => $tenant->id,
                ]);
                $allScreenIds = array_merge($allScreenIds, $screens->pluck('id')->toArray());
            }

            $superAdmin = User::factory()->superAdmin()->create();

            // Super-admin must be able to access every single screen
            foreach ($allScreenIds as $screenId) {
                $response = $this->actingAs($superAdmin)
                    ->getJson("/api/admin/screens/{$screenId}");

                $this->assertEquals(
                    200,
                    $response->status(),
                    "Super-admin must be able to access screen {$screenId}"
                );
            }

            // Clean up for next iteration
            Screen::withoutGlobalScopes()->delete();
            User::query()->delete();
            Tenant::query()->delete();
        });
    }
}
