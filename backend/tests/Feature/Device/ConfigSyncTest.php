<?php

namespace Tests\Feature\Device;

use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ConfigSyncTest extends TestCase
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

    private function createJwtToken(Screen $screen, Tenant $tenant): string
    {
        $payload = [
            'sub' => $screen->id,
            'tenant_id' => $tenant->id,
            'venue_id' => $screen->venue_id,
            'iat' => time(),
            'exp' => time() + 3600,
        ];

        return JWT::encode($payload, $this->jwtSecret, 'HS256');
    }

    public function test_returns_full_config_response_structure(): void
    {
        $tenant = Tenant::factory()->create([
            'default_duration_seconds' => 15,
            'default_timezone' => 'America/New_York',
            'default_schedule' => null,
            'transition_type' => 'fade',
            'transition_duration_ms' => 500,
            'api_credential' => 'tenant-api-key-123',
            'default_config' => ['network_id' => 'network-456'],
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'venue_id' => 'venue-config-001',
            'orientation' => 'landscape',
            'resolution_width' => 1920,
            'resolution_height' => 1080,
            'duration_seconds' => null,
            'schedule' => null,
            'loop_config' => [
                'slots' => [
                    ['source' => 'prodooh', 'duration' => 10],
                    ['source' => 'playlist', 'duration' => 10],
                ],
            ],
            'sources_config' => [
                'prodooh' => ['enabled' => true],
                'gam' => ['enabled' => false],
                'url' => ['enabled' => true],
                'playlist' => ['enabled' => true],
            ],
        ]);

        $token = $this->createJwtToken($screen, $tenant);

        $response = $this->getJson('/api/device/config', [
            'Authorization' => 'Bearer ' . $token,
        ]);

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'venue_id',
            'tenant_id',
            'loop' => [
                'slots' => [['position', 'source', 'duration']],
                'total_duration',
            ],
            'sources' => [
                'prodooh' => ['enabled', 'api_key', 'network_id'],
                'gam' => ['enabled', 'ad_tag_url'],
                'url' => ['enabled', 'urls'],
                'playlist' => ['enabled'],
            ],
            'display' => [
                'resolution' => ['width', 'height'],
                'orientation',
                'transition' => ['type', 'duration_ms'],
            ],
            'content_duration' => ['default_seconds', 'source'],
            'sync_interval_seconds',
            'heartbeat_interval_seconds',
        ]);

        $response->assertJson([
            'venue_id' => 'venue-config-001',
            'tenant_id' => $tenant->id,
            'sync_interval_seconds' => 60,
            'heartbeat_interval_seconds' => 30,
        ]);
    }

    public function test_resolves_duration_from_screen_level(): void
    {
        $tenant = Tenant::factory()->create([
            'default_duration_seconds' => 10,
        ]);

        $group = ScreenGroup::factory()->create([
            'tenant_id' => $tenant->id,
            'duration_seconds' => 20,
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'group_id' => $group->id,
            'duration_seconds' => 30,
        ]);

        $token = $this->createJwtToken($screen, $tenant);

        $response = $this->getJson('/api/device/config', [
            'Authorization' => 'Bearer ' . $token,
        ]);

        $response->assertStatus(200);
        $response->assertJson([
            'content_duration' => [
                'default_seconds' => 30,
                'source' => 'screen',
            ],
        ]);
    }

    public function test_resolves_duration_from_group_level(): void
    {
        $tenant = Tenant::factory()->create([
            'default_duration_seconds' => 10,
        ]);

        $group = ScreenGroup::factory()->create([
            'tenant_id' => $tenant->id,
            'duration_seconds' => 25,
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'group_id' => $group->id,
            'duration_seconds' => null,
        ]);

        $token = $this->createJwtToken($screen, $tenant);

        $response = $this->getJson('/api/device/config', [
            'Authorization' => 'Bearer ' . $token,
        ]);

        $response->assertStatus(200);
        $response->assertJson([
            'content_duration' => [
                'default_seconds' => 25,
                'source' => 'group',
            ],
        ]);
    }

    public function test_resolves_duration_from_tenant_level(): void
    {
        $tenant = Tenant::factory()->create([
            'default_duration_seconds' => 12,
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'group_id' => null,
            'duration_seconds' => null,
        ]);

        $token = $this->createJwtToken($screen, $tenant);

        $response = $this->getJson('/api/device/config', [
            'Authorization' => 'Bearer ' . $token,
        ]);

        $response->assertStatus(200);
        $response->assertJson([
            'content_duration' => [
                'default_seconds' => 12,
                'source' => 'tenant',
            ],
        ]);
    }

    public function test_resolves_duration_skips_group_when_group_duration_null(): void
    {
        $tenant = Tenant::factory()->create([
            'default_duration_seconds' => 8,
        ]);

        $group = ScreenGroup::factory()->create([
            'tenant_id' => $tenant->id,
            'duration_seconds' => null,
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'group_id' => $group->id,
            'duration_seconds' => null,
        ]);

        $token = $this->createJwtToken($screen, $tenant);

        $response = $this->getJson('/api/device/config', [
            'Authorization' => 'Bearer ' . $token,
        ]);

        $response->assertStatus(200);
        $response->assertJson([
            'content_duration' => [
                'default_seconds' => 8,
                'source' => 'tenant',
            ],
        ]);
    }

    public function test_returns_effective_loop_config_with_disabled_sources(): void
    {
        $tenant = Tenant::factory()->create();

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'loop_config' => [
                'slots' => [
                    ['source' => 'prodooh', 'duration' => 10],
                    ['source' => 'gam', 'duration' => 15],
                    ['source' => 'url', 'duration' => 10],
                    ['source' => 'playlist', 'duration' => 10],
                ],
            ],
            'sources_config' => [
                'prodooh' => ['enabled' => true],
                'gam' => ['enabled' => false],
                'url' => ['enabled' => false],
                'playlist' => ['enabled' => true],
            ],
        ]);

        $token = $this->createJwtToken($screen, $tenant);

        $response = $this->getJson('/api/device/config', [
            'Authorization' => 'Bearer ' . $token,
        ]);

        $response->assertStatus(200);

        $loop = $response->json('loop');
        $this->assertCount(4, $loop['slots']);

        // Disabled sources should be replaced with 'playlist'
        $this->assertEquals('prodooh', $loop['slots'][0]['source']);
        $this->assertEquals('playlist', $loop['slots'][1]['source']); // gam disabled
        $this->assertEquals('playlist', $loop['slots'][2]['source']); // url disabled
        $this->assertEquals('playlist', $loop['slots'][3]['source']);

        // Total duration should reflect all slot durations
        $this->assertEquals(45, $loop['total_duration']);
    }

    public function test_includes_source_credentials_from_tenant(): void
    {
        $tenant = Tenant::factory()->create([
            'api_credential' => 'prodooh-api-key-abc',
            'default_config' => ['network_id' => 'net-123'],
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'sources_config' => [
                'prodooh' => ['enabled' => true],
                'gam' => ['enabled' => true, 'ad_tag_url' => 'https://gam.example.com/tag'],
                'url' => ['enabled' => true, 'urls' => [
                    ['url' => 'https://example.com', 'duration' => 10],
                ]],
                'playlist' => ['enabled' => true],
            ],
        ]);

        $token = $this->createJwtToken($screen, $tenant);

        $response = $this->getJson('/api/device/config', [
            'Authorization' => 'Bearer ' . $token,
        ]);

        $response->assertStatus(200);
        $response->assertJson([
            'sources' => [
                'prodooh' => [
                    'enabled' => true,
                    'api_key' => 'prodooh-api-key-abc',
                    'network_id' => 'net-123',
                ],
                'gam' => [
                    'enabled' => true,
                    'ad_tag_url' => 'https://gam.example.com/tag',
                ],
                'url' => [
                    'enabled' => true,
                    'urls' => [
                        ['url' => 'https://example.com', 'duration' => 10],
                    ],
                ],
                'playlist' => [
                    'enabled' => true,
                ],
            ],
        ]);
    }

    public function test_includes_display_settings(): void
    {
        $tenant = Tenant::factory()->create([
            'transition_type' => 'slide',
            'transition_duration_ms' => 300,
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'orientation' => 'portrait',
            'resolution_width' => 1080,
            'resolution_height' => 1920,
            'transition_type' => null,
            'transition_duration_ms' => null,
        ]);

        $token = $this->createJwtToken($screen, $tenant);

        $response = $this->getJson('/api/device/config', [
            'Authorization' => 'Bearer ' . $token,
        ]);

        $response->assertStatus(200);
        $response->assertJson([
            'display' => [
                'resolution' => [
                    'width' => 1080,
                    'height' => 1920,
                ],
                'orientation' => 'portrait',
                'transition' => [
                    'type' => 'slide',
                    'duration_ms' => 300,
                ],
            ],
        ]);
    }

    public function test_screen_transition_overrides_tenant_transition(): void
    {
        $tenant = Tenant::factory()->create([
            'transition_type' => 'slide',
            'transition_duration_ms' => 300,
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'transition_type' => 'fade',
            'transition_duration_ms' => 800,
        ]);

        $token = $this->createJwtToken($screen, $tenant);

        $response = $this->getJson('/api/device/config', [
            'Authorization' => 'Bearer ' . $token,
        ]);

        $response->assertStatus(200);
        $response->assertJson([
            'display' => [
                'transition' => [
                    'type' => 'fade',
                    'duration_ms' => 800,
                ],
            ],
        ]);
    }

    public function test_resolves_schedule_from_screen(): void
    {
        $tenant = Tenant::factory()->create([
            'default_timezone' => 'America/Chicago',
            'default_schedule' => [
                ['days' => [1, 2, 3, 4, 5], 'start' => '09:00', 'end' => '17:00'],
            ],
        ]);

        $screenSchedule = [
            ['days' => [0, 1, 2, 3, 4, 5, 6], 'start' => '08:00', 'end' => '22:00'],
        ];

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'schedule' => $screenSchedule,
        ]);

        $token = $this->createJwtToken($screen, $tenant);

        $response = $this->getJson('/api/device/config', [
            'Authorization' => 'Bearer ' . $token,
        ]);

        $response->assertStatus(200);
        $response->assertJson([
            'schedule' => [
                'timezone' => 'America/Chicago',
                'rules' => $screenSchedule,
            ],
        ]);
    }

    public function test_resolves_schedule_from_group(): void
    {
        $tenant = Tenant::factory()->create([
            'default_timezone' => 'Europe/London',
            'default_schedule' => null,
        ]);

        $groupSchedule = [
            ['days' => [1, 2, 3, 4, 5], 'start' => '06:00', 'end' => '20:00'],
        ];

        $group = ScreenGroup::factory()->create([
            'tenant_id' => $tenant->id,
            'schedule' => $groupSchedule,
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'group_id' => $group->id,
            'schedule' => null,
        ]);

        $token = $this->createJwtToken($screen, $tenant);

        $response = $this->getJson('/api/device/config', [
            'Authorization' => 'Bearer ' . $token,
        ]);

        $response->assertStatus(200);
        $response->assertJson([
            'schedule' => [
                'timezone' => 'Europe/London',
                'rules' => $groupSchedule,
            ],
        ]);
    }

    public function test_resolves_schedule_from_tenant(): void
    {
        $tenantSchedule = [
            ['days' => [1, 2, 3, 4, 5], 'start' => '09:00', 'end' => '18:00'],
        ];

        $tenant = Tenant::factory()->create([
            'default_timezone' => 'Asia/Tokyo',
            'default_schedule' => $tenantSchedule,
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'group_id' => null,
            'schedule' => null,
        ]);

        $token = $this->createJwtToken($screen, $tenant);

        $response = $this->getJson('/api/device/config', [
            'Authorization' => 'Bearer ' . $token,
        ]);

        $response->assertStatus(200);
        $response->assertJson([
            'schedule' => [
                'timezone' => 'Asia/Tokyo',
                'rules' => $tenantSchedule,
            ],
        ]);
    }

    public function test_returns_null_schedule_when_none_configured(): void
    {
        $tenant = Tenant::factory()->create([
            'default_schedule' => null,
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'group_id' => null,
            'schedule' => null,
        ]);

        $token = $this->createJwtToken($screen, $tenant);

        $response = $this->getJson('/api/device/config', [
            'Authorization' => 'Bearer ' . $token,
        ]);

        $response->assertStatus(200);
        $this->assertNull($response->json('schedule'));
    }

    public function test_requires_authentication(): void
    {
        $response = $this->getJson('/api/device/config');

        $response->assertStatus(401);
    }
}
