<?php

namespace App\Services\ContentValidation;

class ValidationResult
{
    /**
     * @param  array<string>  $errors
     * @param  array<string, mixed>  $metadata
     */
    public function __construct(
        public readonly bool $passed,
        public readonly array $errors = [],
        public readonly array $metadata = [],
    ) {}

    public static function pass(array $metadata = []): self
    {
        return new self(passed: true, metadata: $metadata);
    }

    public static function fail(string|array $errors, array $metadata = []): self
    {
        $errors = is_array($errors) ? $errors : [$errors];

        return new self(passed: false, errors: $errors, metadata: $metadata);
    }

    public function merge(self $other): self
    {
        return new self(
            passed: $this->passed && $other->passed,
            errors: array_merge($this->errors, $other->errors),
            metadata: array_merge($this->metadata, $other->metadata),
        );
    }
}
