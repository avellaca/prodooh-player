<?php

namespace Tests\Feature;

use App\Models\Content;
use App\Models\Tag;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\TestCase;

class TagControllerTest extends TestCase
{
    use DatabaseTransactions;

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

    // --- TAG CRUD ---

    public function test_can_list_tags(): void
    {
        Tag::factory()->count(3)->create(['tenant_id' => $this->tenant->id]);

        // Tag from another tenant should not appear
        Tag::factory()->create();

        $response = $this->withHeaders($this->authHeaders())
            ->getJson('/api/admin/tags');

        $response->assertOk()
            ->assertJsonCount(3, 'data');
    }

    public function test_can_create_tag(): void
    {
        $response = $this->withHeaders($this->authHeaders())
            ->postJson('/api/admin/tags', ['name' => 'Outdoor']);

        $response->assertCreated()
            ->assertJsonPath('data.name', 'Outdoor')
            ->assertJsonPath('data.tenant_id', $this->tenant->id);

        $this->assertDatabaseHas('tags', [
            'name' => 'Outdoor',
            'tenant_id' => $this->tenant->id,
        ]);
    }

    public function test_create_tag_requires_name(): void
    {
        $response = $this->withHeaders($this->authHeaders())
            ->postJson('/api/admin/tags', []);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['name']);
    }

    public function test_create_tag_name_max_100_chars(): void
    {
        $response = $this->withHeaders($this->authHeaders())
            ->postJson('/api/admin/tags', ['name' => str_repeat('a', 101)]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['name']);
    }

    public function test_create_tag_unique_per_tenant(): void
    {
        Tag::factory()->create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Outdoor',
        ]);

        $response = $this->withHeaders($this->authHeaders())
            ->postJson('/api/admin/tags', ['name' => 'Outdoor']);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['name']);
    }

    public function test_same_tag_name_allowed_for_different_tenants(): void
    {
        $otherTenant = Tenant::factory()->create();
        Tag::factory()->create([
            'tenant_id' => $otherTenant->id,
            'name' => 'Outdoor',
        ]);

        $response = $this->withHeaders($this->authHeaders())
            ->postJson('/api/admin/tags', ['name' => 'Outdoor']);

        $response->assertCreated();
    }

    public function test_can_rename_tag(): void
    {
        $tag = Tag::factory()->create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Old Name',
        ]);

        $response = $this->withHeaders($this->authHeaders())
            ->putJson("/api/admin/tags/{$tag->id}", ['name' => 'New Name']);

        $response->assertOk()
            ->assertJsonPath('data.name', 'New Name');

        $this->assertDatabaseHas('tags', [
            'id' => $tag->id,
            'name' => 'New Name',
        ]);
    }

    public function test_rename_tag_rejects_duplicate_name(): void
    {
        Tag::factory()->create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Existing',
        ]);

        $tag = Tag::factory()->create([
            'tenant_id' => $this->tenant->id,
            'name' => 'To Rename',
        ]);

        $response = $this->withHeaders($this->authHeaders())
            ->putJson("/api/admin/tags/{$tag->id}", ['name' => 'Existing']);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['name']);
    }

    public function test_rename_tag_allows_keeping_same_name(): void
    {
        $tag = Tag::factory()->create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Same Name',
        ]);

        $response = $this->withHeaders($this->authHeaders())
            ->putJson("/api/admin/tags/{$tag->id}", ['name' => 'Same Name']);

        $response->assertOk();
    }

    public function test_can_delete_tag(): void
    {
        $tag = Tag::factory()->create(['tenant_id' => $this->tenant->id]);

        $response = $this->withHeaders($this->authHeaders())
            ->deleteJson("/api/admin/tags/{$tag->id}");

        $response->assertNoContent();
        $this->assertDatabaseMissing('tags', ['id' => $tag->id]);
    }

    public function test_delete_tag_removes_pivot_associations(): void
    {
        $tag = Tag::factory()->create(['tenant_id' => $this->tenant->id]);
        $content = Content::factory()->create(['tenant_id' => $this->tenant->id]);
        $content->tags()->attach($tag->id);

        $response = $this->withHeaders($this->authHeaders())
            ->deleteJson("/api/admin/tags/{$tag->id}");

        $response->assertNoContent();
        $this->assertDatabaseMissing('content_tags', ['tag_id' => $tag->id]);
    }

    public function test_delete_nonexistent_tag_returns_404(): void
    {
        $response = $this->withHeaders($this->authHeaders())
            ->deleteJson('/api/admin/tags/nonexistent-uuid');

        $response->assertNotFound();
    }

    // --- CONTENT TAG ASSIGNMENT ---

    public function test_can_assign_tags_to_content(): void
    {
        $content = Content::factory()->create(['tenant_id' => $this->tenant->id]);
        $tags = Tag::factory()->count(2)->create(['tenant_id' => $this->tenant->id]);

        $response = $this->withHeaders($this->authHeaders())
            ->postJson("/api/admin/content/{$content->id}/tags", [
                'tag_ids' => $tags->pluck('id')->toArray(),
            ]);

        $response->assertOk()
            ->assertJsonPath('message', 'Tags asignados exitosamente.');

        foreach ($tags as $tag) {
            $this->assertDatabaseHas('content_tags', [
                'content_id' => $content->id,
                'tag_id' => $tag->id,
            ]);
        }
    }

    public function test_assign_tags_is_idempotent(): void
    {
        $content = Content::factory()->create(['tenant_id' => $this->tenant->id]);
        $tag = Tag::factory()->create(['tenant_id' => $this->tenant->id]);
        $content->tags()->attach($tag->id);

        $response = $this->withHeaders($this->authHeaders())
            ->postJson("/api/admin/content/{$content->id}/tags", [
                'tag_ids' => [$tag->id],
            ]);

        $response->assertOk();

        // Should still have only 1 record, not duplicated
        $this->assertEquals(1, $content->tags()->count());
    }

    public function test_assign_tags_requires_valid_tag_ids(): void
    {
        $content = Content::factory()->create(['tenant_id' => $this->tenant->id]);

        $response = $this->withHeaders($this->authHeaders())
            ->postJson("/api/admin/content/{$content->id}/tags", [
                'tag_ids' => ['nonexistent-uuid'],
            ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['tag_ids.0']);
    }

    public function test_assign_tags_to_nonexistent_content_returns_404(): void
    {
        $tag = Tag::factory()->create(['tenant_id' => $this->tenant->id]);

        $response = $this->withHeaders($this->authHeaders())
            ->postJson('/api/admin/content/nonexistent-uuid/tags', [
                'tag_ids' => [$tag->id],
            ]);

        $response->assertNotFound();
    }

    public function test_can_remove_tag_from_content(): void
    {
        $content = Content::factory()->create(['tenant_id' => $this->tenant->id]);
        $tag = Tag::factory()->create(['tenant_id' => $this->tenant->id]);
        $content->tags()->attach($tag->id);

        $response = $this->withHeaders($this->authHeaders())
            ->deleteJson("/api/admin/content/{$content->id}/tags/{$tag->id}");

        $response->assertOk()
            ->assertJsonPath('message', 'Tag removido exitosamente.');

        $this->assertDatabaseMissing('content_tags', [
            'content_id' => $content->id,
            'tag_id' => $tag->id,
        ]);
    }

    public function test_remove_tag_from_nonexistent_content_returns_404(): void
    {
        $tag = Tag::factory()->create(['tenant_id' => $this->tenant->id]);

        $response = $this->withHeaders($this->authHeaders())
            ->deleteJson("/api/admin/content/nonexistent-uuid/tags/{$tag->id}");

        $response->assertNotFound();
    }

    public function test_remove_nonexistent_tag_from_content_returns_404(): void
    {
        $content = Content::factory()->create(['tenant_id' => $this->tenant->id]);

        $response = $this->withHeaders($this->authHeaders())
            ->deleteJson("/api/admin/content/{$content->id}/tags/nonexistent-uuid");

        $response->assertNotFound();
    }

    // --- AUTH ---

    public function test_unauthenticated_user_cannot_access_tags(): void
    {
        $response = $this->getJson('/api/admin/tags');

        $response->assertUnauthorized();
    }
}
