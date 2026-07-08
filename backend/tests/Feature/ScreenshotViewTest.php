<?php

namespace Tests\Feature;

use App\Models\Screen;
use App\Models\Screenshot;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ScreenshotViewTest extends TestCase
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

    public function test_unauthenticated_user_cannot_view_screenshots(): void
    {
        $screen = Screen::factory()->create();

        $response = $this->getJson("/api/admin/screens/{$screen->id}/screenshots");

        $response->assertUnauthorized();
    }

    // --- Super Admin Access ---

    public function test_super_admin_can_view_screenshots_for_any_screen(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
        Screenshot::factory()->count(3)->create(['screen_id' => $screen->id]);

        $this->actingAsSuperAdmin();

        $response = $this->getJson("/api/admin/screens/{$screen->id}/screenshots");

        $response->assertOk()
            ->assertJsonCount(3, 'data');
    }

    // --- Tenant Admin Isolation ---

    public function test_tenant_admin_can_view_screenshots_for_own_screen(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
        Screenshot::factory()->count(2)->create(['screen_id' => $screen->id]);

        $this->actingAsTenantAdmin($tenant);

        $response = $this->getJson("/api/admin/screens/{$screen->id}/screenshots");

        $response->assertOk()
            ->assertJsonCount(2, 'data');
    }

    public function test_tenant_admin_cannot_view_screenshots_for_other_tenant_screen(): void
    {
        $tenant1 = Tenant::factory()->create();
        $tenant2 = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant2->id]);
        Screenshot::factory()->count(2)->create(['screen_id' => $screen->id]);

        $this->actingAsTenantAdmin($tenant1);

        $response = $this->getJson("/api/admin/screens/{$screen->id}/screenshots");

        $response->assertNotFound();
    }

    // --- Response Structure ---

    public function test_screenshot_response_structure(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
        Screenshot::factory()->create([
            'screen_id' => $screen->id,
            'storage_path' => 'screenshots/test-image.png',
            'captured_at' => '2024-06-15 10:30:00',
        ]);

        $this->actingAsSuperAdmin();

        $response = $this->getJson("/api/admin/screens/{$screen->id}/screenshots");

        $response->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonStructure([
                'data' => [
                    ['id', 'storage_path', 'captured_at'],
                ],
            ]);
    }

    public function test_screenshots_are_ordered_by_most_recent_first(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);

        $older = Screenshot::factory()->create([
            'screen_id' => $screen->id,
            'captured_at' => '2024-01-01 08:00:00',
        ]);
        $newer = Screenshot::factory()->create([
            'screen_id' => $screen->id,
            'captured_at' => '2024-06-15 10:00:00',
        ]);

        $this->actingAsSuperAdmin();

        $response = $this->getJson("/api/admin/screens/{$screen->id}/screenshots");

        $response->assertOk();

        $data = $response->json('data');
        $this->assertEquals($newer->id, $data[0]['id']);
        $this->assertEquals($older->id, $data[1]['id']);
    }

    public function test_returns_empty_array_when_screen_has_no_screenshots(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);

        $this->actingAsSuperAdmin();

        $response = $this->getJson("/api/admin/screens/{$screen->id}/screenshots");

        $response->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_returns_404_for_nonexistent_screen(): void
    {
        $this->actingAsSuperAdmin();

        $response = $this->getJson('/api/admin/screens/nonexistent-id/screenshots');

        $response->assertNotFound();
    }
}
