<?php

namespace App\Services\ContentValidation;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Log;
use Symfony\Component\Process\Process;

/**
 * Extracts media dimensions as metadata.
 * No longer rejects based on resolution — that validation happens
 * when assigning a creative to a specific screen.
 *
 * For images: uses PHP's getimagesize().
 * For videos: uses FFProbe to extract dimensions from the video stream.
 * If extraction fails, stores null and logs a warning (does not block upload).
 */
class ResolutionValidator implements ContentValidator
{
    public const MAX_WIDTH = 3840;

    public const MAX_HEIGHT = 2160;

    public const MIN_WIDTH = 320;

    public const MIN_HEIGHT = 240;

    public function validate(UploadedFile $file): ValidationResult
    {
        $mimeType = $file->getMimeType();

        if (str_starts_with($mimeType, 'video/')) {
            return $this->extractVideoDimensions($file);
        }

        return $this->extractImageDimensions($file);
    }

    /**
     * Extract dimensions from image files using getimagesize().
     */
    private function extractImageDimensions(UploadedFile $file): ValidationResult
    {
        $dimensions = @getimagesize($file->getPathname());

        if ($dimensions === false) {
            Log::warning('Failed to extract image dimensions', [
                'filename' => $file->getClientOriginalName(),
                'mime_type' => $file->getMimeType(),
            ]);

            return ValidationResult::pass(['width' => null, 'height' => null]);
        }

        [$width, $height] = $dimensions;

        return ValidationResult::pass(['width' => $width, 'height' => $height]);
    }

    /**
     * Extract dimensions from video files using FFProbe.
     */
    private function extractVideoDimensions(UploadedFile $file): ValidationResult
    {
        try {
            $ffprobePath = $this->findFfprobe();

            if ($ffprobePath === null) {
                Log::warning('FFProbe not available for video dimension extraction', [
                    'filename' => $file->getClientOriginalName(),
                ]);

                return ValidationResult::pass(['width' => null, 'height' => null]);
            }

            $process = new Process([
                $ffprobePath,
                '-v', 'error',
                '-select_streams', 'v:0',
                '-show_entries', 'stream=width,height',
                '-of', 'csv=p=0:s=x',
                $file->getPathname(),
            ]);

            $process->setTimeout(30);
            $process->run();

            if (!$process->isSuccessful()) {
                Log::warning('FFProbe failed to extract video dimensions', [
                    'filename' => $file->getClientOriginalName(),
                    'error' => $process->getErrorOutput(),
                ]);

                return ValidationResult::pass(['width' => null, 'height' => null]);
            }

            $output = trim($process->getOutput());

            if (empty($output) || !str_contains($output, 'x')) {
                Log::warning('FFProbe returned unexpected output for video dimensions', [
                    'filename' => $file->getClientOriginalName(),
                    'output' => $output,
                ]);

                return ValidationResult::pass(['width' => null, 'height' => null]);
            }

            [$width, $height] = array_map('intval', explode('x', $output));

            if ($width <= 0 || $height <= 0) {
                Log::warning('FFProbe returned invalid dimensions for video', [
                    'filename' => $file->getClientOriginalName(),
                    'width' => $width,
                    'height' => $height,
                ]);

                return ValidationResult::pass(['width' => null, 'height' => null]);
            }

            return ValidationResult::pass(['width' => $width, 'height' => $height]);
        } catch (\Throwable $e) {
            Log::warning('Exception during video dimension extraction', [
                'filename' => $file->getClientOriginalName(),
                'exception' => $e->getMessage(),
            ]);

            return ValidationResult::pass(['width' => null, 'height' => null]);
        }
    }

    /**
     * Locate the ffprobe binary on the system.
     */
    private function findFfprobe(): ?string
    {
        // Check config first
        $configPath = config('media.ffprobe_path');
        if ($configPath && file_exists($configPath)) {
            return $configPath;
        }

        // Try common locations
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

        // Try which command
        $process = new Process(['which', 'ffprobe']);
        $process->run();

        if ($process->isSuccessful()) {
            $path = trim($process->getOutput());
            if (!empty($path) && file_exists($path)) {
                return $path;
            }
        }

        return null;
    }
}
