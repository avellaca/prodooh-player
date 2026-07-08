<?php

namespace App\Services\ContentValidation;

use Illuminate\Http\UploadedFile;

class FileSizeValidator implements ContentValidator
{
    public const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

    public const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

    public function validate(UploadedFile $file): ValidationResult
    {
        $mimeType = $file->getMimeType();
        $fileSize = $file->getSize();

        $isVideo = str_starts_with($mimeType, 'video/');
        $maxSize = $isVideo ? self::MAX_VIDEO_SIZE_BYTES : self::MAX_IMAGE_SIZE_BYTES;
        $maxLabel = $isVideo ? '50MB' : '10MB';

        if ($fileSize > $maxSize) {
            $actualMb = round($fileSize / (1024 * 1024), 2);

            return ValidationResult::fail(
                "File size ({$actualMb}MB) exceeds maximum allowed ({$maxLabel}).",
                ['file_size_bytes' => $fileSize, 'max_bytes' => $maxSize]
            );
        }

        return ValidationResult::pass(['file_size_bytes' => $fileSize]);
    }
}
