<?php

namespace App\Services\ContentValidation;

use Illuminate\Http\UploadedFile;

class ContentValidationPipeline
{
    /** @var ContentValidator[] */
    private array $validators;

    public function __construct(
        FormatValidator $formatValidator,
        CodecValidator $codecValidator,
        ResolutionValidator $resolutionValidator,
        FileSizeValidator $fileSizeValidator,
        OrientationValidator $orientationValidator,
    ) {
        $this->validators = [
            $formatValidator,
            $codecValidator,
            $resolutionValidator,
            $fileSizeValidator,
            $orientationValidator,
        ];
    }

    /**
     * Run all validators in sequence and return the combined result.
     * Stops on first failure in format/codec (early exit for invalid files).
     */
    public function validate(UploadedFile $file): ValidationResult
    {
        $combined = ValidationResult::pass();

        foreach ($this->validators as $validator) {
            $result = $validator->validate($file);
            $combined = $combined->merge($result);

            // Early exit: if format or codec fails, no point checking further
            if (! $result->passed && ($validator instanceof FormatValidator || $validator instanceof CodecValidator)) {
                return $combined;
            }
        }

        return $combined;
    }
}
