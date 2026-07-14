<?php

namespace Tests\Feature;

use App\Models\DeviceCommand;
use App\Models\Screen;
use App\Models\Tenant;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ScreenCommandTest extends TestCase
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

    // --- SPEED OVERRIDE ---

    public function test_can_create_speed_override_command(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
        $this->actingAsTenantAdmin($tenant);

        Carbon::setTestNow('2025-01-15 14:00:00');

        $response = $this->postJson("/api/admin/screens/{$screen->id}/commands", [
            'type' => 'speed_override',
            'factor' => 2,
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.screen_id', $screen->id)
            ->assertJsonPath('data.type', 'speed_override')
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.payload.factor', 2);

        // Default expires_at should be 10 minutes from now
        $command = DeviceCommand::first();
        $expiresAt = Carbon::parse($command->payload['expires_at']);
        $this->assertTrue($expiresAt->equalTo(Carbon::parse('2025-01-15 14:10:00')));

        Carbon::setTestNow();
    }

    public function test_speed_override_with_custom_expires_at(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
        $this->actingAsTenantAdmin($tenant);

        $expiresAt = '2025-01-15T15:00:00Z';

        $response = $this->postJson("/api/admin/screens/{$screen->id}/commands", [
            'type' => 'speed_override',
            'factor' => 4,
            'expires_at' => $expiresAt,
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.payload.factor', 4);

        $command = DeviceCommand::first();
        $this->assertNotNull($command->payload['expires_at']);
    }

    public function test_speed_override_validates_factor(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
        $this->actingAsTenantAdmin($tenant);

        $response = $this->postJson("/api/admin/screens/{$screen->id}/commands", [
            'type' => 'speed_override',
            'factor' => 3,
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['factor']);
    }

    public function test_speed_override_requires_factor(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
        $this->actingAsTenantAdmin($tenant);

        $response = $this->postJson("/api/admin/screens/{$screen->id}/commands", [
            'type' => 'speed_override',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['factor']);
    }

    // --- PREVIEW CONTENT ---

    public function test_can_create_preview_content_command(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
        $this->actingAsTenantAdmin($tenant);

        $response = $this->postJson("/api/admin/screens/{$screen->id}/commands", [
            'type' => 'preview_content',
            'content_id' => 'some-uuid-content-id',
            'asset_url' => '/api/device/content/some-uuid-content-id/file',
            'duration_seconds' => 10,
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.screen_id', $screen->id)
            ->assertJsonPath('data.type', 'preview_content')
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.payload.content_id', 'some-uuid-content-id')
            ->assertJsonPath('data.payload.asset_url', '/api/device/content/some-uuid-content-id/file')
            ->assertJsonPath('data.payload.duration_seconds', 10);
    }

    public function test_preview_content_without_duration(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
        $this->actingAsTenantAdmin($tenant);

        $response = $this->postJson("/api/admin/screens/{$screen->id}/commands", [
            'type' => 'preview_content',
            'content_id' => 'some-uuid-content-id',
            'asset_url' => '/api/device/content/some-uuid-content-id/file',
        ]);

        $response->assertCreated();

        $command = DeviceCommand::first();
        $this->assertArrayNotHasKey('duration_seconds', $command->payload);
    }

    public function test_preview_content_requires_content_id(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
        $this->actingAsTenantAdmin($tenant);

        $response = $this->postJson("/api/admin/screens/{$screen->id}/commands", [
            'type' => 'preview_content',
            'asset_url' => '/api/device/content/some-uuid/file',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['content_id']);
    }

    public function test_preview_content_requires_asset_url(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
        $this->actingAsTenantAdmin($tenant);

        $response = $this->postJson("/api/admin/screens/{$screen->id}/commands", [
            'type' => 'preview_content',
            'content_id' => 'some-uuid-content-id',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['asset_url']);
    }

    // --- TYPE VALIDATION ---

    public function test_type_is_required(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
        $this->actingAsTenantAdmin($tenant);

        $response = $this->postJson("/api/admin/screens/{$screen->id}/commands", []);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['type']);
    }

    public function test_type_must_be_valid_enum(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
        $this->actingAsTenantAdmin($tenant);

        $response = $this->postJson("/api/admin/screens/{$screen->id}/commands", [
            'type' => 'invalid_type',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['type']);
    }

    // --- SCREEN VALIDATION ---

    public function test_returns_404_for_nonexistent_screen(): void
    {
        $this->actingAsSuperAdmin();

        $response = $this->postJson('/api/admin/screens/nonexistent-uuid/commands', [
            'type' => 'speed_override',
            'factor' => 2,
        ]);

        $response->assertNotFound();
    }

    // --- AUTHENTICATION ---

    public function test_unauthenticated_user_cannot_send_command(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);

        $response = $this->postJson("/api/admin/screens/{$screen->id}/commands", [
            'type' => 'speed_override',
            'factor' => 2,
        ]);

        $response->assertUnauthorized();
    }
}
