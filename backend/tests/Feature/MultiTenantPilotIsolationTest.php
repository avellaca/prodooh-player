<?php

namespace Tests\Feature;

use App\Models\Content;
use App\Models\Playlist;
use App\Models\Screen;
use App\Models\Tenant;
use App\Models\User;
use Database\Seeders\MultiTenantPilotSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Verifies complete multi-tenant isolation in the pilot demonstration scenario.
 *
 * Validates Requirement 12.4: each tenant sees only its own resources.
 */
class MultiTenantPilotIsolationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(MultiTenantPilotSeeder::class);
    }

    public function test_seeder_creates_two_distinct_tenants(): void
    {
        $tenants = Tenant::all();
        $this->assertGreaterThanOrEqual(2, $tenants->count());

        $tenantA = Tenant::where('name', 'Prodooh Oficina')->first();
        $tenantB = Tenant::where('name', 'Media Owner Demo')->first();

        $this->assertNotNull($tenantA);
        $this->assertNotNull($tenantB);
        $this->assertNotEquals($tenantA->id, $tenantB->id);
        $this->assertNotEquals($tenantA->api_credential, $tenantB->api_credential);
    }

    public function test_tenant_a_has_gam_active_tenant_b_does_not(): void
    {
        $tenantA = Tenant::where('name', 'Prodooh Oficina')->first();
        $tenantB = Tenant::where('name', 'Media Owner Demo')->first();

        $screenA = Screen::where('tenant_id', $tenantA->id)->first();
        $screenB = Screen::where('tenant_id', $tenantB->id)->first();

        $this->assertTrue($screenA->sources_config['gam']['enabled']);
        $this->assertFalse($screenB->sources_config['gam']['enabled']);
    }

    public function test_tenant_a_admin_sees_only_own_screens(): void
    {
        $tenantA = Tenant::where('name', 'Prodooh Oficina')->first();
        $adminA = User::where('email', 'admin-a@prodooh.com')->first();

        $response = $this->actingAs($adminA)->getJson('/api/admin/screens');
        $response->assertOk();

        $screens = $response->json('data');
        foreach ($screens as $screen) {
            $this->assertEquals($tenantA->id, $screen['tenant_id']);
        }
    }

    public function test_tenant_b_admin_sees_only_own_screens(): void
    {
        $tenantB = Tenant::where('name', 'Media Owner Demo')->first();
        $adminB = User::where('email', 'admin-b@mediaowner.com')->first();

        $response = $this->actingAs($adminB)->getJson('/api/admin/screens');
        $response->assertOk();

        $screens = $response->json('data');
        foreach ($screens as $screen) {
            $this->assertEquals($tenantB->id, $screen['tenant_id']);
        }
    }

    public function test_tenant_a_admin_cannot_see_tenant_b_playlists(): void
    {
        $adminA = User::where('email', 'admin-a@prodooh.com')->first();

        $response = $this->actingAs($adminA)->getJson('/api/admin/playlists');
        $response->assertOk();

        $tenantB = Tenant::where('name', 'Media Owner Demo')->first();
        $playlists = $response->json('data');

        foreach ($playlists as $playlist) {
            $this->assertNotEquals($tenantB->id, $playlist['tenant_id']);
        }
    }

    public function test_tenant_b_admin_cannot_see_tenant_a_content(): void
    {
        $adminB = User::where('email', 'admin-b@mediaowner.com')->first();

        $response = $this->actingAs($adminB)->getJson('/api/admin/content');
        $response->assertOk();

        $tenantA = Tenant::where('name', 'Prodooh Oficina')->first();
        $contentItems = $response->json('data');

        foreach ($contentItems as $content) {
            $this->assertNotEquals($tenantA->id, $content['tenant_id']);
        }
    }

    public function test_each_tenant_has_distinct_playlists(): void
    {
        $tenantA = Tenant::where('name', 'Prodooh Oficina')->first();
        $tenantB = Tenant::where('name', 'Media Owner Demo')->first();

        $playlistsA = Playlist::where('tenant_id', $tenantA->id)->pluck('id');
        $playlistsB = Playlist::where('tenant_id', $tenantB->id)->pluck('id');

        $this->assertGreaterThan(0, $playlistsA->count());
        $this->assertGreaterThan(0, $playlistsB->count());

        // No overlap between tenant playlists
        $this->assertEmpty($playlistsA->intersect($playlistsB));
    }

    public function test_screens_are_assigned_to_correct_tenant_playlists(): void
    {
        $tenantA = Tenant::where('name', 'Prodooh Oficina')->first();
        $tenantB = Tenant::where('name', 'Media Owner Demo')->first();

        $screensA = Screen::where('tenant_id', $tenantA->id)->with('playlists')->get();
        $screensB = Screen::where('tenant_id', $tenantB->id)->with('playlists')->get();

        // Tenant A screens should only have Tenant A playlists
        foreach ($screensA as $screen) {
            foreach ($screen->playlists as $playlist) {
                $this->assertEquals($tenantA->id, $playlist->tenant_id);
            }
        }

        // Tenant B screens should only have Tenant B playlists
        foreach ($screensB as $screen) {
            foreach ($screen->playlists as $playlist) {
                $this->assertEquals($tenantB->id, $playlist->tenant_id);
            }
        }
    }

    public function test_tenants_have_different_configurations(): void
    {
        $tenantA = Tenant::where('name', 'Prodooh Oficina')->first();
        $tenantB = Tenant::where('name', 'Media Owner Demo')->first();

        // Different default durations
        $this->assertNotEquals(
            $tenantA->default_duration_seconds,
            $tenantB->default_duration_seconds
        );

        // Different timezones
        $this->assertNotEquals(
            $tenantA->default_timezone,
            $tenantB->default_timezone
        );

        // Different transition types
        $this->assertNotEquals(
            $tenantA->transition_type,
            $tenantB->transition_type
        );
    }
}
