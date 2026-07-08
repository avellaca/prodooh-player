<?php

namespace App\Services;

use App\Models\Content;
use App\Services\ContentValidation\ContentValidationPipeline;
use App\Services\ContentValidation\ValidationResult;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class ContentLibraryService
{
    public function __construct(
        private readonly ContentValidationPipeline $pipeline,
    ) {}

    /**
     * Validate, store, and create a Content record for the uploaded file.
     *
     * @return array{content: Content, validation: ValidationResult}|array{content: null, validation: ValidationResult}
     */
    public function upload(UploadedFile $file, string $tenantId): array
    {
        $validation = $this->pipeline->validate($file);

        if (! $validation->passed) {
            return ['content' => null, 'validation' => $validation];
        }

        // Generate checksum
        $checksum = hash_file('sha256', $file->getPathname());

        // Store file in tenant-specific directory
        $filename = $file->getClientOriginalName();
        $storagePath = "content/{$tenantId}/" . Str::uuid() . '.' . $file->getClientOriginalExtension();

        Storage::disk('local')->put($storagePath, file_get_contents($file->getPathname()));

        // Detect duration for video (placeholder 0 for MVP)
        $mimeType = $file->getMimeType();
        $isVideo = str_starts_with($mimeType, 'video/');

        // Create Content record
        $content = Content::create([
            'tenant_id' => $tenantId,
            'filename' => $filename,
            'mime_type' => $mimeType,
            'storage_path' => $storagePath,
            'file_size_bytes' => $validation->metadata['file_size_bytes'],
            'width' => $validation->metadata['width'] ?? 0,
            'height' => $validation->metadata['height'] ?? 0,
            'duration_seconds' => $isVideo ? 0 : null,
            'orientation' => $validation->metadata['orientation'] ?? 'landscape',
            'rotation' => 0,
            'checksum_sha256' => $checksum,
        ]);

        return ['content' => $content, 'validation' => $validation];
    }

    /**
     * List all content (tenant-filtered via BelongsToTenant scope).
     */
    public function list(): \Illuminate\Database\Eloquent\Collection
    {
        return Content::orderBy('created_at', 'desc')->get();
    }

    /**
     * Delete a content item and its stored file.
     */
    public function delete(Content $content): void
    {
        // Remove stored file
        Storage::disk('local')->delete($content->storage_path);

        // Remove database record
        $content->delete();
    }
}
