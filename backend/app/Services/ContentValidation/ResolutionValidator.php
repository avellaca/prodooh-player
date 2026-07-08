<?php

namespace App\Services\ContentValidation;

use Illuminate\Http\UploadedFile;

class ResolutionValidator implements ContentValidator
{
    public const MAX_WIDTH = 3840;

    public const MAX_HEIGHT = 2160;

    public const MIN_WIDTH = 320;

    public const MIN_HEIGHT = 240;

    public function validate(UploadedFile $file): ValidationResult
    {
        $mimeType = $file->getMimeType();

        // For video files, skip resolution validation (store as 0x0 for MVP)
        if (str_starts_with($mimeType, 'video/')) {
            return ValidationResult::pass(['width' => 0, 'height' => 0]);
        }

        // For images, detect dimensions
        $dimensions = @getimagesize($file->getPathname());

        if ($dimensions === false) {
            return ValidationResult::fail(
                'Unable to determine image dimensions.',
                ['width' => 0, 'height' => 0]
            );
        }

        [$width, $height] = $dimensions;

        $errors = [];

        if ($width < self::MIN_WIDTH || $height < self::MIN_HEIGHT) {
            $errors[] = "Resolution too small ({$width}x{$height}). Minimum: " . self::MIN_WIDTH . 'x' . self::MIN_HEIGHT . '.';
        }

        if ($width > self::MAX_WIDTH || $height > self::MAX_HEIGHT) {
            $errors[] = "Resolution too large ({$width}x{$height}). Maximum: " . self::MAX_WIDTH . 'x' . self::MAX_HEIGHT . '.';
        }

        if (! empty($errors)) {
            return ValidationResult::fail($errors, ['width' => $width, 'height' => $height]);
        }

        return ValidationResult::pass(['width' => $width, 'height' => $height]);
    }
}
