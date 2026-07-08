<?php

namespace Tests\Feature;

use App\Models\Screen;
use App\Models\Tenant;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class DeviceAuthTest extends TestCase
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

    public function test_successful_device_authentication(): void
    {
        $deviceToken = 'my-secret-device-token';
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()
            ->withDeviceToken($deviceToken)
            ->create([
                'tenant_id' => $tenant->id,
                'venue_id' => 'venue-test-001',
            ]);

        $response = $this->postJson('/api/device/auth', [
            'venue_id' => 'venue-test-001',
            'device_token' => $deviceToken,
        ]);

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'token',
            'token_type',
            'expires_in',
        ]);
        $response->assertJson([
            'token_type' => 'Bearer',
            'expires_in' => 1440 * 60,
        ]);

        // Verify the JWT token content
        $token = $response->json('token');
        $decoded = JWT::decode($token, new Key($this->jwtSecret, 'HS256'));

        $this->assertEquals($screen->id, $decoded->sub);
        $this->assertEquals($tenant->id, $decoded->tenant_id);
        $this->assertEquals('venue-test-001', $decoded->venue_id);
        $this->assertIsInt($decoded->iat);
        $this->assertIsInt($decoded->exp);
        $this->assertEquals($decoded->iat + 1440 * 60, $decoded->exp);
    }

    public function test_returns_404_for_unknown_venue_id(): void
    {
        $response = $this->postJson('/api/device/auth', [
            'venue_id' => 'non-existent-venue',
            'device_token' => 'any-token',
        ]);

        $response->assertStatus(404);
        $response->assertJson([
            'error' => 'Device not found',
        ]);
    }

    public function test_returns_401_for_invalid_device_token(): void
    {
        $tenant = Tenant::factory()->create();
        Screen::factory()
            ->withDeviceToken('correct-token')
            ->create([
                'tenant_id' => $tenant->id,
                'venue_id' => 'venue-auth-test',
            ]);

        $response = $this->postJson('/api/device/auth', [
            'venue_id' => 'venue-auth-test',
            'device_token' => 'wrong-token',
        ]);

        $response->assertStatus(401);
        $response->assertJson([
            'error' => 'Invalid credentials',
        ]);
    }

    public function test_returns_422_when_venue_id_is_missing(): void
    {
        $response = $this->postJson('/api/device/auth', [
            'device_token' => 'some-token',
        ]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['venue_id']);
    }

    public function test_returns_422_when_device_token_is_missing(): void
    {
        $response = $this->postJson('/api/device/auth', [
            'venue_id' => 'some-venue',
        ]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['device_token']);
    }

    public function test_protected_route_requires_jwt_token(): void
    {
        $response = $this->getJson('/api/device/config');

        $response->assertStatus(401);
        $response->assertJson([
            'error' => 'Unauthenticated',
        ]);
    }

    public function test_protected_route_rejects_invalid_jwt_token(): void
    {
        $response = $this->getJson('/api/device/config', [
            'Authorization' => 'Bearer invalid-token-here',
        ]);

        $response->assertStatus(401);
        $response->assertJson([
            'error' => 'Invalid token',
        ]);
    }

    public function test_protected_route_accepts_valid_jwt_token(): void
    {
        $deviceToken = 'device-token-for-access';
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()
            ->withDeviceToken($deviceToken)
            ->create(['tenant_id' => $tenant->id]);

        // First authenticate
        $authResponse = $this->postJson('/api/device/auth', [
            'venue_id' => $screen->venue_id,
            'device_token' => $deviceToken,
        ]);

        $token = $authResponse->json('token');

        // Use the token to access protected route
        $response = $this->getJson('/api/device/config', [
            'Authorization' => 'Bearer ' . $token,
        ]);

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'venue_id',
            'tenant_id',
            'loop',
            'sources',
            'display',
            'content_duration',
            'sync_interval_seconds',
            'heartbeat_interval_seconds',
        ]);
    }

    public function test_protected_route_rejects_expired_token(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);

        // Create an already-expired token
        $payload = [
            'sub' => $screen->id,
            'tenant_id' => $tenant->id,
            'venue_id' => $screen->venue_id,
            'iat' => time() - 7200,
            'exp' => time() - 3600, // expired 1 hour ago
        ];
        $expiredToken = JWT::encode($payload, $this->jwtSecret, 'HS256');

        $response = $this->getJson('/api/device/config', [
            'Authorization' => 'Bearer ' . $expiredToken,
        ]);

        $response->assertStatus(401);
        $response->assertJson([
            'error' => 'Token expired',
        ]);
    }

    public function test_protected_route_rejects_token_with_wrong_secret(): void
    {
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);

        // Token signed with a different secret
        $payload = [
            'sub' => $screen->id,
            'tenant_id' => $tenant->id,
            'venue_id' => $screen->venue_id,
            'iat' => time(),
            'exp' => time() + 3600,
        ];
        $badToken = JWT::encode($payload, 'a-completely-different-secret-that-is-also-32-bytes', 'HS256');

        $response = $this->getJson('/api/device/config', [
            'Authorization' => 'Bearer ' . $badToken,
        ]);

        $response->assertStatus(401);
        $response->assertJson([
            'error' => 'Invalid token',
        ]);
    }
}
