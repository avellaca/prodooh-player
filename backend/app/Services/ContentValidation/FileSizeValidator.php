<?php

namespace App\Services\ContentValidation;

use Illuminate\Http\UploadedFile;

/**
 * Extracts file size as metadata.
 * No longer rejects based on size — the upload limit is handled
 * by PHP/nginx configuration (upload_max_filesize, post_max_size).
 */
class FileSizeValidator implements ContentValidator
{
    public function validate(UploadedFile $file): ValidationResult
    {
        $fileSize = $file->getSize();

        return ValidationResult::pass(['file_size_bytes' => $fileSize]);
    }
}
