<?php

namespace App\Console\Commands;

use App\Models\Content;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class ExtractContentDimensions extends Command
{
    /**
     * The name and signature of the console command.
     */
    protected $signature = 'content:extract-dimensions';

    /**
     * The console command description.
     */
    protected $description = 'Extract width/height from content files missing dimensions';

    /**
     * Image MIME types supported for dimension extraction.
     */
    private const IMAGE_MIME_TYPES = [
        'image/jpeg',
        'image/png',
        'image/webp',
    ];

    /**
     * Video MIME types supported for dimension extraction.
     */
    private const VIDEO_MIME_TYPES = [
        'video/mp4',
        'video/webm',
    ];

    /**
     * Execute the console command.
     */
    public function handle(): int
    {
        $contents = Content::whereNull('width')
            ->orWhere('width', 0)
            ->get();

        if ($contents->isEmpty()) {
            $this->info('No content files with missing dimensions found.');

            return self::SUCCESS;
        }

        $this->info("Found {$contents->count()} content file(s) with missing dimensions.");

        $processed = 0;
        $failed = 0;

        $bar = $this->output->createProgressBar($contents->count());
        $bar->start();

        foreach ($contents as $content) {
            try {
                [$width, $height] = $this->extractDimensions($content);
                $content->update(['width' => $width, 'height' => $height]);
                $processed++;
            } catch (\Exception $e) {
                $failed++;
                $this->newLine();
                $this->warn("Failed: {$content->filename} - {$e->getMessage()}");
                Log::warning("content:extract-dimensions failed for {$content->id}", [
                    'filename' => $content->filename,
                    'error' => $e->getMessage(),
                ]);
            }

            $bar->advance();
        }

        $bar->finish();
        $this->newLine(2);

        $this->info("Processed: {$processed}, Failed: {$failed}, Total: {$contents->count()}");

        return self::SUCCESS;
    }

    /**
     * Extract dimensions from a content file based on its MIME type.
     *
     * @return array{0: int, 1: int} [width, height]
     *
     * @throws \RuntimeException If extraction fails or file type is unsupported
     */
    private function extractDimensions(Content $content): array
    {
        $mimeType = $content->mime_type;

        if (in_array($mimeType, self::IMAGE_MIME_TYPES, true)) {
            return $this->extractImageDimensions($content);
        }

        if (in_array($mimeType, self::VIDEO_MIME_TYPES, true)) {
            return $this->extractVideoDimensions($content);
        }

        throw new \RuntimeException("Unsupported MIME type: {$mimeType}");
    }

    /**
     * Extract dimensions from an image file using GD (getimagesize).
     *
     * @return array{0: int, 1: int} [width, height]
     *
     * @throws \RuntimeException If the image cannot be read
     */
    private function extractImageDimensions(Content $content): array
    {
        $path = $this->getAbsolutePath($content);

        if (! file_exists($path)) {
            throw new \RuntimeException("File not found: {$content->storage_path}");
        }

        $dimensions = @getimagesize($path);

        if ($dimensions === false) {
            throw new \RuntimeException("Could not read image dimensions: {$content->filename}");
        }

        return [$dimensions[0], $dimensions[1]];
    }

    /**
     * Extract dimensions from a video file using FFProbe.
     *
     * @return array{0: int, 1: int} [width, height]
     *
     * @throws \RuntimeException If FFProbe is not available or fails
     */
    private function extractVideoDimensions(Content $content): array
    {
        $path = $this->getAbsolutePath($content);

        if (! file_exists($path)) {
            throw new \RuntimeException("File not found: {$content->storage_path}");
        }

        $escapedPath = escapeshellarg($path);
        $command = "ffprobe -v quiet -print_format json -show_streams {$escapedPath}";

        $output = shell_exec($command);

        if ($output === null) {
            throw new \RuntimeException('FFProbe command failed or is not installed');
        }

        $data = json_decode($output, true);

        if (! is_array($data) || empty($data['streams'])) {
            throw new \RuntimeException("FFProbe returned no stream data for: {$content->filename}");
        }

        // Find the video stream
        foreach ($data['streams'] as $stream) {
            if (($stream['codec_type'] ?? '') === 'video') {
                $width = (int) ($stream['width'] ?? 0);
                $height = (int) ($stream['height'] ?? 0);

                if ($width > 0 && $height > 0) {
                    return [$width, $height];
                }
            }
        }

        throw new \RuntimeException("No video stream with dimensions found in: {$content->filename}");
    }

    /**
     * Get the absolute file system path for a content item.
     */
    private function getAbsolutePath(Content $content): string
    {
        return Storage::disk('local')->path($content->storage_path);
    }
}
