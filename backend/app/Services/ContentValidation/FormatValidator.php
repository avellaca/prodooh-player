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
        'video/quicktime',
    ];

    public function validate(UploadedFile $file): ValidationResult
    {
        $mimeType = $file->getMimeType();

        if (! in_array($mimeType, self::SUPPORTED_MIME_TYPES, true)) {
            return ValidationResult::fail(
                "Formato no soportado: {$mimeType}. Formatos permitidos: JPEG, PNG, WebP, MP4, MOV.",
                ['mime_type' => $mimeType]
            );
        }

        return ValidationResult::pass(['mime_type' => $mimeType]);
    }
}
