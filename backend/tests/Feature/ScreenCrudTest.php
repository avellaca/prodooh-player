<?php

namespace Tests\Feature;

use App\Models\Screen;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ScreenCrudTest extends TestCase
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

    // --- INDEX ---

    public function test_super_admin_can_list_all_screens(): void
    {
        $tenant1 = Tenant::factory()->create();
        $tenant2 = Tenant::factory()->create();
        Screen::factory()->create(['tenant_id' => $tenant1->id]);
        Screen::factory()->create(['tenant_id' => $tenant2->id]);

        $this->actingAsSuperAdmin();

        $response = $this->getJson('/api/admin/screens');

        $response->assertOk()
            ->assertJsonCount(2, 'data');
    }

    public function test_tenant_admin_can_only_list_own_screens(): void
    {
        $tenant1 = Tenant::factory()->create();
        $tenant2 = Tenant::factory()->create();
        Screen::factory()->create(['tenant_id' => $tenant1->id]);
        Screen::factory()->create(['tenant_id' => $tenant2->id]);

        $this->actingAsTenantAdmin($tenant1);

        $response = $this->getJson('/api/admin/screens');

        $response->assertOk()
            ->assertJsonCount(1, 'data');
    }

    public function test_unauthenticated_user_cannot_list_screens(): void
    {
        $response = $this->getJson('/api/admin/screens');

        $response->assertUnauthorized();
    }

    // --- STORE ---

    public function test_super_admin_can_register_screen_for_any_tenant(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsSuperAdmin();

        $response = $this->postJson('/api/admin/screens', [
            'tenant_id' => $tenant->id,
            'venue_id' => 'venue-unique-123',
            'name' => 'Main Lobby Screen',
        ]);

        $response->assertCreated()
            ->assertJsonStructure([
                'data' => ['id', 'tenant_id', 'venue_id', 'name', 'status'],
                'device_token',
                'message',
            ])
            ->assertJson([
                'data' => [
                    'tenant_id' => $tenant->id,
                    'venue_id' => 'venue-unique-123',
                    'name' => 'Main Lobby Screen',
                    'status' => 'offline',
                ],
            ]);

        // device_token should be a 64-char string
        $this->assertEquals(64, strlen($response->json('device_token')));

        // Verify the hash is stored
        $screen = Screen::first();
        $this->assertNotNull($screen->device_token_hash);
        $this->assertNotEquals($response->json('device_token'), $screen->device_token_hash);
    }

    public function test_tenant_admin_can_register_screen_for_own_tenant(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $response = $this->postJson('/api/admin/screens', [
            'venue_id' => 'venue-ta-001',
            'name' => 'Office Screen',
        ]);

        $response->assertCreated()
            ->assertJson([
                'data' => [
                    'tenant_id' => $tenant->id,
                    'venue_id' => 'venue-ta-001',
                    'name' => 'Office Screen',
                ],
            ]);

        $this->assertDatabaseHas('screens', [
            'tenant_id' => $tenant->id,
            'venue_id' => 'venue-ta-001',
        ]);
    }

    public function test_store_requires_venue_id_and_name(): void
    {
        $this->actingAsSuperAdmin();

        $response = $this->postJson('/api/admin/screens', [
            'tenant_id' => Tenant::factory()->create()->id,
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['venue_id', 'name']);
    }

    public function test_store_rejects_duplicate_venue_id(): void
    {
        $tenant = Tenant::factory()->create();
        Screen::factory()->create(['tenant_id' => $tenant->id, 'venue_id' => 'venue-dup']);
        $this->actingAsSuperAdmin();

        $response = $this->postJson('/api/admin/screens', [
            'tenant_id' => $tenant->id,
            'venue_id' => 'venue-dup',
            'name' => 'Duplicate Venue Screen',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['venue_id']);
    }

    public function test_super_admin_must_provide_tenant_id(): void
    {
        $this->actingAsSuperAdmin();

        $response = $this->postJson('/api/admin/screens', [
            'venue_id' => 'venue-no-tenant',
            'name' => 'No Tenant Screen',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['tenant_id']);
    }

    // --- SHOW ---

    public function test_super_admin_can_view_any_screen(): void
    {
        $screen = Screen::factory()->create();
        $this->actingAsSuperAdmin();

        $response = $this->getJson("/api/admin/screens/{$screen->id}");

        $response->assertOk()
            ->assertJson([
                'data' => [
                    'id' => $screen->id,
                    'name' => $screen->name,
                ],
            ]);
    }

    public function test_tenant_admin_can_view_own_screen(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
        $this->actingAsTenantAdmin($tenant);

        $response = $this->getJson("/api/admin/screens/{$screen->id}");

        $response->assertOk()
            ->assertJson([
                'data' => ['id' => $screen->id],
            ]);
    }

    public function test_tenant_admin_cannot_view_other_tenant_screen(): void
    {
        $tenant1 = Tenant::factory()->create();
        $tenant2 = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant2->id]);
        $this->actingAsTenantAdmin($tenant1);

        $response = $this->getJson("/api/admin/screens/{$screen->id}");

        $response->assertNotFound();
    }

    // --- UPDATE ---

    public function test_super_admin_can_update_any_screen(): void
    {
        $screen = Screen::factory()->create(['name' => 'Old Name']);
        $this->actingAsSuperAdmin();

        $response = $this->putJson("/api/admin/screens/{$screen->id}", [
            'name' => 'New Name',
            'orientation' => 'portrait',
            'resolution_width' => 1080,
            'resolution_height' => 1920,
        ]);

        $response->assertOk()
            ->assertJson([
                'data' => [
                    'name' => 'New Name',
                    'orientation' => 'portrait',
                    'resolution_width' => 1080,
                    'resolution_height' => 1920,
                ],
            ]);
    }

    public function test_tenant_admin_can_update_own_screen(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id, 'name' => 'Original']);
        $this->actingAsTenantAdmin($tenant);

        $response = $this->putJson("/api/admin/screens/{$screen->id}", [
            'name' => 'Updated',
        ]);

        $response->assertOk()
            ->assertJson(['data' => ['name' => 'Updated']]);
    }

    public function test_tenant_admin_cannot_update_other_tenant_screen(): void
    {
        $tenant1 = Tenant::factory()->create();
        $tenant2 = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant2->id]);
        $this->actingAsTenantAdmin($tenant1);

        $response = $this->putJson("/api/admin/screens/{$screen->id}", [
            'name' => 'Hacked',
        ]);

        $response->assertNotFound();
    }

    public function test_update_validates_orientation(): void
    {
        $screen = Screen::factory()->create();
        $this->actingAsSuperAdmin();

        $response = $this->putJson("/api/admin/screens/{$screen->id}", [
            'orientation' => 'diagonal',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['orientation']);
    }

    public function test_device_token_hash_is_hidden_in_responses(): void
    {
        $screen = Screen::factory()->create();
        $this->actingAsSuperAdmin();

        $response = $this->getJson("/api/admin/screens/{$screen->id}");

        $response->assertOk();
        $this->assertArrayNotHasKey('device_token_hash', $response->json('data'));
    }
}
