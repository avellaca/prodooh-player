<?php

namespace App\Services;

use App\Models\Content;
use App\Services\ContentValidation\ContentValidationPipeline;
use App\Services\ContentValidation\ValidationResult;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;

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

        // Detect duration for video
        $mimeType = $file->getMimeType();
        $isVideo = str_starts_with($mimeType, 'video/');
        $durationSeconds = $isVideo ? $this->extractVideoDuration($file) : null;

        // Extract dimensions — store null if extraction failed (does not block upload)
        $width = $validation->metadata['width'] ?? null;
        $height = $validation->metadata['height'] ?? null;

        if ($width === null || $height === null) {
            Log::warning('Content uploaded without dimensions — extraction failed or unavailable', [
                'filename' => $filename,
                'mime_type' => $mimeType,
                'tenant_id' => $tenantId,
            ]);
        }

        // Create Content record
        $content = Content::create([
            'tenant_id' => $tenantId,
            'filename' => $filename,
            'mime_type' => $mimeType,
            'storage_path' => $storagePath,
            'file_size_bytes' => $validation->metadata['file_size_bytes'],
            'width' => $width,
            'height' => $height,
            'duration_seconds' => $durationSeconds,
            'orientation' => $validation->metadata['orientation'] ?? 'landscape',
            'rotation' => 0,
            'checksum_sha256' => $checksum,
        ]);

        return ['content' => $content, 'validation' => $validation];
    }

    /**
     * Extract video duration in seconds using FFProbe.
     * Returns null if extraction fails (does not block upload).
     */
    public function extractVideoDuration(UploadedFile $file): ?float
    {
        try {
            $ffprobePath = $this->findFfprobe();

            if ($ffprobePath === null) {
                Log::warning('FFProbe not available for video duration extraction', [
                    'filename' => $file->getClientOriginalName(),
                ]);

                return null;
            }

            $process = new Process([
                $ffprobePath,
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'csv=p=0',
                $file->getPathname(),
            ]);

            $process->setTimeout(30);
            $process->run();

            if (! $process->isSuccessful()) {
                Log::warning('FFProbe failed to extract video duration', [
                    'filename' => $file->getClientOriginalName(),
                    'error' => $process->getErrorOutput(),
                ]);

                return null;
            }

            $output = trim($process->getOutput());

            if (empty($output) || ! is_numeric($output)) {
                Log::warning('FFProbe returned unexpected output for video duration', [
                    'filename' => $file->getClientOriginalName(),
                    'output' => $output,
                ]);

                return null;
            }

            $duration = (float) $output;

            return $duration > 0 ? round($duration, 2) : null;
        } catch (\Throwable $e) {
            Log::warning('Exception during video duration extraction', [
                'filename' => $file->getClientOriginalName(),
                'exception' => $e->getMessage(),
            ]);

            return null;
        }
    }

    /**
     * Locate the ffprobe binary on the system.
     */
    private function findFfprobe(): ?string
    {
        $configPath = config('media.ffprobe_path');
        if ($configPath && file_exists($configPath)) {
            return $configPath;
        }

        $commonPaths = [
            '/usr/bin/ffprobe',
            '/usr/local/bin/ffprobe',
            '/opt/homebrew/bin/ffprobe',
        ];

        foreach ($commonPaths as $path) {
            if (file_exists($path)) {
                return $path;
            }
        }

        $process = new Process(['which', 'ffprobe']);
        $process->run();

        if ($process->isSuccessful()) {
            $path = trim($process->getOutput());
            if (! empty($path) && file_exists($path)) {
                return $path;
            }
        }

        return null;
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
