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

class PlaylistCrudTest extends TestCase
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

    public function test_super_admin_can_list_all_playlists(): void
    {
        $tenant1 = Tenant::factory()->create();
        $tenant2 = Tenant::factory()->create();
        Playlist::factory()->create(['tenant_id' => $tenant1->id]);
        Playlist::factory()->create(['tenant_id' => $tenant2->id]);

        $this->actingAsSuperAdmin();

        $response = $this->getJson('/api/admin/playlists');

        $response->assertOk()
            ->assertJsonCount(2, 'data');
    }

    public function test_tenant_admin_can_only_list_own_playlists(): void
    {
        $tenant1 = Tenant::factory()->create();
        $tenant2 = Tenant::factory()->create();
        Playlist::factory()->create(['tenant_id' => $tenant1->id]);
        Playlist::factory()->create(['tenant_id' => $tenant2->id]);

        $this->actingAsTenantAdmin($tenant1);

        $response = $this->getJson('/api/admin/playlists');

        $response->assertOk()
            ->assertJsonCount(1, 'data');
    }

    public function test_playlists_index_includes_item_count(): void
    {
        $tenant = Tenant::factory()->create();
        $playlist = Playlist::factory()->create(['tenant_id' => $tenant->id]);
        PlaylistItem::factory()->count(3)->create(['playlist_id' => $playlist->id]);

        $this->actingAsSuperAdmin();

        $response = $this->getJson('/api/admin/playlists');

        $response->assertOk()
            ->assertJsonPath('data.0.playlist_items_count', 3);
    }

    public function test_unauthenticated_user_cannot_list_playlists(): void
    {
        $response = $this->getJson('/api/admin/playlists');

        $response->assertUnauthorized();
    }

    // --- STORE ---

    public function test_super_admin_can_create_playlist(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsSuperAdmin();

        $response = $this->postJson('/api/admin/playlists', [
            'tenant_id' => $tenant->id,
            'name' => 'Morning Rotation',
        ]);

        $response->assertCreated()
            ->assertJsonStructure([
                'data' => ['id', 'tenant_id', 'name', 'version'],
                'message',
            ])
            ->assertJson([
                'data' => [
                    'tenant_id' => $tenant->id,
                    'name' => 'Morning Rotation',
                ],
            ]);

        // Version should be a UUID
        $this->assertNotEmpty($response->json('data.version'));
    }

    public function test_tenant_admin_can_create_playlist(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $response = $this->postJson('/api/admin/playlists', [
            'name' => 'Afternoon Loop',
        ]);

        $response->assertCreated()
            ->assertJson([
                'data' => [
                    'tenant_id' => $tenant->id,
                    'name' => 'Afternoon Loop',
                ],
            ]);

        $this->assertDatabaseHas('playlists', [
            'tenant_id' => $tenant->id,
            'name' => 'Afternoon Loop',
        ]);
    }

    public function test_store_requires_name(): void
    {
        $this->actingAsSuperAdmin();

        $response = $this->postJson('/api/admin/playlists', [
            'tenant_id' => Tenant::factory()->create()->id,
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['name']);
    }

    public function test_super_admin_must_provide_tenant_id(): void
    {
        $this->actingAsSuperAdmin();

        $response = $this->postJson('/api/admin/playlists', [
            'name' => 'No Tenant Playlist',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['tenant_id']);
    }

    // --- SHOW ---

    public function test_can_show_playlist_with_items_ordered_by_position(): void
    {
        $tenant = Tenant::factory()->create();
        $playlist = Playlist::factory()->create(['tenant_id' => $tenant->id]);

        PlaylistItem::factory()->create([
            'playlist_id' => $playlist->id,
            'type' => 'video',
            'position' => 2,
        ]);
        PlaylistItem::factory()->create([
            'playlist_id' => $playlist->id,
            'type' => 'image',
            'position' => 0,
        ]);
        PlaylistItem::factory()->create([
            'playlist_id' => $playlist->id,
            'type' => 'url',
            'url' => 'https://example.com',
            'position' => 1,
        ]);

        $this->actingAsSuperAdmin();

        $response = $this->getJson("/api/admin/playlists/{$playlist->id}");

        $response->assertOk()
            ->assertJsonPath('data.id', $playlist->id)
            ->assertJsonCount(3, 'data.playlist_items');

        // Verify items are ordered by position
        $items = $response->json('data.playlist_items');
        $this->assertEquals(0, $items[0]['position']);
        $this->assertEquals(1, $items[1]['position']);
        $this->assertEquals(2, $items[2]['position']);
    }

    public function test_tenant_admin_cannot_view_other_tenant_playlist(): void
    {
        $tenant1 = Tenant::factory()->create();
        $tenant2 = Tenant::factory()->create();
        $playlist = Playlist::factory()->create(['tenant_id' => $tenant2->id]);

        $this->actingAsTenantAdmin($tenant1);

        $response = $this->getJson("/api/admin/playlists/{$playlist->id}");

        $response->assertNotFound();
    }

    // --- UPDATE ---

    public function test_can_update_playlist_items(): void
    {
        $tenant = Tenant::factory()->create();
        $playlist = Playlist::factory()->create(['tenant_id' => $tenant->id]);
        $originalVersion = $playlist->version;

        $this->actingAsSuperAdmin();

        $response = $this->putJson("/api/admin/playlists/{$playlist->id}", [
            'items' => [
                ['type' => 'image', 'content_id' => null, 'duration_seconds' => 10, 'position' => 0],
                ['type' => 'video', 'content_id' => null, 'duration_seconds' => 30, 'position' => 1],
                ['type' => 'url', 'url' => 'https://example.com', 'duration_seconds' => 15, 'position' => 2, 'refresh_interval' => 60],
            ],
        ]);

        $response->assertOk()
            ->assertJsonCount(3, 'data.playlist_items');

        // Version should change
        $playlist->refresh();
        $this->assertNotEquals($originalVersion, $playlist->version);
    }

    public function test_update_items_replaces_existing_items(): void
    {
        $tenant = Tenant::factory()->create();
        $playlist = Playlist::factory()->create(['tenant_id' => $tenant->id]);
        PlaylistItem::factory()->count(5)->create(['playlist_id' => $playlist->id]);

        $this->actingAsSuperAdmin();

        $response = $this->putJson("/api/admin/playlists/{$playlist->id}", [
            'items' => [
                ['type' => 'image', 'position' => 0, 'duration_seconds' => 10],
            ],
        ]);

        $response->assertOk()
            ->assertJsonCount(1, 'data.playlist_items');

        $this->assertEquals(1, PlaylistItem::where('playlist_id', $playlist->id)->count());
    }

    public function test_can_update_playlist_name(): void
    {
        $tenant = Tenant::factory()->create();
        $playlist = Playlist::factory()->create(['tenant_id' => $tenant->id, 'name' => 'Old Name']);

        $this->actingAsSuperAdmin();

        $response = $this->putJson("/api/admin/playlists/{$playlist->id}", [
            'name' => 'New Name',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.name', 'New Name');
    }

    public function test_update_validates_item_types(): void
    {
        $tenant = Tenant::factory()->create();
        $playlist = Playlist::factory()->create(['tenant_id' => $tenant->id]);

        $this->actingAsSuperAdmin();

        $response = $this->putJson("/api/admin/playlists/{$playlist->id}", [
            'items' => [
                ['type' => 'invalid_type', 'position' => 0],
            ],
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['items.0.type']);
    }

    public function test_supports_image_video_and_url_item_types(): void
    {
        $tenant = Tenant::factory()->create();
        $playlist = Playlist::factory()->create(['tenant_id' => $tenant->id]);

        $this->actingAsSuperAdmin();

        $response = $this->putJson("/api/admin/playlists/{$playlist->id}", [
            'items' => [
                ['type' => 'image', 'position' => 0, 'duration_seconds' => 10],
                ['type' => 'video', 'position' => 1, 'duration_seconds' => 30],
                ['type' => 'url', 'url' => 'https://news.example.com', 'position' => 2, 'duration_seconds' => 15, 'refresh_interval' => 120],
            ],
        ]);

        $response->assertOk();

        $items = $response->json('data.playlist_items');
        $this->assertEquals('image', $items[0]['type']);
        $this->assertEquals('video', $items[1]['type']);
        $this->assertEquals('url', $items[2]['type']);
        $this->assertEquals('https://news.example.com', $items[2]['url']);
        $this->assertEquals(120, $items[2]['refresh_interval']);
    }

    // --- DELETE ---

    public function test_can_delete_playlist(): void
    {
        $tenant = Tenant::factory()->create();
        $playlist = Playlist::factory()->create(['tenant_id' => $tenant->id]);
        PlaylistItem::factory()->count(3)->create(['playlist_id' => $playlist->id]);

        $this->actingAsSuperAdmin();

        $response = $this->deleteJson("/api/admin/playlists/{$playlist->id}");

        $response->assertOk()
            ->assertJson(['message' => 'Playlist deleted successfully.']);

        $this->assertDatabaseMissing('playlists', ['id' => $playlist->id]);
        $this->assertEquals(0, PlaylistItem::where('playlist_id', $playlist->id)->count());
    }

    public function test_tenant_admin_cannot_delete_other_tenant_playlist(): void
    {
        $tenant1 = Tenant::factory()->create();
        $tenant2 = Tenant::factory()->create();
        $playlist = Playlist::factory()->create(['tenant_id' => $tenant2->id]);

        $this->actingAsTenantAdmin($tenant1);

        $response = $this->deleteJson("/api/admin/playlists/{$playlist->id}");

        $response->assertNotFound();
    }

    // --- ASSIGN ---

    public function test_can_assign_playlist_to_multiple_screens(): void
    {
        $tenant = Tenant::factory()->create();
        $playlist = Playlist::factory()->create(['tenant_id' => $tenant->id]);
        $screen1 = Screen::factory()->create(['tenant_id' => $tenant->id]);
        $screen2 = Screen::factory()->create(['tenant_id' => $tenant->id]);

        $this->actingAsSuperAdmin();

        $response = $this->postJson("/api/admin/playlists/{$playlist->id}/assign", [
            'screen_ids' => [$screen1->id, $screen2->id],
        ]);

        $response->assertOk()
            ->assertJson(['message' => 'Playlist assigned to screens successfully.']);

        $this->assertDatabaseHas('screen_playlists', [
            'playlist_id' => $playlist->id,
            'screen_id' => $screen1->id,
        ]);
        $this->assertDatabaseHas('screen_playlists', [
            'playlist_id' => $playlist->id,
            'screen_id' => $screen2->id,
        ]);
    }

    public function test_assign_requires_screen_ids(): void
    {
        $tenant = Tenant::factory()->create();
        $playlist = Playlist::factory()->create(['tenant_id' => $tenant->id]);

        $this->actingAsSuperAdmin();

        $response = $this->postJson("/api/admin/playlists/{$playlist->id}/assign", []);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['screen_ids']);
    }

    public function test_assign_validates_screen_ids_exist(): void
    {
        $tenant = Tenant::factory()->create();
        $playlist = Playlist::factory()->create(['tenant_id' => $tenant->id]);

        $this->actingAsSuperAdmin();

        $response = $this->postJson("/api/admin/playlists/{$playlist->id}/assign", [
            'screen_ids' => ['non-existent-id'],
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['screen_ids.0']);
    }

    public function test_reassigning_replaces_previous_screen_assignments(): void
    {
        $tenant = Tenant::factory()->create();
        $playlist = Playlist::factory()->create(['tenant_id' => $tenant->id]);
        $screen1 = Screen::factory()->create(['tenant_id' => $tenant->id]);
        $screen2 = Screen::factory()->create(['tenant_id' => $tenant->id]);
        $screen3 = Screen::factory()->create(['tenant_id' => $tenant->id]);

        $this->actingAsSuperAdmin();

        // First assignment
        $this->postJson("/api/admin/playlists/{$playlist->id}/assign", [
            'screen_ids' => [$screen1->id, $screen2->id],
        ]);

        // Reassign to different screens
        $this->postJson("/api/admin/playlists/{$playlist->id}/assign", [
            'screen_ids' => [$screen3->id],
        ]);

        // Only screen3 should be assigned now
        $this->assertDatabaseMissing('screen_playlists', [
            'playlist_id' => $playlist->id,
            'screen_id' => $screen1->id,
        ]);
        $this->assertDatabaseMissing('screen_playlists', [
            'playlist_id' => $playlist->id,
            'screen_id' => $screen2->id,
        ]);
        $this->assertDatabaseHas('screen_playlists', [
            'playlist_id' => $playlist->id,
            'screen_id' => $screen3->id,
        ]);
    }

    // --- CASCADE DELETE (content removal) ---

    public function test_content_deletion_sets_content_id_null_on_playlist_items(): void
    {
        $tenant = Tenant::factory()->create();
        $playlist = Playlist::factory()->create(['tenant_id' => $tenant->id]);

        $content = Content::create([
            'tenant_id' => $tenant->id,
            'filename' => 'test.jpg',
            'mime_type' => 'image/jpeg',
            'storage_path' => 'content/test/test.jpg',
            'file_size_bytes' => 1024,
            'width' => 1920,
            'height' => 1080,
            'orientation' => 'landscape',
            'rotation' => 0,
            'checksum_sha256' => hash('sha256', 'test'),
        ]);

        $item = PlaylistItem::factory()->create([
            'playlist_id' => $playlist->id,
            'content_id' => $content->id,
            'type' => 'image',
            'position' => 0,
        ]);

        // Delete content — FK set null should trigger
        $content->delete();

        $item->refresh();
        $this->assertNull($item->content_id);
    }
}
