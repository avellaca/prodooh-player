<?php

namespace Tests\Feature;

use App\Models\Content;
use App\Models\Playlist;
use App\Models\PlaylistItem;
use App\Models\Screen;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ContentRotationTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $tenantAdmin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::factory()->create();
        $this->tenantAdmin = User::factory()->tenantAdmin()->create([
            'tenant_id' => $this->tenant->id,
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
            'filename' => 'test.jpg',
            'mime_type' => 'image/jpeg',
            'storage_path' => 'content/test.jpg',
            'file_size_bytes' => 1024,
            'width' => 1920,
            'height' => 1080,
            'orientation' => 'landscape',
            'rotation' => 0,
            'checksum_sha256' => hash('sha256', 'test'),
        ], $overrides));
    }

    // ─── SUCCESS CASES ──────────────────────────────────────────────────

    public function test_can_set_rotation_on_image(): void
    {
        $content = $this->createContent(['mime_type' => 'image/jpeg']);

        $response = $this->actingAsTenantAdmin()
            ->putJson("/api/admin/content/{$content->id}/rotate", ['rotation' => 90]);

        $response->assertOk()
            ->assertJson([
                'data' => ['rotation' => 90],
                'message' => 'Content rotation updated successfully.',
            ]);

        $this->assertDatabaseHas('content', [
            'id' => $content->id,
            'rotation' => 90,
        ]);
    }

    public function test_can_set_rotation_on_video_not_in_playlist(): void
    {
        $content = $this->createContent([
            'filename' => 'video.mp4',
            'mime_type' => 'video/mp4',
        ]);

        $response = $this->actingAsTenantAdmin()
            ->putJson("/api/admin/content/{$content->id}/rotate", ['rotation' => 180]);

        $response->assertOk()
            ->assertJson([
                'data' => ['rotation' => 180],
                'message' => 'Content rotation updated successfully.',
            ]);

        $this->assertDatabaseHas('content', [
            'id' => $content->id,
            'rotation' => 180,
        ]);
    }

    public function test_can_set_rotation_to_zero(): void
    {
        $content = $this->createContent(['rotation' => 90]);

        $response = $this->actingAsTenantAdmin()
            ->putJson("/api/admin/content/{$content->id}/rotate", ['rotation' => 0]);

        $response->assertOk()
            ->assertJson(['data' => ['rotation' => 0]]);
    }

    public function test_can_set_rotation_to_270(): void
    {
        $content = $this->createContent();

        $response = $this->actingAsTenantAdmin()
            ->putJson("/api/admin/content/{$content->id}/rotate", ['rotation' => 270]);

        $response->assertOk()
            ->assertJson(['data' => ['rotation' => 270]]);
    }

    // ─── VIDEO IN ACTIVE PLAYLIST ───────────────────────────────────────

    public function test_cannot_rotate_video_in_active_playlist(): void
    {
        $content = $this->createContent([
            'filename' => 'video.mp4',
            'mime_type' => 'video/mp4',
        ]);

        // Create a playlist assigned to a screen (active)
        $playlist = Playlist::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Active Playlist',
            'version' => 1,
        ]);

        PlaylistItem::create([
            'playlist_id' => $playlist->id,
            'content_id' => $content->id,
            'type' => 'video',
            'duration_seconds' => 10,
            'position' => 1,
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
        ]);

        // Assign playlist to screen (making it active)
        $playlist->screens()->attach($screen->id);

        $response = $this->actingAsTenantAdmin()
            ->putJson("/api/admin/content/{$content->id}/rotate", ['rotation' => 90]);

        $response->assertUnprocessable()
            ->assertJson([
                'message' => 'Cannot rotate video while in active playlist.',
            ]);

        // Verify rotation was not changed
        $this->assertDatabaseHas('content', [
            'id' => $content->id,
            'rotation' => 0,
        ]);
    }

    public function test_can_rotate_image_even_if_in_active_playlist(): void
    {
        $content = $this->createContent(['mime_type' => 'image/jpeg']);

        // Create a playlist assigned to a screen (active)
        $playlist = Playlist::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Active Playlist',
            'version' => 1,
        ]);

        PlaylistItem::create([
            'playlist_id' => $playlist->id,
            'content_id' => $content->id,
            'type' => 'image',
            'duration_seconds' => 10,
            'position' => 1,
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
        ]);

        $playlist->screens()->attach($screen->id);

        // Images can be rotated even if in active playlist
        $response = $this->actingAsTenantAdmin()
            ->putJson("/api/admin/content/{$content->id}/rotate", ['rotation' => 90]);

        $response->assertOk()
            ->assertJson(['data' => ['rotation' => 90]]);
    }

    // ─── VALIDATION ERRORS ──────────────────────────────────────────────

    public function test_rejects_invalid_rotation_value(): void
    {
        $content = $this->createContent();

        $response = $this->actingAsTenantAdmin()
            ->putJson("/api/admin/content/{$content->id}/rotate", ['rotation' => 45]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['rotation']);
    }

    public function test_rejects_missing_rotation(): void
    {
        $content = $this->createContent();

        $response = $this->actingAsTenantAdmin()
            ->putJson("/api/admin/content/{$content->id}/rotate", []);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['rotation']);
    }

    // ─── NOT FOUND ──────────────────────────────────────────────────────

    public function test_returns_404_for_nonexistent_content(): void
    {
        $response = $this->actingAsTenantAdmin()
            ->putJson('/api/admin/content/nonexistent-uuid/rotate', ['rotation' => 90]);

        $response->assertNotFound()
            ->assertJson(['message' => 'Content not found.']);
    }
}
