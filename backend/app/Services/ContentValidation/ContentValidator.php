<?php

namespace App\Services\ContentValidation;

use Illuminate\Http\UploadedFile;

interface ContentValidator
{
    /**
     * Validate an uploaded file and return the result.
     */
    public function validate(UploadedFile $file): ValidationResult;
}
