<?php

namespace Tests\Feature\Device;

use App\Models\Content;
use App\Models\Playlist;
use App\Models\PlaylistItem;
use App\Models\Screen;
use App\Models\Tenant;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class PlaylistSyncTest extends TestCase
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

        Storage::fake('local');

        $this->tenant = Tenant::factory()->create();
        $this->screen = Screen::factory()->create(['tenant_id' => $this->tenant->id]);
        $this->token = $this->issueToken($this->screen);
    }

    // ──────────────────────────────────────────────
    // GET /api/device/playlist
    // ──────────────────────────────────────────────

    public function test_returns_empty_playlist_when_no_playlist_assigned(): void
    {
        $response = $this->getJson('/api/device/playlist', [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(200);
        $response->assertJson([
            'version' => null,
            'etag' => null,
            'items' => [],
        ]);
    }

    public function test_returns_playlist_manifest_with_items(): void
    {
        $playlist = Playlist::factory()->create(['tenant_id' => $this->tenant->id]);
        $this->screen->playlists()->attach($playlist->id, ['assigned_at' => now()]);

        // Create content for image/video items
        $content = Content::create([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->tenant->id,
            'filename' => 'test-image.jpg',
            'mime_type' => 'image/jpeg',
            'storage_path' => 'content/test-image.jpg',
            'file_size_bytes' => 1024,
            'width' => 1920,
            'height' => 1080,
            'orientation' => 'landscape',
            'rotation' => 90,
            'checksum_sha256' => 'abc123checksum',
        ]);

        Storage::disk('local')->put('content/test-image.jpg', 'fake image data');

        $imageItem = PlaylistItem::factory()->create([
            'playlist_id' => $playlist->id,
            'content_id' => $content->id,
            'type' => 'image',
            'duration_seconds' => 10,
            'position' => 0,
        ]);

        $urlItem = PlaylistItem::factory()->create([
            'playlist_id' => $playlist->id,
            'type' => 'url',
            'url' => 'https://example.com/dashboard',
            'duration_seconds' => 15,
            'position' => 1,
            'refresh_interval' => 60,
        ]);

        $response = $this->getJson('/api/device/playlist', [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'version',
            'etag',
            'items' => [
                '*' => ['id', 'type', 'url', 'duration', 'rotation', 'refresh_interval', 'checksum'],
            ],
        ]);

        $data = $response->json();
        $this->assertEquals($playlist->version, $data['version']);
        $this->assertEquals($playlist->version, $data['etag']);
        $this->assertCount(2, $data['items']);

        // Items should be sorted by position
        $this->assertEquals($imageItem->id, $data['items'][0]['id']);
        $this->assertEquals('image', $data['items'][0]['type']);
        $this->assertEquals(10, $data['items'][0]['duration']);
        $this->assertEquals(90, $data['items'][0]['rotation']);
        $this->assertEquals('abc123checksum', $data['items'][0]['checksum']);

        $this->assertEquals($urlItem->id, $data['items'][1]['id']);
        $this->assertEquals('url', $data['items'][1]['type']);
        $this->assertEquals('https://example.com/dashboard', $data['items'][1]['url']);
        $this->assertEquals(15, $data['items'][1]['duration']);
        $this->assertEquals(60, $data['items'][1]['refresh_interval']);
        $this->assertNull($data['items'][1]['checksum']);
    }

    public function test_returns_etag_header(): void
    {
        $playlist = Playlist::factory()->create(['tenant_id' => $this->tenant->id]);
        $this->screen->playlists()->attach($playlist->id, ['assigned_at' => now()]);

        $response = $this->getJson('/api/device/playlist', [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(200);
        $response->assertHeader('ETag', $playlist->version);
    }

    public function test_returns_304_when_if_none_match_matches_current_version(): void
    {
        $playlist = Playlist::factory()->create(['tenant_id' => $this->tenant->id]);
        $this->screen->playlists()->attach($playlist->id, ['assigned_at' => now()]);

        $response = $this->getJson('/api/device/playlist', [
            'Authorization' => 'Bearer ' . $this->token,
            'If-None-Match' => $playlist->version,
        ]);

        $response->assertStatus(304);
    }

    public function test_returns_200_when_if_none_match_does_not_match(): void
    {
        $playlist = Playlist::factory()->create(['tenant_id' => $this->tenant->id]);
        $this->screen->playlists()->attach($playlist->id, ['assigned_at' => now()]);

        $response = $this->getJson('/api/device/playlist', [
            'Authorization' => 'Bearer ' . $this->token,
            'If-None-Match' => 'stale-version-uuid',
        ]);

        $response->assertStatus(200);
        $response->assertJson([
            'version' => $playlist->version,
        ]);
    }

    public function test_items_are_sorted_by_position(): void
    {
        $playlist = Playlist::factory()->create(['tenant_id' => $this->tenant->id]);
        $this->screen->playlists()->attach($playlist->id, ['assigned_at' => now()]);

        $item3 = PlaylistItem::factory()->create([
            'playlist_id' => $playlist->id,
            'type' => 'url',
            'url' => 'https://example.com/third',
            'position' => 2,
        ]);
        $item1 = PlaylistItem::factory()->create([
            'playlist_id' => $playlist->id,
            'type' => 'url',
            'url' => 'https://example.com/first',
            'position' => 0,
        ]);
        $item2 = PlaylistItem::factory()->create([
            'playlist_id' => $playlist->id,
            'type' => 'url',
            'url' => 'https://example.com/second',
            'position' => 1,
        ]);

        $response = $this->getJson('/api/device/playlist', [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(200);
        $data = $response->json();
        $this->assertEquals($item1->id, $data['items'][0]['id']);
        $this->assertEquals($item2->id, $data['items'][1]['id']);
        $this->assertEquals($item3->id, $data['items'][2]['id']);
    }

    public function test_requires_jwt_authentication(): void
    {
        $response = $this->getJson('/api/device/playlist');

        $response->assertStatus(401);
    }

    // ──────────────────────────────────────────────
    // POST /api/device/playlist/confirm
    // ──────────────────────────────────────────────

    public function test_confirm_adopted_updates_screen_playlist_version(): void
    {
        $version = (string) Str::uuid();

        $response = $this->postJson('/api/device/playlist/confirm', [
            'version' => $version,
            'status' => 'adopted',
        ], [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(200);
        $response->assertJson(['ack' => true]);

        $this->screen->refresh();
        $this->assertEquals($version, $this->screen->playlist_version);
    }

    public function test_confirm_failed_does_not_update_playlist_version(): void
    {
        $originalVersion = $this->screen->playlist_version;
        $version = (string) Str::uuid();

        $response = $this->postJson('/api/device/playlist/confirm', [
            'version' => $version,
            'status' => 'failed',
            'error' => 'Download failed for item 3',
        ], [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(200);
        $response->assertJson(['ack' => true]);

        $this->screen->refresh();
        $this->assertEquals($originalVersion, $this->screen->playlist_version);
    }

    public function test_confirm_validates_required_fields(): void
    {
        $response = $this->postJson('/api/device/playlist/confirm', [], [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['version', 'status']);
    }

    public function test_confirm_validates_status_enum(): void
    {
        $response = $this->postJson('/api/device/playlist/confirm', [
            'version' => (string) Str::uuid(),
            'status' => 'invalid-status',
        ], [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['status']);
    }

    public function test_confirm_requires_jwt_authentication(): void
    {
        $response = $this->postJson('/api/device/playlist/confirm', [
            'version' => (string) Str::uuid(),
            'status' => 'adopted',
        ]);

        $response->assertStatus(401);
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
