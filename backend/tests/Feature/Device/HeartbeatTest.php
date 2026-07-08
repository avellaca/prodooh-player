<?php

namespace Tests\Feature\Device;

use App\Models\DeviceCommand;
use App\Models\Screen;
use App\Models\Tenant;
use Carbon\Carbon;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class HeartbeatTest extends TestCase
{
    use RefreshDatabase;

    private string $jwtSecret = 'test-jwt-secret-key-must-be-at-least-32-bytes-long';

    protected function setUp(): void
    {
        parent::setUp();
        config(['jwt.secret' => $this->jwtSecret]);
        config(['jwt.ttl' => 1440]);
        config(['jwt.algorithm' => 'HS256']);
    }

    private function createAuthenticatedScreen(?Tenant $tenant = null): array
    {
        $tenant = $tenant ?? Tenant::factory()->create();
        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'status' => 'offline',
            'last_heartbeat' => null,
        ]);

        $token = JWT::encode([
            'sub' => $screen->id,
            'tenant_id' => $tenant->id,
            'venue_id' => $screen->venue_id,
            'iat' => time(),
            'exp' => time() + 86400,
        ], $this->jwtSecret, 'HS256');

        return [$screen, $token, $tenant];
    }

    private function validHeartbeatPayload(array $overrides = []): array
    {
        return array_merge([
            'venue_id' => 'venue-001',
            'timestamp' => Carbon::now()->toIso8601String(),
            'current_content' => [
                'id' => 'content-123',
                'source' => 'playlist',
            ],
            'storage' => [
                'total_mb' => 32000,
                'available_mb' => 25000,
                'percent_used' => 22,
            ],
            'uptime_seconds' => 3600,
            'playlist_version' => 'v1.2.3',
        ], $overrides);
    }

    public function test_successful_heartbeat_updates_screen_status(): void
    {
        Carbon::setTestNow(Carbon::parse('2024-01-15 10:30:00'));

        [$screen, $token] = $this->createAuthenticatedScreen();

        $response = $this->postJson('/api/device/heartbeat', $this->validHeartbeatPayload(), [
            'Authorization' => 'Bearer ' . $token,
        ]);

        $response->assertStatus(200);
        $response->assertJson([
            'ack' => true,
            'pending_commands' => [],
        ]);

        $screen->refresh();
        $this->assertEquals('online', $screen->status);
        $this->assertNotNull($screen->last_heartbeat);
        $this->assertEquals('v1.2.3', $screen->playlist_version);
        $this->assertEquals([
            'total_mb' => 32000,
            'available_mb' => 25000,
            'percent_used' => 22,
        ], $screen->last_storage_status);

        Carbon::setTestNow();
    }

    public function test_heartbeat_returns_pending_commands(): void
    {
        [$screen, $token] = $this->createAuthenticatedScreen();

        // Create pending commands
        $cmd1 = DeviceCommand::factory()->create([
            'screen_id' => $screen->id,
            'type' => 'screenshot',
            'payload' => ['quality' => 80],
            'status' => 'pending',
        ]);
        $cmd2 = DeviceCommand::factory()->create([
            'screen_id' => $screen->id,
            'type' => 'config_update',
            'payload' => ['loop_config' => ['slots' => []]],
            'status' => 'pending',
        ]);

        // Create a delivered command (should NOT be returned)
        DeviceCommand::factory()->create([
            'screen_id' => $screen->id,
            'type' => 'playlist_update',
            'status' => 'delivered',
            'delivered_at' => now(),
        ]);

        $response = $this->postJson('/api/device/heartbeat', $this->validHeartbeatPayload(), [
            'Authorization' => 'Bearer ' . $token,
        ]);

        $response->assertStatus(200);
        $response->assertJson(['ack' => true]);

        $pendingCommands = $response->json('pending_commands');
        $this->assertCount(2, $pendingCommands);

        $commandIds = array_column($pendingCommands, 'id');
        $this->assertContains($cmd1->id, $commandIds);
        $this->assertContains($cmd2->id, $commandIds);

        // Verify commands were marked as delivered
        $cmd1->refresh();
        $cmd2->refresh();
        $this->assertEquals('delivered', $cmd1->status);
        $this->assertEquals('delivered', $cmd2->status);
        $this->assertNotNull($cmd1->delivered_at);
        $this->assertNotNull($cmd2->delivered_at);
    }

    public function test_heartbeat_with_null_current_content(): void
    {
        [$screen, $token] = $this->createAuthenticatedScreen();

        $payload = $this->validHeartbeatPayload(['current_content' => null]);

        $response = $this->postJson('/api/device/heartbeat', $payload, [
            'Authorization' => 'Bearer ' . $token,
        ]);

        $response->assertStatus(200);
        $response->assertJson(['ack' => true]);
    }

    public function test_heartbeat_requires_authentication(): void
    {
        $response = $this->postJson('/api/device/heartbeat', $this->validHeartbeatPayload());

        $response->assertStatus(401);
    }

    public function test_heartbeat_validates_required_fields(): void
    {
        [$screen, $token] = $this->createAuthenticatedScreen();

        $response = $this->postJson('/api/device/heartbeat', [], [
            'Authorization' => 'Bearer ' . $token,
        ]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors([
            'venue_id',
            'timestamp',
            'storage',
            'uptime_seconds',
            'playlist_version',
        ]);
    }

    public function test_heartbeat_validates_storage_fields(): void
    {
        [$screen, $token] = $this->createAuthenticatedScreen();

        $payload = $this->validHeartbeatPayload([
            'storage' => [
                'total_mb' => -1,
                'available_mb' => 'not-a-number',
                'percent_used' => 150,
            ],
        ]);

        $response = $this->postJson('/api/device/heartbeat', $payload, [
            'Authorization' => 'Bearer ' . $token,
        ]);

        $response->assertStatus(422);
    }

    public function test_heartbeat_validates_current_content_source(): void
    {
        [$screen, $token] = $this->createAuthenticatedScreen();

        $payload = $this->validHeartbeatPayload([
            'current_content' => [
                'id' => 'content-1',
                'source' => 'invalid_source',
            ],
        ]);

        $response = $this->postJson('/api/device/heartbeat', $payload, [
            'Authorization' => 'Bearer ' . $token,
        ]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['current_content.source']);
    }

    public function test_heartbeat_does_not_return_commands_for_other_screens(): void
    {
        $tenant = Tenant::factory()->create();
        [$screen, $token] = $this->createAuthenticatedScreen($tenant);

        // Create a command for a DIFFERENT screen
        $otherScreen = Screen::factory()->create(['tenant_id' => $tenant->id]);
        DeviceCommand::factory()->create([
            'screen_id' => $otherScreen->id,
            'type' => 'screenshot',
            'status' => 'pending',
        ]);

        $response = $this->postJson('/api/device/heartbeat', $this->validHeartbeatPayload(), [
            'Authorization' => 'Bearer ' . $token,
        ]);

        $response->assertStatus(200);
        $this->assertEmpty($response->json('pending_commands'));
    }
}
