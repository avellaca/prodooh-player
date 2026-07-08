<?php

namespace Tests\Feature;

use App\Models\Screen;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SourceToggleTest extends TestCase
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

    // --- Disabling a source reassigns its slots to playlist ---

    public function test_disabling_source_reassigns_its_slots_to_playlist(): void
    {
        $screen = Screen::factory()->create([
            'loop_config' => [
                'slots' => [
                    ['source' => 'prodooh', 'duration' => 10],
                    ['source' => 'gam', 'duration' => 10],
                    ['source' => 'url', 'duration' => 10],
                    ['source' => 'playlist', 'duration' => 10],
                ],
            ],
            'sources_config' => [
                'prodooh' => ['enabled' => true],
                'gam' => ['enabled' => true],
                'url' => ['enabled' => true],
                'playlist' => ['enabled' => true],
            ],
        ]);
        $this->actingAsSuperAdmin();

        $response = $this->putJson("/api/admin/screens/{$screen->id}/sources", [
            'source' => 'gam',
            'enabled' => false,
        ]);

        $response->assertOk();

        // The sources_config should reflect GAM disabled
        $this->assertFalse($response->json('data.sources_config.gam.enabled'));

        // The effective loop config should have 'gam' slots replaced with 'playlist'
        $effectiveSlots = $response->json('effective_loop_config.slots');
        $this->assertCount(4, $effectiveSlots);

        $effectiveSources = array_column($effectiveSlots, 'source');
        $this->assertNotContains('gam', $effectiveSources);
        $this->assertEquals(['prodooh', 'playlist', 'url', 'playlist'], $effectiveSources);
    }

    // --- Re-enabling a source restores original assignment ---

    public function test_reenabling_source_restores_original_assignment(): void
    {
        $screen = Screen::factory()->create([
            'loop_config' => [
                'slots' => [
                    ['source' => 'prodooh', 'duration' => 10],
                    ['source' => 'gam', 'duration' => 10],
                    ['source' => 'url', 'duration' => 10],
                    ['source' => 'playlist', 'duration' => 10],
                ],
            ],
            'sources_config' => [
                'prodooh' => ['enabled' => true],
                'gam' => ['enabled' => false], // already disabled
                'url' => ['enabled' => true],
                'playlist' => ['enabled' => true],
            ],
        ]);
        $this->actingAsSuperAdmin();

        // Re-enable GAM
        $response = $this->putJson("/api/admin/screens/{$screen->id}/sources", [
            'source' => 'gam',
            'enabled' => true,
        ]);

        $response->assertOk();

        // The sources_config should reflect GAM enabled
        $this->assertTrue($response->json('data.sources_config.gam.enabled'));

        // The effective loop config should now include GAM in its original position
        $effectiveSlots = $response->json('effective_loop_config.slots');
        $effectiveSources = array_column($effectiveSlots, 'source');
        $this->assertEquals(['prodooh', 'gam', 'url', 'playlist'], $effectiveSources);
    }

    // --- Total slot count remains unchanged ---

    public function test_total_slot_count_remains_unchanged_after_toggle(): void
    {
        $screen = Screen::factory()->create([
            'loop_config' => [
                'slots' => [
                    ['source' => 'prodooh', 'duration' => 10],
                    ['source' => 'prodooh', 'duration' => 10],
                    ['source' => 'gam', 'duration' => 10],
                    ['source' => 'url', 'duration' => 10],
                    ['source' => 'url', 'duration' => 10],
                    ['source' => 'playlist', 'duration' => 10],
                ],
            ],
            'sources_config' => [
                'prodooh' => ['enabled' => true],
                'gam' => ['enabled' => true],
                'url' => ['enabled' => true],
                'playlist' => ['enabled' => true],
            ],
        ]);
        $this->actingAsSuperAdmin();

        // Disable URL source (which has 2 slots)
        $response = $this->putJson("/api/admin/screens/{$screen->id}/sources", [
            'source' => 'url',
            'enabled' => false,
        ]);

        $response->assertOk();

        $effectiveSlots = $response->json('effective_loop_config.slots');
        $this->assertCount(6, $effectiveSlots); // Still 6 slots total

        // Verify durations are preserved
        foreach ($effectiveSlots as $slot) {
            $this->assertEquals(10, $slot['duration']);
        }
    }

    // --- Playlist source cannot be disabled ---

    public function test_playlist_source_cannot_be_disabled(): void
    {
        $screen = Screen::factory()->create();
        $this->actingAsSuperAdmin();

        $response = $this->putJson("/api/admin/screens/{$screen->id}/sources", [
            'source' => 'playlist',
            'enabled' => false,
        ]);

        $response->assertStatus(422)
            ->assertJson(['message' => 'Cannot disable the playlist source — it is the fallback.']);
    }

    // --- Bulk toggle multiple sources ---

    public function test_bulk_toggle_multiple_sources(): void
    {
        $screen = Screen::factory()->create([
            'loop_config' => [
                'slots' => [
                    ['source' => 'prodooh', 'duration' => 10],
                    ['source' => 'gam', 'duration' => 10],
                    ['source' => 'url', 'duration' => 10],
                    ['source' => 'playlist', 'duration' => 10],
                ],
            ],
            'sources_config' => [
                'prodooh' => ['enabled' => true],
                'gam' => ['enabled' => true],
                'url' => ['enabled' => true],
                'playlist' => ['enabled' => true],
            ],
        ]);
        $this->actingAsSuperAdmin();

        $response = $this->putJson("/api/admin/screens/{$screen->id}/sources", [
            'sources' => [
                'gam' => ['enabled' => false],
                'url' => ['enabled' => false],
            ],
        ]);

        $response->assertOk();

        // Both gam and url should be disabled
        $this->assertFalse($response->json('data.sources_config.gam.enabled'));
        $this->assertFalse($response->json('data.sources_config.url.enabled'));

        // Effective loop should only have prodooh and playlist
        $effectiveSlots = $response->json('effective_loop_config.slots');
        $effectiveSources = array_column($effectiveSlots, 'source');
        $this->assertEquals(['prodooh', 'playlist', 'playlist', 'playlist'], $effectiveSources);
    }

    // --- Playlist cannot be disabled in bulk toggle ---

    public function test_bulk_toggle_cannot_disable_playlist(): void
    {
        $screen = Screen::factory()->create();
        $this->actingAsSuperAdmin();

        $response = $this->putJson("/api/admin/screens/{$screen->id}/sources", [
            'sources' => [
                'playlist' => ['enabled' => false],
                'gam' => ['enabled' => false],
            ],
        ]);

        $response->assertStatus(422)
            ->assertJson(['message' => 'Cannot disable the playlist source — it is the fallback.']);
    }

    // --- Invalid source returns error ---

    public function test_invalid_source_returns_error(): void
    {
        $screen = Screen::factory()->create();
        $this->actingAsSuperAdmin();

        $response = $this->putJson("/api/admin/screens/{$screen->id}/sources", [
            'source' => 'invalid_source',
            'enabled' => false,
        ]);

        $response->assertStatus(422);
    }

    // --- Tenant admin can toggle sources on own screens ---

    public function test_tenant_admin_can_toggle_sources_on_own_screen(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
        $this->actingAsTenantAdmin($tenant);

        $response = $this->putJson("/api/admin/screens/{$screen->id}/sources", [
            'source' => 'gam',
            'enabled' => false,
        ]);

        $response->assertOk();
        $this->assertFalse($response->json('data.sources_config.gam.enabled'));
    }

    // --- Tenant admin cannot toggle sources on other tenant's screens ---

    public function test_tenant_admin_cannot_toggle_sources_on_other_tenant_screen(): void
    {
        $tenant1 = Tenant::factory()->create();
        $tenant2 = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant2->id]);
        $this->actingAsTenantAdmin($tenant1);

        $response = $this->putJson("/api/admin/screens/{$screen->id}/sources", [
            'source' => 'gam',
            'enabled' => false,
        ]);

        $response->assertNotFound();
    }

    // --- Original loop_config is preserved when source is disabled ---

    public function test_original_loop_config_is_preserved_when_source_disabled(): void
    {
        $originalLoopConfig = [
            'slots' => [
                ['source' => 'prodooh', 'duration' => 10],
                ['source' => 'gam', 'duration' => 15],
                ['source' => 'url', 'duration' => 10],
                ['source' => 'playlist', 'duration' => 10],
            ],
        ];

        $screen = Screen::factory()->create([
            'loop_config' => $originalLoopConfig,
        ]);
        $this->actingAsSuperAdmin();

        // Disable GAM
        $this->putJson("/api/admin/screens/{$screen->id}/sources", [
            'source' => 'gam',
            'enabled' => false,
        ]);

        // The original loop_config in the database should NOT be modified
        $screen->refresh();
        $this->assertEquals($originalLoopConfig, $screen->loop_config);
    }

    // --- Unauthenticated user cannot toggle sources ---

    public function test_unauthenticated_user_cannot_toggle_sources(): void
    {
        $screen = Screen::factory()->create();

        $response = $this->putJson("/api/admin/screens/{$screen->id}/sources", [
            'source' => 'gam',
            'enabled' => false,
        ]);

        $response->assertUnauthorized();
    }
}
