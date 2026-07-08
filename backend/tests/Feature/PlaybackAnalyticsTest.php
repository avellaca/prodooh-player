<?php

namespace Tests\Feature;

use App\Models\PlaybackLog;
use App\Models\Screen;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PlaybackAnalyticsTest extends TestCase
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

    // --- Authentication ---

    public function test_unauthenticated_user_cannot_access_analytics(): void
    {
        $response = $this->getJson('/api/admin/analytics/playback');

        $response->assertUnauthorized();
    }

    // --- Super Admin Access ---

    public function test_super_admin_can_view_all_playback_analytics(): void
    {
        $tenant1 = Tenant::factory()->create();
        $tenant2 = Tenant::factory()->create();
        $screen1 = Screen::factory()->create(['tenant_id' => $tenant1->id]);
        $screen2 = Screen::factory()->create(['tenant_id' => $tenant2->id]);

        PlaybackLog::factory()->count(3)->create([
            'screen_id' => $screen1->id,
            'tenant_id' => $tenant1->id,
            'source' => 'prodooh',
        ]);
        PlaybackLog::factory()->count(2)->create([
            'screen_id' => $screen2->id,
            'tenant_id' => $tenant2->id,
            'source' => 'gam',
        ]);

        $this->actingAsSuperAdmin();

        $response = $this->getJson('/api/admin/analytics/playback');

        $response->assertOk()
            ->assertJsonPath('data.total_spots', 5)
            ->assertJsonPath('data.by_source.prodooh', 3)
            ->assertJsonPath('data.by_source.gam', 2);
    }

    // --- Tenant Admin Isolation ---

    public function test_tenant_admin_only_sees_own_analytics(): void
    {
        $tenant1 = Tenant::factory()->create();
        $tenant2 = Tenant::factory()->create();
        $screen1 = Screen::factory()->create(['tenant_id' => $tenant1->id]);
        $screen2 = Screen::factory()->create(['tenant_id' => $tenant2->id]);

        PlaybackLog::factory()->count(4)->create([
            'screen_id' => $screen1->id,
            'tenant_id' => $tenant1->id,
            'source' => 'playlist',
        ]);
        PlaybackLog::factory()->count(3)->create([
            'screen_id' => $screen2->id,
            'tenant_id' => $tenant2->id,
            'source' => 'url',
        ]);

        $this->actingAsTenantAdmin($tenant1);

        $response = $this->getJson('/api/admin/analytics/playback');

        $response->assertOk()
            ->assertJsonPath('data.total_spots', 4)
            ->assertJsonPath('data.by_source.playlist', 4);

        // Should NOT contain other tenant's data
        $this->assertArrayNotHasKey('url', $response->json('data.by_source'));
    }

    // --- Filters ---

    public function test_analytics_can_filter_by_date_range(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);

        PlaybackLog::factory()->create([
            'screen_id' => $screen->id,
            'tenant_id' => $tenant->id,
            'started_at' => '2024-01-15 10:00:00',
        ]);
        PlaybackLog::factory()->create([
            'screen_id' => $screen->id,
            'tenant_id' => $tenant->id,
            'started_at' => '2024-02-15 10:00:00',
        ]);

        $this->actingAsSuperAdmin();

        $response = $this->getJson('/api/admin/analytics/playback?date_from=2024-02-01&date_to=2024-02-28');

        $response->assertOk()
            ->assertJsonPath('data.total_spots', 1);
    }

    public function test_analytics_can_filter_by_screen(): void
    {
        $tenant = Tenant::factory()->create();
        $screen1 = Screen::factory()->create(['tenant_id' => $tenant->id]);
        $screen2 = Screen::factory()->create(['tenant_id' => $tenant->id]);

        PlaybackLog::factory()->count(3)->create([
            'screen_id' => $screen1->id,
            'tenant_id' => $tenant->id,
        ]);
        PlaybackLog::factory()->count(2)->create([
            'screen_id' => $screen2->id,
            'tenant_id' => $tenant->id,
        ]);

        $this->actingAsSuperAdmin();

        $response = $this->getJson("/api/admin/analytics/playback?screen_id={$screen1->id}");

        $response->assertOk()
            ->assertJsonPath('data.total_spots', 3);
    }

    public function test_analytics_can_filter_by_source(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);

        PlaybackLog::factory()->count(2)->create([
            'screen_id' => $screen->id,
            'tenant_id' => $tenant->id,
            'source' => 'prodooh',
        ]);
        PlaybackLog::factory()->create([
            'screen_id' => $screen->id,
            'tenant_id' => $tenant->id,
            'source' => 'gam',
        ]);

        $this->actingAsSuperAdmin();

        $response = $this->getJson('/api/admin/analytics/playback?source=prodooh');

        $response->assertOk()
            ->assertJsonPath('data.total_spots', 2);
    }

    public function test_analytics_response_structure(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);

        PlaybackLog::factory()->create([
            'screen_id' => $screen->id,
            'tenant_id' => $tenant->id,
            'source' => 'prodooh',
            'content_id' => 'content-abc',
        ]);

        $this->actingAsSuperAdmin();

        $response = $this->getJson('/api/admin/analytics/playback');

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [
                    'total_spots',
                    'by_source',
                    'by_screen',
                    'by_content',
                ],
            ]);

        $data = $response->json('data');
        $this->assertIsInt($data['total_spots']);
        $this->assertIsArray($data['by_source']);
        $this->assertIsArray($data['by_screen']);
        $this->assertIsArray($data['by_content']);
    }

    public function test_analytics_validates_source_filter(): void
    {
        $this->actingAsSuperAdmin();

        $response = $this->getJson('/api/admin/analytics/playback?source=invalid_source');

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['source']);
    }
}
