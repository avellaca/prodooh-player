<?php

namespace Tests\Feature;

use App\Models\Screen;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class LoopConfigTest extends TestCase
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

    // --- Valid config update ---

    public function test_super_admin_can_update_loop_config(): void
    {
        $screen = Screen::factory()->create();
        $this->actingAsSuperAdmin();

        $response = $this->putJson("/api/admin/screens/{$screen->id}/loop", [
            'slots' => [
                ['source' => 'prodooh', 'duration' => 15],
                ['source' => 'gam', 'duration' => 10],
                ['source' => 'playlist', 'duration' => 5],
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('data.loop_config.slots', [
                ['source' => 'prodooh', 'duration' => 15],
                ['source' => 'gam', 'duration' => 10],
                ['source' => 'playlist', 'duration' => 5],
            ]);

        $this->assertDatabaseHas('screens', ['id' => $screen->id]);
        $screen->refresh();
        $this->assertCount(3, $screen->loop_config['slots']);
    }

    public function test_tenant_admin_can_update_own_screen_loop_config(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
        $this->actingAsTenantAdmin($tenant);

        $response = $this->putJson("/api/admin/screens/{$screen->id}/loop", [
            'slots' => [
                ['source' => 'prodooh', 'duration' => 10],
                ['source' => 'playlist', 'duration' => 10],
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('data.loop_config.slots', [
                ['source' => 'prodooh', 'duration' => 10],
                ['source' => 'playlist', 'duration' => 10],
            ]);
    }

    // --- Invalid source type ---

    public function test_rejects_invalid_source_type(): void
    {
        $screen = Screen::factory()->create();
        $this->actingAsSuperAdmin();

        $response = $this->putJson("/api/admin/screens/{$screen->id}/loop", [
            'slots' => [
                ['source' => 'invalid_source', 'duration' => 10],
            ],
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['slots.0.source']);
    }

    // --- Invalid duration ---

    public function test_rejects_zero_duration(): void
    {
        $screen = Screen::factory()->create();
        $this->actingAsSuperAdmin();

        $response = $this->putJson("/api/admin/screens/{$screen->id}/loop", [
            'slots' => [
                ['source' => 'prodooh', 'duration' => 0],
            ],
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['slots.0.duration']);
    }

    public function test_rejects_negative_duration(): void
    {
        $screen = Screen::factory()->create();
        $this->actingAsSuperAdmin();

        $response = $this->putJson("/api/admin/screens/{$screen->id}/loop", [
            'slots' => [
                ['source' => 'prodooh', 'duration' => -5],
            ],
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['slots.0.duration']);
    }

    // --- Empty slots array ---

    public function test_rejects_empty_slots_array(): void
    {
        $screen = Screen::factory()->create();
        $this->actingAsSuperAdmin();

        $response = $this->putJson("/api/admin/screens/{$screen->id}/loop", [
            'slots' => [],
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['slots']);
    }

    public function test_rejects_missing_slots_field(): void
    {
        $screen = Screen::factory()->create();
        $this->actingAsSuperAdmin();

        $response = $this->putJson("/api/admin/screens/{$screen->id}/loop", []);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['slots']);
    }

    // --- Non-equitable distribution ---

    public function test_non_equitable_distribution_works(): void
    {
        $screen = Screen::factory()->create();
        $this->actingAsSuperAdmin();

        $response = $this->putJson("/api/admin/screens/{$screen->id}/loop", [
            'slots' => [
                ['source' => 'prodooh', 'duration' => 10],
                ['source' => 'prodooh', 'duration' => 10],
                ['source' => 'prodooh', 'duration' => 10],
                ['source' => 'playlist', 'duration' => 10],
            ],
        ]);

        $response->assertOk()
            ->assertJsonPath('data.loop_config.slots', [
                ['source' => 'prodooh', 'duration' => 10],
                ['source' => 'prodooh', 'duration' => 10],
                ['source' => 'prodooh', 'duration' => 10],
                ['source' => 'playlist', 'duration' => 10],
            ]);

        $screen->refresh();
        $this->assertCount(4, $screen->loop_config['slots']);
        // 3 prodooh slots = 75% SOV, 1 playlist slot = 25% SOV
        $prodoohSlots = array_filter($screen->loop_config['slots'], fn ($s) => $s['source'] === 'prodooh');
        $this->assertCount(3, $prodoohSlots);
    }

    // --- Tenant isolation ---

    public function test_tenant_admin_cannot_update_other_tenant_screen_loop(): void
    {
        $tenant1 = Tenant::factory()->create();
        $tenant2 = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant2->id]);
        $this->actingAsTenantAdmin($tenant1);

        $response = $this->putJson("/api/admin/screens/{$screen->id}/loop", [
            'slots' => [
                ['source' => 'prodooh', 'duration' => 10],
            ],
        ]);

        $response->assertNotFound();
    }

    // --- Unauthenticated ---

    public function test_unauthenticated_user_cannot_update_loop_config(): void
    {
        $screen = Screen::factory()->create();

        $response = $this->putJson("/api/admin/screens/{$screen->id}/loop", [
            'slots' => [
                ['source' => 'prodooh', 'duration' => 10],
            ],
        ]);

        $response->assertUnauthorized();
    }
}
