<?php

namespace Tests\Feature\Device;

use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\Screen;
use App\Models\ScreenManifest;
use App\Models\Tenant;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class DeviceEndpointsTest extends TestCase
{
    use RefreshDatabase;

    private string $jwtSecret = 'test-jwt-secret-key-must-be-at-least-32-bytes-long';
    private Tenant $tenant;
    private Screen $screen;
    private string $token;

    protected function setUp(): void
    {
        parent::setUp();

        config(['jwt.secret' => $this->jwtSecret]);
        config(['jwt.ttl' => 1440]);
        config(['jwt.algorithm' => 'HS256']);

        $this->tenant = Tenant::factory()->create();
        $this->screen = Screen::factory()->create(['tenant_id' => $this->tenant->id]);
        $this->token = $this->issueToken($this->screen);
    }

    // ──────────────────────────────────────────────
    // GET /api/device/manifest
    // ──────────────────────────────────────────────

    public function test_manifest_returns_200_with_valid_structure(): void
    {
        $items = [
            [
                'position' => 0,
                'type' => 'order_line_creative',
                'asset_url' => 'https://cdn.example.com/content/xyz.mp4',
                'checksum_sha256' => 'a1b2c3d4e5f6',
                'duration_seconds' => 10,
                'order_line_id' => (string) Str::uuid(),
                'creative_id' => (string) Str::uuid(),
            ],
            [
                'position' => 1,
                'type' => 'prodooh_ssp_call',
                'duration_seconds' => 10,
            ],
            [
                'position' => 2,
                'type' => 'playlist_item',
                'asset_url' => 'https://cdn.example.com/content/abc.jpg',
                'checksum_sha256' => 'd4e5f6a7b8c9',
                'duration_seconds' => 10,
                'playlist_item_id' => (string) Str::uuid(),
            ],
        ];

        ScreenManifest::create([
            'screen_id' => $this->screen->id,
            'version' => 'sha256-test-version-abc123',
            'generated_at' => now(),
            'items' => $items,
            'total_spots' => 100,
            'remaining_spots' => 80,
        ]);

        $response = $this->getJson('/api/device/manifest', [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'version',
            'generated_at',
            'items' => [
                '*' => ['position', 'type', 'duration_seconds'],
            ],
        ]);

        $data = $response->json();
        $this->assertEquals('sha256-test-version-abc123', $data['version']);
        $this->assertNotNull($data['generated_at']);
        $this->assertCount(3, $data['items']);
        $this->assertEquals('order_line_creative', $data['items'][0]['type']);
        $this->assertEquals('prodooh_ssp_call', $data['items'][1]['type']);
        $this->assertEquals('playlist_item', $data['items'][2]['type']);
        $response->assertHeader('ETag', 'sha256-test-version-abc123');
    }

    public function test_manifest_returns_304_when_if_none_match_matches_version(): void
    {
        $version = 'sha256-cached-version-xyz789';

        ScreenManifest::create([
            'screen_id' => $this->screen->id,
            'version' => $version,
            'generated_at' => now(),
            'items' => [['position' => 0, 'type' => 'playlist_item', 'duration_seconds' => 10]],
            'total_spots' => 50,
            'remaining_spots' => 50,
        ]);

        $response = $this->getJson('/api/device/manifest', [
            'Authorization' => 'Bearer ' . $this->token,
            'If-None-Match' => $version,
        ]);

        $response->assertStatus(304);
    }

    public function test_manifest_returns_empty_response_when_no_manifest_exists(): void
    {
        $response = $this->getJson('/api/device/manifest', [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(200);
        $response->assertJson([
            'version' => null,
            'generated_at' => null,
            'items' => [],
        ]);
    }

    // ──────────────────────────────────────────────
    // POST /api/device/manifest/confirm
    // ──────────────────────────────────────────────

    public function test_manifest_confirm_updates_screen_manifest_version(): void
    {
        $version = 'sha256-confirmed-version-def456';

        $response = $this->postJson('/api/device/manifest/confirm', [
            'version' => $version,
        ], [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(200);
        $response->assertJson(['ack' => true]);

        $this->screen->refresh();
        $this->assertEquals($version, $this->screen->manifest_version);
    }

    // ──────────────────────────────────────────────
    // POST /api/device/impressions
    // ──────────────────────────────────────────────

    public function test_impressions_persists_with_source_order_line(): void
    {
        $order = Order::factory()->create(['tenant_id' => $this->tenant->id]);
        $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);
        $creative = Creative::factory()->create(['order_line_id' => $orderLine->id]);

        $response = $this->postJson('/api/device/impressions', [
            'impressions' => [
                [
                    'order_line_id' => $orderLine->id,
                    'creative_id' => $creative->id,
                    'started_at' => '2026-07-09T12:00:00.000Z',
                    'ended_at' => '2026-07-09T12:00:10.000Z',
                    'duration_seconds' => 10,
                    'result' => 'success',
                    'failure_reason' => null,
                ],
            ],
        ], [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(201);
        $response->assertJson(['ack' => true, 'count' => 1]);

        $this->assertDatabaseHas('impressions', [
            'screen_id' => $this->screen->id,
            'order_line_id' => $orderLine->id,
            'creative_id' => $creative->id,
            'source' => 'order_line',
            'result' => 'success',
        ]);
    }

    public function test_impressions_rejects_422_with_missing_order_line_id(): void
    {
        $response = $this->postJson('/api/device/impressions', [
            'impressions' => [
                [
                    'creative_id' => (string) Str::uuid(),
                    'started_at' => '2026-07-09T12:00:00.000Z',
                    'ended_at' => '2026-07-09T12:00:10.000Z',
                    'duration_seconds' => 10,
                    'result' => 'success',
                ],
            ],
        ], [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(422);
    }

    public function test_impressions_rejects_422_with_nonexistent_order_line_id(): void
    {
        $order = Order::factory()->create(['tenant_id' => $this->tenant->id]);
        $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);
        $creative = Creative::factory()->create(['order_line_id' => $orderLine->id]);

        $response = $this->postJson('/api/device/impressions', [
            'impressions' => [
                [
                    'order_line_id' => (string) Str::uuid(), // nonexistent
                    'creative_id' => $creative->id,
                    'started_at' => '2026-07-09T12:00:00.000Z',
                    'ended_at' => '2026-07-09T12:00:10.000Z',
                    'duration_seconds' => 10,
                    'result' => 'success',
                ],
            ],
        ], [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(422);
    }

    // ──────────────────────────────────────────────
    // Deprecated endpoints — 410 Gone
    // ──────────────────────────────────────────────

    public function test_deprecated_get_playlist_returns_410_gone(): void
    {
        $response = $this->getJson('/api/device/playlist');

        $response->assertStatus(410);
        $response->assertJson(['message' => 'This endpoint has been deprecated. Please update your device firmware.']);
    }

    public function test_deprecated_post_playlist_confirm_returns_410_gone(): void
    {
        $response = $this->postJson('/api/device/playlist/confirm');

        $response->assertStatus(410);
        $response->assertJson(['message' => 'This endpoint has been deprecated. Please update your device firmware.']);
    }

    public function test_deprecated_get_config_returns_410_gone(): void
    {
        $response = $this->getJson('/api/device/config');

        $response->assertStatus(410);
        $response->assertJson(['message' => 'This endpoint has been deprecated. Please update your device firmware.']);
    }

    // ──────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────

    private function issueToken(Screen $screen): string
    {
        $now = time();
        $payload = [
            'sub' => $screen->id,
            'tenant_id' => $screen->tenant_id,
            'venue_id' => $screen->venue_id ?? 'venue-test',
            'iat' => $now,
            'exp' => $now + 86400,
        ];

        return JWT::encode($payload, $this->jwtSecret, 'HS256');
    }
}
