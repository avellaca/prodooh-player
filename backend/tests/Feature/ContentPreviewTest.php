<?php

namespace Tests\Feature;

use App\Models\Content;
use App\Models\Playlist;
use App\Models\PlaylistItem;
use App\Models\Screen;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ContentPreviewTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $tenantAdmin;

    private Screen $screen;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::factory()->create();
        $this->tenantAdmin = User::factory()->tenantAdmin()->create([
            'tenant_id' => $this->tenant->id,
        ]);
        $this->screen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'orientation' => 'landscape',
            'resolution_width' => 3840,
            'resolution_height' => 2160,
        ]);
    }

    private function actingAsTenantAdmin(): self
    {
        return $this->actingAs($this->tenantAdmin, 'sanctum');
    }

    private function createContent(array $overrides = []): Content
    {
        return Content::create(array_merge([
            'tenant_id' => $this->tenant->id,
            'filename' => 'test-image.jpg',
            'mime_type' => 'image/jpeg',
            'storage_path' => 'content/test-image.jpg',
            'file_size_bytes' => 2048000,
            'width' => 1920,
            'height' => 1080,
            'orientation' => 'landscape',
            'rotation' => 0,
            'checksum_sha256' => hash('sha256', 'test-content'),
        ], $overrides));
    }

    // ─── CONTENT PREVIEW (IMAGE) ────────────────────────────────────────

    public function test_preview_image_returns_content_info(): void
    {
        $content = $this->createContent();

        $response = $this->actingAsTenantAdmin()
            ->getJson("/api/admin/content/{$content->id}/preview");

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [
                    'content_id',
                    'type',
                    'filename',
                    'mime_type',
                    'format',
                    'resolution' => ['width', 'height'],
                    'effective_resolution' => ['width', 'height'],
                    'orientation',
                    'rotation',
                    'duration_seconds',
                    'file_size_bytes',
                    'warnings',
                ],
            ])
            ->assertJson([
                'data' => [
                    'content_id' => $content->id,
                    'type' => 'image',
                    'filename' => 'test-image.jpg',
                    'mime_type' => 'image/jpeg',
                    'format' => 'JPEG',
                    'resolution' => ['width' => 1920, 'height' => 1080],
                    'effective_resolution' => ['width' => 1920, 'height' => 1080],
                    'orientation' => 'landscape',
                    'rotation' => 0,
                    'file_size_bytes' => 2048000,
                ],
            ]);
    }

    // ─── CONTENT PREVIEW (VIDEO) ────────────────────────────────────────

    public function test_preview_video_includes_duration(): void
    {
        $content = $this->createContent([
            'filename' => 'promo.mp4',
            'mime_type' => 'video/mp4',
            'duration_seconds' => 30,
            'width' => 3840,
            'height' => 2160,
        ]);

        $response = $this->actingAsTenantAdmin()
            ->getJson("/api/admin/content/{$content->id}/preview");

        $response->assertOk()
            ->assertJson([
                'data' => [
                    'type' => 'video',
                    'format' => 'MP4',
                    'duration_seconds' => 30,
                    'resolution' => ['width' => 3840, 'height' => 2160],
                ],
            ]);
    }

    // ─── PREVIEW WITH SCREEN CONTEXT ────────────────────────────────────

    public function test_preview_with_screen_context_shows_screen_info(): void
    {
        $content = $this->createContent([
            'width' => 3840,
            'height' => 2160,
        ]);

        $response = $this->actingAsTenantAdmin()
            ->getJson("/api/admin/content/{$content->id}/preview?screen_id={$this->screen->id}");

        $response->assertOk()
            ->assertJson([
                'data' => [
                    'screen' => [
                        'id' => $this->screen->id,
                        'name' => $this->screen->name,
                        'resolution' => ['width' => 3840, 'height' => 2160],
                        'orientation' => 'landscape',
                    ],
                    'warnings' => [],
                ],
            ]);
    }

    // ─── ORIENTATION MISMATCH WARNING ───────────────────────────────────

    public function test_preview_detects_orientation_mismatch(): void
    {
        // Portrait content against landscape screen
        $content = $this->createContent([
            'width' => 1080,
            'height' => 1920,
            'orientation' => 'portrait',
        ]);

        $response = $this->actingAsTenantAdmin()
            ->getJson("/api/admin/content/{$content->id}/preview?screen_id={$this->screen->id}");

        $response->assertOk();

        $data = $response->json('data');
        $warningTypes = array_column($data['warnings'], 'type');
        $this->assertContains('orientation_mismatch', $warningTypes);
    }

    public function test_preview_no_orientation_mismatch_when_matching(): void
    {
        // Landscape content against landscape screen
        $content = $this->createContent([
            'width' => 1920,
            'height' => 1080,
            'orientation' => 'landscape',
        ]);

        // Create a matching screen
        $screen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'orientation' => 'landscape',
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);

        $response = $this->actingAsTenantAdmin()
            ->getJson("/api/admin/content/{$content->id}/preview?screen_id={$screen->id}");

        $response->assertOk();

        $data = $response->json('data');
        $this->assertEmpty($data['warnings']);
    }

    // ─── RESOLUTION MISMATCH WARNING ────────────────────────────────────

    public function test_preview_detects_resolution_mismatch(): void
    {
        // 1080p content against 4K screen
        $content = $this->createContent([
            'width' => 1920,
            'height' => 1080,
        ]);

        $response = $this->actingAsTenantAdmin()
            ->getJson("/api/admin/content/{$content->id}/preview?screen_id={$this->screen->id}");

        $response->assertOk();

        $data = $response->json('data');
        $warningTypes = array_column($data['warnings'], 'type');
        $this->assertContains('resolution_mismatch', $warningTypes);
    }

    // ─── ROTATION AFFECTS EFFECTIVE DIMENSIONS ──────────────────────────

    public function test_preview_rotation_90_swaps_effective_dimensions(): void
    {
        $content = $this->createContent([
            'width' => 1920,
            'height' => 1080,
            'rotation' => 90,
        ]);

        $response = $this->actingAsTenantAdmin()
            ->getJson("/api/admin/content/{$content->id}/preview");

        $response->assertOk()
            ->assertJson([
                'data' => [
                    'resolution' => ['width' => 1920, 'height' => 1080],
                    'effective_resolution' => ['width' => 1080, 'height' => 1920],
                    'rotation' => 90,
                ],
            ]);
    }

    public function test_preview_rotation_270_swaps_effective_dimensions(): void
    {
        $content = $this->createContent([
            'width' => 3840,
            'height' => 2160,
            'rotation' => 270,
        ]);

        $response = $this->actingAsTenantAdmin()
            ->getJson("/api/admin/content/{$content->id}/preview");

        $response->assertOk()
            ->assertJson([
                'data' => [
                    'effective_resolution' => ['width' => 2160, 'height' => 3840],
                ],
            ]);
    }

    public function test_preview_rotation_180_does_not_swap_dimensions(): void
    {
        $content = $this->createContent([
            'width' => 1920,
            'height' => 1080,
            'rotation' => 180,
        ]);

        $response = $this->actingAsTenantAdmin()
            ->getJson("/api/admin/content/{$content->id}/preview");

        $response->assertOk()
            ->assertJson([
                'data' => [
                    'effective_resolution' => ['width' => 1920, 'height' => 1080],
                ],
            ]);
    }

    // ─── ROTATED CONTENT ORIENTATION CHECK AGAINST SCREEN ───────────────

    public function test_preview_rotation_corrects_orientation_for_screen_check(): void
    {
        // Portrait screen
        $portraitScreen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'orientation' => 'portrait',
            'resolution_width' => 2160,
            'resolution_height' => 3840,
        ]);

        // Landscape image rotated 90° becomes portrait
        $content = $this->createContent([
            'width' => 3840,
            'height' => 2160,
            'orientation' => 'landscape',
            'rotation' => 90,
        ]);

        $response = $this->actingAsTenantAdmin()
            ->getJson("/api/admin/content/{$content->id}/preview?screen_id={$portraitScreen->id}");

        $response->assertOk();

        $data = $response->json('data');
        $warningTypes = array_column($data['warnings'], 'type');
        // After 90° rotation, 3840x2160 becomes 2160x3840 (portrait) — matches the screen
        $this->assertNotContains('orientation_mismatch', $warningTypes);
    }

    // ─── URL PLAYLIST ITEM PREVIEW ──────────────────────────────────────

    public function test_preview_url_playlist_item(): void
    {
        $playlist = Playlist::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Test Playlist',
            'version' => '1',
        ]);

        $item = PlaylistItem::create([
            'playlist_id' => $playlist->id,
            'type' => 'url',
            'url' => 'https://example.com/ad-page',
            'duration_seconds' => 15,
            'position' => 1,
            'refresh_interval' => 300,
        ]);

        $response = $this->actingAsTenantAdmin()
            ->getJson("/api/admin/playlist-items/{$item->id}/preview");

        $response->assertOk()
            ->assertJson([
                'data' => [
                    'playlist_item_id' => $item->id,
                    'type' => 'url',
                    'url' => 'https://example.com/ad-page',
                    'duration_seconds' => 15,
                    'refresh_interval' => 300,
                    'preview_url' => 'https://example.com/ad-page',
                ],
            ]);
    }

    public function test_preview_url_playlist_item_with_screen_context(): void
    {
        $playlist = Playlist::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Test Playlist',
            'version' => '1',
        ]);

        $item = PlaylistItem::create([
            'playlist_id' => $playlist->id,
            'type' => 'url',
            'url' => 'https://example.com/content',
            'duration_seconds' => 10,
            'position' => 1,
        ]);

        $response = $this->actingAsTenantAdmin()
            ->getJson("/api/admin/playlist-items/{$item->id}/preview?screen_id={$this->screen->id}");

        $response->assertOk()
            ->assertJson([
                'data' => [
                    'type' => 'url',
                    'screen' => [
                        'id' => $this->screen->id,
                        'resolution' => ['width' => 3840, 'height' => 2160],
                        'orientation' => 'landscape',
                    ],
                ],
            ]);
    }

    // ─── CONTENT PREVIEW WITH MEDIA FILE (image content) ────────────────

    public function test_preview_image_content_with_content_item_in_playlist(): void
    {
        $content = $this->createContent([
            'width' => 1920,
            'height' => 1080,
            'mime_type' => 'image/png',
            'filename' => 'banner.png',
        ]);

        $playlist = Playlist::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Test Playlist',
            'version' => '1',
        ]);

        $item = PlaylistItem::create([
            'playlist_id' => $playlist->id,
            'content_id' => $content->id,
            'type' => 'image',
            'duration_seconds' => 10,
            'position' => 1,
        ]);

        $response = $this->actingAsTenantAdmin()
            ->getJson("/api/admin/playlist-items/{$item->id}/preview");

        $response->assertOk()
            ->assertJson([
                'data' => [
                    'content_id' => $content->id,
                    'type' => 'image',
                    'format' => 'PNG',
                    'filename' => 'banner.png',
                ],
            ]);
    }

    // ─── FILE SERVING ───────────────────────────────────────────────────

    public function test_serve_file_returns_content_with_correct_mime_type(): void
    {
        Storage::fake('local');
        Storage::disk('local')->put('content/test-image.jpg', 'fake image content');

        $content = $this->createContent([
            'storage_path' => 'content/test-image.jpg',
        ]);

        $response = $this->actingAsTenantAdmin()
            ->get("/api/admin/content/{$content->id}/preview/file");

        $response->assertOk()
            ->assertHeader('Content-Type', 'image/jpeg');
    }

    public function test_serve_file_returns_404_for_missing_file(): void
    {
        Storage::fake('local');

        $content = $this->createContent([
            'storage_path' => 'content/nonexistent.jpg',
        ]);

        $response = $this->actingAsTenantAdmin()
            ->getJson("/api/admin/content/{$content->id}/preview/file");

        $response->assertNotFound()
            ->assertJson(['message' => 'File not found on storage.']);
    }

    // ─── ERROR CASES ────────────────────────────────────────────────────

    public function test_preview_returns_404_for_nonexistent_content(): void
    {
        $response = $this->actingAsTenantAdmin()
            ->getJson('/api/admin/content/nonexistent-uuid/preview');

        $response->assertNotFound()
            ->assertJson(['message' => 'Content not found.']);
    }

    public function test_preview_playlist_item_returns_404_for_nonexistent_item(): void
    {
        $response = $this->actingAsTenantAdmin()
            ->getJson('/api/admin/playlist-items/nonexistent-uuid/preview');

        $response->assertNotFound()
            ->assertJson(['message' => 'Playlist item not found.']);
    }

    public function test_preview_works_without_screen_id(): void
    {
        $content = $this->createContent();

        $response = $this->actingAsTenantAdmin()
            ->getJson("/api/admin/content/{$content->id}/preview");

        $response->assertOk();

        $data = $response->json('data');
        $this->assertArrayNotHasKey('screen', $data);
        $this->assertEmpty($data['warnings']);
    }

    // ─── ASPECT RATIO MISMATCH ──────────────────────────────────────────

    public function test_preview_detects_aspect_ratio_mismatch(): void
    {
        // 4:3 content against 16:9 screen
        $content = $this->createContent([
            'width' => 1600,
            'height' => 1200,
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'orientation' => 'landscape',
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);

        $response = $this->actingAsTenantAdmin()
            ->getJson("/api/admin/content/{$content->id}/preview?screen_id={$screen->id}");

        $response->assertOk();

        $data = $response->json('data');
        $warningTypes = array_column($data['warnings'], 'type');
        $this->assertContains('aspect_ratio_mismatch', $warningTypes);
    }

    // ─── FORMAT DISPLAY ─────────────────────────────────────────────────

    public function test_preview_shows_correct_format_for_webp(): void
    {
        $content = $this->createContent([
            'mime_type' => 'image/webp',
            'filename' => 'animation.webp',
        ]);

        $response = $this->actingAsTenantAdmin()
            ->getJson("/api/admin/content/{$content->id}/preview");

        $response->assertOk()
            ->assertJson([
                'data' => [
                    'format' => 'WebP',
                ],
            ]);
    }
}
