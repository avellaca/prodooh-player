<?php

namespace App\Services\ContentValidation;

use Illuminate\Http\UploadedFile;

class OrientationValidator implements ContentValidator
{
    public function validate(UploadedFile $file): ValidationResult
    {
        $mimeType = $file->getMimeType();

        // For video files, default to landscape for MVP
        if (str_starts_with($mimeType, 'video/')) {
            return ValidationResult::pass(['orientation' => 'landscape']);
        }

        // For images, detect orientation from dimensions
        $dimensions = @getimagesize($file->getPathname());

        if ($dimensions === false) {
            return ValidationResult::pass(['orientation' => 'landscape']);
        }

        [$width, $height] = $dimensions;

        $orientation = $width >= $height ? 'landscape' : 'portrait';

        return ValidationResult::pass(['orientation' => $orientation]);
    }
}
