<?php

namespace Tests\Feature;

use App\Models\Content;
use App\Models\Tenant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ExtractContentDimensionsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    public function test_reports_no_files_when_all_have_dimensions(): void
    {
        $tenant = Tenant::factory()->create();
        Content::factory()->create([
            'tenant_id' => $tenant->id,
            'width' => 1920,
            'height' => 1080,
        ]);

        $this->artisan('content:extract-dimensions')
            ->expectsOutputToContain('No content files with missing dimensions found.')
            ->assertSuccessful();
    }

    public function test_finds_content_with_null_width(): void
    {
        $tenant = Tenant::factory()->create();
        Content::factory()->create([
            'tenant_id' => $tenant->id,
            'width' => null,
            'height' => null,
            'mime_type' => 'image/jpeg',
            'filename' => 'test.jpg',
            'storage_path' => 'content/test.jpg',
        ]);

        // File doesn't exist, so extraction will fail gracefully
        $this->artisan('content:extract-dimensions')
            ->expectsOutputToContain('Found 1 content file(s) with missing dimensions.')
            ->expectsOutputToContain('Processed: 0, Failed: 1, Total: 1')
            ->assertSuccessful();
    }

    public function test_finds_content_with_zero_width(): void
    {
        $tenant = Tenant::factory()->create();
        Content::factory()->create([
            'tenant_id' => $tenant->id,
            'width' => 0,
            'height' => 0,
            'mime_type' => 'video/mp4',
            'filename' => 'video.mp4',
            'storage_path' => 'content/video.mp4',
        ]);

        $this->artisan('content:extract-dimensions')
            ->expectsOutputToContain('Found 1 content file(s) with missing dimensions.')
            ->assertSuccessful();
    }

    public function test_extracts_image_dimensions_from_jpeg(): void
    {
        $tenant = Tenant::factory()->create();

        // Create a real 100x50 JPEG image
        $img = imagecreatetruecolor(100, 50);
        $tempPath = tempnam(sys_get_temp_dir(), 'test_img');
        imagejpeg($img, $tempPath);
        imagedestroy($img);

        $storagePath = 'content/test-image.jpg';
        Storage::disk('local')->put($storagePath, file_get_contents($tempPath));
        unlink($tempPath);

        $content = Content::factory()->create([
            'tenant_id' => $tenant->id,
            'width' => null,
            'height' => null,
            'mime_type' => 'image/jpeg',
            'filename' => 'test-image.jpg',
            'storage_path' => $storagePath,
        ]);

        $this->artisan('content:extract-dimensions')
            ->expectsOutputToContain('Processed: 1, Failed: 0, Total: 1')
            ->assertSuccessful();

        $content->refresh();
        $this->assertEquals(100, $content->width);
        $this->assertEquals(50, $content->height);
    }

    public function test_extracts_image_dimensions_from_png(): void
    {
        $tenant = Tenant::factory()->create();

        // Create a real 200x150 PNG image
        $img = imagecreatetruecolor(200, 150);
        $tempPath = tempnam(sys_get_temp_dir(), 'test_png');
        imagepng($img, $tempPath);
        imagedestroy($img);

        $storagePath = 'content/test-image.png';
        Storage::disk('local')->put($storagePath, file_get_contents($tempPath));
        unlink($tempPath);

        $content = Content::factory()->create([
            'tenant_id' => $tenant->id,
            'width' => 0,
            'height' => 0,
            'mime_type' => 'image/png',
            'filename' => 'test-image.png',
            'storage_path' => $storagePath,
        ]);

        $this->artisan('content:extract-dimensions')
            ->expectsOutputToContain('Processed: 1, Failed: 0, Total: 1')
            ->assertSuccessful();

        $content->refresh();
        $this->assertEquals(200, $content->width);
        $this->assertEquals(150, $content->height);
    }

    public function test_gracefully_handles_missing_file(): void
    {
        $tenant = Tenant::factory()->create();
        Content::factory()->create([
            'tenant_id' => $tenant->id,
            'width' => null,
            'height' => null,
            'mime_type' => 'image/jpeg',
            'filename' => 'missing.jpg',
            'storage_path' => 'content/nonexistent.jpg',
        ]);

        $this->artisan('content:extract-dimensions')
            ->expectsOutputToContain('Failed: missing.jpg')
            ->expectsOutputToContain('Processed: 0, Failed: 1, Total: 1')
            ->assertSuccessful();
    }

    public function test_gracefully_handles_unsupported_mime_type(): void
    {
        $tenant = Tenant::factory()->create();
        Content::factory()->create([
            'tenant_id' => $tenant->id,
            'width' => null,
            'height' => null,
            'mime_type' => 'application/pdf',
            'filename' => 'document.pdf',
            'storage_path' => 'content/document.pdf',
        ]);

        $this->artisan('content:extract-dimensions')
            ->expectsOutputToContain('Failed: document.pdf')
            ->expectsOutputToContain('Processed: 0, Failed: 1, Total: 1')
            ->assertSuccessful();
    }

    public function test_processes_multiple_files_reporting_combined_stats(): void
    {
        $tenant = Tenant::factory()->create();

        // Create a real image
        $img = imagecreatetruecolor(320, 240);
        $tempPath = tempnam(sys_get_temp_dir(), 'test_multi');
        imagejpeg($img, $tempPath);
        imagedestroy($img);

        $storagePath = 'content/real-image.jpg';
        Storage::disk('local')->put($storagePath, file_get_contents($tempPath));
        unlink($tempPath);

        // One that will succeed
        Content::factory()->create([
            'tenant_id' => $tenant->id,
            'width' => null,
            'height' => null,
            'mime_type' => 'image/jpeg',
            'filename' => 'real-image.jpg',
            'storage_path' => $storagePath,
        ]);

        // One that will fail (missing file)
        Content::factory()->create([
            'tenant_id' => $tenant->id,
            'width' => null,
            'height' => null,
            'mime_type' => 'image/png',
            'filename' => 'missing.png',
            'storage_path' => 'content/missing.png',
        ]);

        $this->artisan('content:extract-dimensions')
            ->expectsOutputToContain('Found 2 content file(s) with missing dimensions.')
            ->expectsOutputToContain('Processed: 1, Failed: 1, Total: 2')
            ->assertSuccessful();
    }

    public function test_skips_content_with_valid_dimensions(): void
    {
        $tenant = Tenant::factory()->create();

        // Content with valid dimensions — should be skipped
        Content::factory()->create([
            'tenant_id' => $tenant->id,
            'width' => 1920,
            'height' => 1080,
            'mime_type' => 'image/jpeg',
            'filename' => 'existing.jpg',
        ]);

        // Content with null dimensions — should be processed
        Content::factory()->create([
            'tenant_id' => $tenant->id,
            'width' => null,
            'height' => null,
            'mime_type' => 'application/pdf',
            'filename' => 'no-dims.pdf',
            'storage_path' => 'content/no-dims.pdf',
        ]);

        $this->artisan('content:extract-dimensions')
            ->expectsOutputToContain('Found 1 content file(s) with missing dimensions.')
            ->assertSuccessful();
    }
}
