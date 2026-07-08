<?php

namespace App\Services\ContentValidation;

use Illuminate\Http\UploadedFile;

/**
 * For MVP: validates codec by checking mime type.
 * Full codec inspection (ffprobe) can be added later.
 */
class CodecValidator implements ContentValidator
{
    /**
     * Supported codecs by mime type.
     * For images, codec is implicit from format.
     * For video, H.264 and H.265 are supported (verified via mime type for MVP).
     */
    public const SUPPORTED_VIDEO_CODECS = ['h264', 'h265', 'hevc'];

    public function validate(UploadedFile $file): ValidationResult
    {
        $mimeType = $file->getMimeType();

        // Images: codec is implicit from format (JPEG, PNG, WebP)
        if (str_starts_with($mimeType, 'image/')) {
            return ValidationResult::pass(['codec' => $mimeType]);
        }

        // Video: for MVP, accept video/mp4 as H.264/H.265 compatible
        if ($mimeType === 'video/mp4') {
            return ValidationResult::pass(['codec' => 'h264/h265 (assumed from mp4 container)']);
        }

        return ValidationResult::fail(
            "Unsupported video codec. Only H.264 and H.265 in MP4 container are supported.",
            ['mime_type' => $mimeType]
        );
    }
}
