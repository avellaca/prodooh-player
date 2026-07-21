<?php

namespace Tests\Feature;

use App\Models\Content;
use App\Models\Tag;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ContentBulkUploadTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $tenantAdmin;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');

        $this->tenant = Tenant::factory()->create();
        $this->tenantAdmin = User::factory()->tenantAdmin()->create([
            'tenant_id' => $this->tenant->id,
        ]);
    }

    private function actingAsTenantAdmin(): self
    {
        return $this->actingAs($this->tenantAdmin, 'sanctum');
    }

    // ─── BULK UPLOAD (POST /api/admin/content/bulk) ─────────────────────

    public function test_bulk_upload_single_file_returns_207(): void
    {
        $file = UploadedFile::fake()->image('photo.jpg', 1920, 1080);

        $response = $this->actingAsTenantAdmin()
            ->postJson('/api/admin/content/bulk', [
                'files' => [$file],
            ]);

        $response->assertStatus(207)
            ->assertJsonStructure([
                'successes' => [
                    '*' => ['index', 'data' => ['id', 'filename', 'mime_type', 'width', 'height', 'file_size_bytes', 'checksum_sha256']],
                ],
                'failures',
                'summary' => ['total', 'successful', 'failed'],
            ])
            ->assertJson([
                'summary' => ['total' => 1, 'successful' => 1, 'failed' => 0],
            ]);

        $this->assertDatabaseHas('content', [
            'tenant_id' => $this->tenant->id,
            'filename' => 'photo.jpg',
        ]);
    }

    public function test_bulk_upload_multiple_files(): void
    {
        $files = [
            UploadedFile::fake()->image('photo1.jpg', 1920, 1080),
            UploadedFile::fake()->image('photo2.png', 800, 600),
            UploadedFile::fake()->image('photo3.jpg', 1080, 1920),
        ];

        $response = $this->actingAsTenantAdmin()
            ->postJson('/api/admin/content/bulk', [
                'files' => $files,
            ]);

        $response->assertStatus(207)
            ->assertJson([
                'summary' => ['total' => 3, 'successful' => 3, 'failed' => 0],
            ]);

        $this->assertDatabaseCount('content', 3);
    }

    public function test_bulk_upload_with_tags(): void
    {
        $tag1 = Tag::create(['tenant_id' => $this->tenant->id, 'name' => 'Campaign A']);
        $tag2 = Tag::create(['tenant_id' => $this->tenant->id, 'name' => 'Q4']);

        $files = [
            UploadedFile::fake()->image('photo1.jpg', 1920, 1080),
            UploadedFile::fake()->image('photo2.jpg', 1920, 1080),
        ];

        $response = $this->actingAsTenantAdmin()
            ->postJson('/api/admin/content/bulk', [
                'files' => $files,
                'tag_ids' => [$tag1->id, $tag2->id],
            ]);

        $response->assertStatus(207)
            ->assertJson([
                'summary' => ['total' => 2, 'successful' => 2, 'failed' => 0],
            ]);

        // Verify tags were associated with both uploaded files
        $contents = Content::all();
        foreach ($contents as $content) {
            $this->assertCount(2, $content->tags);
            $this->assertTrue($content->tags->contains($tag1));
            $this->assertTrue($content->tags->contains($tag2));
        }
    }

    public function test_bulk_upload_partial_failure_reports_both(): void
    {
        $files = [
            UploadedFile::fake()->image('good.jpg', 1920, 1080),
            UploadedFile::fake()->create('bad.pdf', 100, 'application/pdf'),
        ];

        $response = $this->actingAsTenantAdmin()
            ->postJson('/api/admin/content/bulk', [
                'files' => $files,
            ]);

        $response->assertStatus(207)
            ->assertJson([
                'summary' => ['total' => 2, 'successful' => 1, 'failed' => 1],
            ]);

        // Verify good file was saved
        $this->assertDatabaseHas('content', ['filename' => 'good.jpg']);
        // Verify bad file was not saved
        $this->assertDatabaseMissing('content', ['filename' => 'bad.pdf']);

        // Verify the failure entry has filename and errors
        $failures = $response->json('failures');
        $this->assertCount(1, $failures);
        $this->assertEquals('bad.pdf', $failures[0]['filename']);
        $this->assertNotEmpty($failures[0]['errors']);
    }

    public function test_bulk_upload_rejects_more_than_50_files(): void
    {
        $files = [];
        for ($i = 0; $i < 51; $i++) {
            $files[] = UploadedFile::fake()->image("photo{$i}.jpg", 640, 480);
        }

        $response = $this->actingAsTenantAdmin()
            ->postJson('/api/admin/content/bulk', [
                'files' => $files,
            ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['files']);
    }

    public function test_bulk_upload_rejects_empty_files_array(): void
    {
        $response = $this->actingAsTenantAdmin()
            ->postJson('/api/admin/content/bulk', [
                'files' => [],
            ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['files']);
    }

    public function test_bulk_upload_rejects_invalid_tag_ids(): void
    {
        $file = UploadedFile::fake()->image('photo.jpg', 1920, 1080);

        $response = $this->actingAsTenantAdmin()
            ->postJson('/api/admin/content/bulk', [
                'files' => [$file],
                'tag_ids' => ['00000000-0000-0000-0000-000000000099'],
            ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['tag_ids.0']);
    }

    public function test_bulk_upload_rejects_tags_from_other_tenant(): void
    {
        $otherTenant = Tenant::factory()->create();
        $otherTag = Tag::create(['tenant_id' => $otherTenant->id, 'name' => 'Other Tag']);

        $file = UploadedFile::fake()->image('photo.jpg', 1920, 1080);

        $response = $this->actingAsTenantAdmin()
            ->postJson('/api/admin/content/bulk', [
                'files' => [$file],
                'tag_ids' => [$otherTag->id],
            ]);

        $response->assertStatus(422);
    }

    public function test_bulk_upload_persists_metadata(): void
    {
        $file = UploadedFile::fake()->image('metadata_test.jpg', 1920, 1080);

        $response = $this->actingAsTenantAdmin()
            ->postJson('/api/admin/content/bulk', [
                'files' => [$file],
            ]);

        $response->assertStatus(207);

        $content = Content::first();
        $this->assertEquals('metadata_test.jpg', $content->filename);
        $this->assertEquals('image/jpeg', $content->mime_type);
        $this->assertEquals(1920, $content->width);
        $this->assertEquals(1080, $content->height);
        $this->assertNotNull($content->file_size_bytes);
        $this->assertNotNull($content->checksum_sha256);
        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/', $content->checksum_sha256);
        $this->assertNull($content->duration_seconds); // Not a video
    }

    public function test_bulk_upload_super_admin_requires_tenant_id(): void
    {
        $superAdmin = User::factory()->superAdmin()->create();
        $file = UploadedFile::fake()->image('photo.jpg', 1920, 1080);

        $response = $this->actingAs($superAdmin, 'sanctum')
            ->postJson('/api/admin/content/bulk', [
                'files' => [$file],
            ]);

        $response->assertStatus(422);
    }

    public function test_bulk_upload_super_admin_with_tenant_id(): void
    {
        $superAdmin = User::factory()->superAdmin()->create();
        $file = UploadedFile::fake()->image('photo.jpg', 1920, 1080);

        $response = $this->actingAs($superAdmin, 'sanctum')
            ->postJson('/api/admin/content/bulk', [
                'files' => [$file],
                'tenant_id' => $this->tenant->id,
            ]);

        $response->assertStatus(207)
            ->assertJson([
                'summary' => ['total' => 1, 'successful' => 1, 'failed' => 0],
            ]);

        $this->assertDatabaseHas('content', [
            'tenant_id' => $this->tenant->id,
            'filename' => 'photo.jpg',
        ]);
    }

    public function test_bulk_upload_successful_items_get_tags_even_with_partial_failures(): void
    {
        $tag = Tag::create(['tenant_id' => $this->tenant->id, 'name' => 'Tag1']);

        $files = [
            UploadedFile::fake()->image('good.jpg', 1920, 1080),
            UploadedFile::fake()->create('bad.pdf', 100, 'application/pdf'),
            UploadedFile::fake()->image('good2.png', 800, 600),
        ];

        $response = $this->actingAsTenantAdmin()
            ->postJson('/api/admin/content/bulk', [
                'files' => $files,
                'tag_ids' => [$tag->id],
            ]);

        $response->assertStatus(207)
            ->assertJson([
                'summary' => ['total' => 3, 'successful' => 2, 'failed' => 1],
            ]);

        // Verify successful uploads have tags
        $contents = Content::all();
        $this->assertCount(2, $contents);
        foreach ($contents as $content) {
            $this->assertCount(1, $content->tags);
            $this->assertTrue($content->tags->contains($tag));
        }
    }

    public function test_unauthenticated_user_cannot_access_bulk_upload(): void
    {
        $file = UploadedFile::fake()->image('photo.jpg', 1920, 1080);

        $this->postJson('/api/admin/content/bulk', [
            'files' => [$file],
        ])->assertUnauthorized();
    }
}
