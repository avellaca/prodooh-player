<?php

namespace Tests\Feature;

use App\Models\Screen;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class ScreenTokenRegenerationTest extends TestCase
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

    public function test_super_admin_can_regenerate_token_for_any_screen(): void
    {
        $screen = Screen::factory()->withDeviceToken('old-token-value')->create();
        $oldHash = $screen->device_token_hash;

        $this->actingAsSuperAdmin();

        $response = $this->postJson("/api/admin/screens/{$screen->id}/regenerate-token");

        $response->assertOk()
            ->assertJsonStructure([
                'data' => ['id', 'tenant_id', 'venue_id', 'name'],
                'device_token',
                'message',
            ]);

        // New token should be an 8-char alphanumeric string
        $newToken = $response->json('device_token');
        $this->assertEquals(8, strlen($newToken));

        // The hash in the DB should have changed
        $screen->refresh();
        $this->assertNotEquals($oldHash, $screen->device_token_hash);

        // The new token should verify against the new hash
        $this->assertTrue(Hash::check($newToken, $screen->device_token_hash));
    }

    public function test_tenant_admin_can_regenerate_token_for_own_screen(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);

        $this->actingAsTenantAdmin($tenant);

        $response = $this->postJson("/api/admin/screens/{$screen->id}/regenerate-token");

        $response->assertOk()
            ->assertJsonStructure(['data', 'device_token', 'message']);

        $newToken = $response->json('device_token');
        $this->assertEquals(8, strlen($newToken));
    }

    public function test_tenant_admin_cannot_regenerate_token_for_other_tenant_screen(): void
    {
        $tenant1 = Tenant::factory()->create();
        $tenant2 = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant2->id]);

        $this->actingAsTenantAdmin($tenant1);

        $response = $this->postJson("/api/admin/screens/{$screen->id}/regenerate-token");

        $response->assertNotFound();
    }

    public function test_unauthenticated_user_cannot_regenerate_token(): void
    {
        $screen = Screen::factory()->create();

        $response = $this->postJson("/api/admin/screens/{$screen->id}/regenerate-token");

        $response->assertUnauthorized();
    }

    public function test_old_token_no_longer_verifies_after_regeneration(): void
    {
        $oldToken = 'known-old-token-for-testing';
        $screen = Screen::factory()->withDeviceToken($oldToken)->create();

        $this->actingAsSuperAdmin();

        $response = $this->postJson("/api/admin/screens/{$screen->id}/regenerate-token");
        $response->assertOk();

        // Old token should no longer match the stored hash
        $screen->refresh();
        $this->assertFalse(Hash::check($oldToken, $screen->device_token_hash));
    }

    public function test_device_token_hash_is_hidden_in_regeneration_response(): void
    {
        $screen = Screen::factory()->create();
        $this->actingAsSuperAdmin();

        $response = $this->postJson("/api/admin/screens/{$screen->id}/regenerate-token");

        $response->assertOk();
        $this->assertArrayNotHasKey('device_token_hash', $response->json('data'));
    }

    public function test_regenerate_token_returns_404_for_nonexistent_screen(): void
    {
        $this->actingAsSuperAdmin();

        $response = $this->postJson('/api/admin/screens/nonexistent-id/regenerate-token');

        $response->assertNotFound();
    }
}
