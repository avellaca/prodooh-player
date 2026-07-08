<?php

namespace App\Services\ContentValidation;

use Illuminate\Http\UploadedFile;

class FormatValidator implements ContentValidator
{
    public const SUPPORTED_MIME_TYPES = [
        'image/jpeg',
        'image/png',
        'image/webp',
        'video/mp4',
    ];

    public function validate(UploadedFile $file): ValidationResult
    {
        $mimeType = $file->getMimeType();

        if (! in_array($mimeType, self::SUPPORTED_MIME_TYPES, true)) {
            return ValidationResult::fail(
                "Unsupported format: {$mimeType}. Supported: JPEG, PNG, WebP, MP4.",
                ['mime_type' => $mimeType]
            );
        }

        return ValidationResult::pass(['mime_type' => $mimeType]);
    }
}
