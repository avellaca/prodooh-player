<?php

namespace Tests\Feature;

use App\Models\Content;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ContentUploadTest extends TestCase
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

    private function actingAsSuperAdmin(): self
    {
        $user = User::factory()->superAdmin()->create();

        return $this->actingAs($user, 'sanctum');
    }

    // ─── UPLOAD (POST /api/admin/content) ───────────────────────────────

    public function test_tenant_admin_can_upload_jpeg_image(): void
    {
        $file = UploadedFile::fake()->image('photo.jpg', 1920, 1080);

        $response = $this->actingAsTenantAdmin()
            ->postJson('/api/admin/content', ['file' => $file]);

        $response->assertCreated()
            ->assertJsonStructure([
                'data' => ['id', 'tenant_id', 'filename', 'mime_type', 'storage_path', 'file_size_bytes', 'width', 'height', 'orientation', 'checksum_sha256'],
                'message',
            ])
            ->assertJson([
                'data' => [
                    'tenant_id' => $this->tenant->id,
                    'filename' => 'photo.jpg',
                    'mime_type' => 'image/jpeg',
                    'width' => 1920,
                    'height' => 1080,
                    'orientation' => 'landscape',
                ],
            ]);

        $this->assertDatabaseHas('content', [
            'tenant_id' => $this->tenant->id,
            'filename' => 'photo.jpg',
            'mime_type' => 'image/jpeg',
        ]);
    }

    public function test_tenant_admin_can_upload_png_image(): void
    {
        $file = UploadedFile::fake()->image('banner.png', 800, 600);

        $response = $this->actingAsTenantAdmin()
            ->postJson('/api/admin/content', ['file' => $file]);

        $response->assertCreated()
            ->assertJson([
                'data' => [
                    'filename' => 'banner.png',
                    'mime_type' => 'image/png',
                    'width' => 800,
                    'height' => 600,
                    'orientation' => 'landscape',
                ],
            ]);
    }

    public function test_tenant_admin_can_upload_portrait_image(): void
    {
        $file = UploadedFile::fake()->image('portrait.jpg', 1080, 1920);

        $response = $this->actingAsTenantAdmin()
            ->postJson('/api/admin/content', ['file' => $file]);

        $response->assertCreated()
            ->assertJson([
                'data' => [
                    'orientation' => 'portrait',
                    'width' => 1080,
                    'height' => 1920,
                ],
            ]);
    }

    public function test_upload_rejects_unsupported_format(): void
    {
        $file = UploadedFile::fake()->create('document.pdf', 100, 'application/pdf');

        $response = $this->actingAsTenantAdmin()
            ->postJson('/api/admin/content', ['file' => $file]);

        $response->assertUnprocessable()
            ->assertJsonStructure(['message', 'errors']);

        $this->assertDatabaseMissing('content', ['filename' => 'document.pdf']);
    }

    public function test_upload_rejects_oversized_image(): void
    {
        // Create a file that exceeds 10MB limit for images
        $file = UploadedFile::fake()->create('huge.jpg', 11000, 'image/jpeg');

        $response = $this->actingAsTenantAdmin()
            ->postJson('/api/admin/content', ['file' => $file]);

        $response->assertUnprocessable();
    }

    public function test_upload_rejects_image_below_minimum_resolution(): void
    {
        $file = UploadedFile::fake()->image('tiny.jpg', 100, 100);

        $response = $this->actingAsTenantAdmin()
            ->postJson('/api/admin/content', ['file' => $file]);

        $response->assertUnprocessable();
    }

    public function test_upload_rejects_image_above_maximum_resolution(): void
    {
        $file = UploadedFile::fake()->image('huge_res.jpg', 5000, 5000);

        $response = $this->actingAsTenantAdmin()
            ->postJson('/api/admin/content', ['file' => $file]);

        $response->assertUnprocessable();
    }

    public function test_upload_requires_file(): void
    {
        $response = $this->actingAsTenantAdmin()
            ->postJson('/api/admin/content', []);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['file']);
    }

    public function test_super_admin_must_specify_tenant_id(): void
    {
        $file = UploadedFile::fake()->image('photo.jpg', 1920, 1080);

        $response = $this->actingAsSuperAdmin()
            ->postJson('/api/admin/content', ['file' => $file]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['tenant_id']);
    }

    public function test_super_admin_can_upload_with_tenant_id(): void
    {
        $file = UploadedFile::fake()->image('photo.jpg', 1920, 1080);

        $response = $this->actingAsSuperAdmin()
            ->postJson('/api/admin/content', [
                'file' => $file,
                'tenant_id' => $this->tenant->id,
            ]);

        $response->assertCreated()
            ->assertJson([
                'data' => [
                    'tenant_id' => $this->tenant->id,
                    'filename' => 'photo.jpg',
                ],
            ]);
    }

    public function test_upload_generates_sha256_checksum(): void
    {
        $file = UploadedFile::fake()->image('check.jpg', 640, 480);

        $response = $this->actingAsTenantAdmin()
            ->postJson('/api/admin/content', ['file' => $file]);

        $response->assertCreated();

        $checksum = $response->json('data.checksum_sha256');
        $this->assertNotNull($checksum);
        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/', $checksum);
    }

    // ─── LIST (GET /api/admin/content) ──────────────────────────────────

    public function test_tenant_admin_can_list_content(): void
    {
        // Create some content records for this tenant
        Content::create([
            'tenant_id' => $this->tenant->id,
            'filename' => 'test1.jpg',
            'mime_type' => 'image/jpeg',
            'storage_path' => 'content/test1.jpg',
            'file_size_bytes' => 1024,
            'width' => 1920,
            'height' => 1080,
            'orientation' => 'landscape',
            'rotation' => 0,
            'checksum_sha256' => hash('sha256', 'test1'),
        ]);

        Content::create([
            'tenant_id' => $this->tenant->id,
            'filename' => 'test2.png',
            'mime_type' => 'image/png',
            'storage_path' => 'content/test2.png',
            'file_size_bytes' => 2048,
            'width' => 800,
            'height' => 600,
            'orientation' => 'landscape',
            'rotation' => 0,
            'checksum_sha256' => hash('sha256', 'test2'),
        ]);

        $response = $this->actingAsTenantAdmin()
            ->getJson('/api/admin/content');

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [
                    '*' => ['id', 'tenant_id', 'filename', 'mime_type', 'file_size_bytes'],
                ],
            ]);

        $this->assertCount(2, $response->json('data'));
    }

    // ─── DELETE (DELETE /api/admin/content/{id}) ─────────────────────────

    public function test_tenant_admin_can_delete_content(): void
    {
        Storage::disk('local')->put('content/test.jpg', 'fake content');

        $content = Content::create([
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
        ]);

        $response = $this->actingAsTenantAdmin()
            ->deleteJson("/api/admin/content/{$content->id}");

        $response->assertOk()
            ->assertJson(['message' => 'Content deleted successfully.']);

        $this->assertDatabaseMissing('content', ['id' => $content->id]);
        Storage::disk('local')->assertMissing('content/test.jpg');
    }

    public function test_delete_returns_404_for_nonexistent_content(): void
    {
        $response = $this->actingAsTenantAdmin()
            ->deleteJson('/api/admin/content/nonexistent-uuid');

        $response->assertNotFound();
    }

    // ─── ACCESS CONTROL ─────────────────────────────────────────────────

    public function test_unauthenticated_user_cannot_access_content_endpoints(): void
    {
        $this->getJson('/api/admin/content')->assertUnauthorized();
        $this->postJson('/api/admin/content', [])->assertUnauthorized();
        $this->deleteJson('/api/admin/content/some-id')->assertUnauthorized();
    }
}
