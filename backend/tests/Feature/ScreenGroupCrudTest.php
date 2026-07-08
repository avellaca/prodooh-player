<?php

namespace Tests\Feature;

use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use App\Models\User;
use App\Services\ScreenGroupService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ScreenGroupCrudTest extends TestCase
{
    use RefreshDatabase;

    private User $tenantAdmin;
    private Tenant $tenant;
    private string $token;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::factory()->create();
        $this->tenantAdmin = User::factory()->tenantAdmin()->create([
            'tenant_id' => $this->tenant->id,
        ]);
        $this->token = $this->tenantAdmin->createToken('test-token')->plainTextToken;
    }

    private function authHeaders(): array
    {
        return ['Authorization' => 'Bearer ' . $this->token];
    }

    // --- INDEX ---

    public function test_tenant_admin_can_list_groups(): void
    {
        ScreenGroup::factory()->count(3)->create(['tenant_id' => $this->tenant->id]);

        // Create group for another tenant (should not appear)
        ScreenGroup::factory()->create();

        $response = $this->withHeaders($this->authHeaders())
            ->getJson('/api/admin/groups');

        $response->assertOk()
            ->assertJsonCount(3);
    }

    public function test_super_admin_can_list_all_groups(): void
    {
        $superAdmin = User::factory()->superAdmin()->create();
        $token = $superAdmin->createToken('test-token')->plainTextToken;

        ScreenGroup::factory()->count(2)->create(['tenant_id' => $this->tenant->id]);
        ScreenGroup::factory()->count(1)->create();

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $token])
            ->getJson('/api/admin/groups');

        $response->assertOk()
            ->assertJsonCount(3);
    }

    // --- STORE ---

    public function test_tenant_admin_can_create_group(): void
    {
        $response = $this->withHeaders($this->authHeaders())
            ->postJson('/api/admin/groups', [
                'tenant_id' => $this->tenant->id,
                'name' => 'Lobby Screens',
                'duration_seconds' => 15,
                'orientation' => 'landscape',
            ]);

        $response->assertCreated()
            ->assertJsonFragment([
                'name' => 'Lobby Screens',
                'duration_seconds' => 15,
                'orientation' => 'landscape',
                'tenant_id' => $this->tenant->id,
            ]);

        $this->assertDatabaseHas('screen_groups', [
            'name' => 'Lobby Screens',
            'tenant_id' => $this->tenant->id,
        ]);
    }

    public function test_create_group_requires_name_and_tenant_id(): void
    {
        $response = $this->withHeaders($this->authHeaders())
            ->postJson('/api/admin/groups', []);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['name', 'tenant_id']);
    }

    public function test_create_group_validates_orientation(): void
    {
        $response = $this->withHeaders($this->authHeaders())
            ->postJson('/api/admin/groups', [
                'tenant_id' => $this->tenant->id,
                'name' => 'Test Group',
                'orientation' => 'diagonal',
            ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['orientation']);
    }

    // --- SHOW ---

    public function test_tenant_admin_can_view_group(): void
    {
        $group = ScreenGroup::factory()->create(['tenant_id' => $this->tenant->id]);

        $response = $this->withHeaders($this->authHeaders())
            ->getJson("/api/admin/groups/{$group->id}");

        $response->assertOk()
            ->assertJsonFragment(['name' => $group->name]);
    }

    public function test_show_returns_404_for_nonexistent_group(): void
    {
        $response = $this->withHeaders($this->authHeaders())
            ->getJson('/api/admin/groups/nonexistent-uuid');

        $response->assertNotFound();
    }

    // --- UPDATE ---

    public function test_tenant_admin_can_update_group(): void
    {
        $group = ScreenGroup::factory()->create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Old Name',
        ]);

        $response = $this->withHeaders($this->authHeaders())
            ->putJson("/api/admin/groups/{$group->id}", [
                'name' => 'Updated Name',
                'duration_seconds' => 20,
                'schedule' => ['start' => '08:00', 'end' => '22:00'],
            ]);

        $response->assertOk()
            ->assertJsonFragment([
                'name' => 'Updated Name',
                'duration_seconds' => 20,
            ]);

        $this->assertDatabaseHas('screen_groups', [
            'id' => $group->id,
            'name' => 'Updated Name',
            'duration_seconds' => 20,
        ]);
    }

    // --- DESTROY ---

    public function test_tenant_admin_can_delete_group(): void
    {
        $group = ScreenGroup::factory()->create(['tenant_id' => $this->tenant->id]);
        $screen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'group_id' => $group->id,
        ]);

        $response = $this->withHeaders($this->authHeaders())
            ->deleteJson("/api/admin/groups/{$group->id}");

        $response->assertNoContent();

        $this->assertDatabaseMissing('screen_groups', ['id' => $group->id]);
        // Screen should be unassigned (group_id = null), not deleted
        $this->assertDatabaseHas('screens', [
            'id' => $screen->id,
            'group_id' => null,
        ]);
    }

    // --- ASSIGN SCREENS ---

    public function test_tenant_admin_can_assign_screens_to_group(): void
    {
        $group = ScreenGroup::factory()->create(['tenant_id' => $this->tenant->id]);
        $screens = Screen::factory()->count(2)->create(['tenant_id' => $this->tenant->id]);

        $response = $this->withHeaders($this->authHeaders())
            ->postJson("/api/admin/groups/{$group->id}/screens", [
                'screen_ids' => $screens->pluck('id')->toArray(),
            ]);

        $response->assertOk()
            ->assertJsonFragment(['id' => $group->id]);

        foreach ($screens as $screen) {
            $this->assertDatabaseHas('screens', [
                'id' => $screen->id,
                'group_id' => $group->id,
            ]);
        }
    }

    public function test_assign_screens_requires_valid_screen_ids(): void
    {
        $group = ScreenGroup::factory()->create(['tenant_id' => $this->tenant->id]);

        $response = $this->withHeaders($this->authHeaders())
            ->postJson("/api/admin/groups/{$group->id}/screens", [
                'screen_ids' => [],
            ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['screen_ids']);
    }

    // --- CONFIG INHERITANCE ---

    public function test_config_inheritance_screen_overrides_group(): void
    {
        $group = ScreenGroup::factory()->create([
            'tenant_id' => $this->tenant->id,
            'duration_seconds' => 15,
            'orientation' => 'landscape',
            'schedule' => ['start' => '08:00', 'end' => '20:00'],
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'group_id' => $group->id,
            'duration_seconds' => 30,
            'orientation' => 'portrait',
            'schedule' => ['start' => '06:00', 'end' => '23:00'],
        ]);

        $service = app(ScreenGroupService::class);
        $config = $service->resolveScreenConfig($screen);

        $this->assertEquals(30, $config['duration_seconds']);
        $this->assertEquals('portrait', $config['orientation']);
        $this->assertEquals(['start' => '06:00', 'end' => '23:00'], $config['schedule']);
    }

    public function test_config_inheritance_group_overrides_tenant(): void
    {
        $tenant = Tenant::factory()->create([
            'default_duration_seconds' => 10,
            'default_schedule' => ['start' => '09:00', 'end' => '18:00'],
        ]);

        $group = ScreenGroup::factory()->create([
            'tenant_id' => $tenant->id,
            'duration_seconds' => 20,
            'orientation' => 'portrait',
            'schedule' => ['start' => '07:00', 'end' => '21:00'],
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'group_id' => $group->id,
            'duration_seconds' => null,
            'schedule' => null,
        ]);

        $service = app(ScreenGroupService::class);
        $config = $service->resolveScreenConfig($screen);

        // duration_seconds: screen is null, falls to group (20)
        $this->assertEquals(20, $config['duration_seconds']);
        // orientation: screen has its own value (from DB default), so it takes precedence
        $this->assertNotNull($config['orientation']);
        // schedule: screen is null, falls to group
        $this->assertEquals(['start' => '07:00', 'end' => '21:00'], $config['schedule']);
    }

    public function test_config_inheritance_falls_to_tenant_defaults(): void
    {
        $tenant = Tenant::factory()->create([
            'default_duration_seconds' => 10,
            'default_schedule' => ['start' => '09:00', 'end' => '18:00'],
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'group_id' => null,
            'duration_seconds' => null,
            'schedule' => null,
        ]);

        $service = app(ScreenGroupService::class);
        $config = $service->resolveScreenConfig($screen);

        // duration falls to tenant default
        $this->assertEquals(10, $config['duration_seconds']);
        // orientation is always set on the screen (DB default 'landscape')
        $this->assertEquals('landscape', $config['orientation']);
        // schedule falls to tenant default
        $this->assertEquals(['start' => '09:00', 'end' => '18:00'], $config['schedule']);
    }

    // --- AUTH ---

    public function test_unauthenticated_user_cannot_access_groups(): void
    {
        $response = $this->getJson('/api/admin/groups');

        $response->assertUnauthorized();
    }
}
