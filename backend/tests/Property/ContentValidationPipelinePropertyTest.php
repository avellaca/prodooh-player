<?php

namespace Tests\Property;

use App\Services\ContentValidation\CodecValidator;
use App\Services\ContentValidation\ContentValidationPipeline;
use App\Services\ContentValidation\FileSizeValidator;
use App\Services\ContentValidation\FormatValidator;
use App\Services\ContentValidation\OrientationValidator;
use App\Services\ContentValidation\ResolutionValidator;
use Eris\Generators;
use Eris\TestTrait;
use Illuminate\Http\UploadedFile;
use PHPUnit\Framework\TestCase;

/**
 * Property 22: Content Validation Pipeline
 *
 * Generate random file metadata combinations; verify acceptance iff all criteria met.
 *
 * **Validates: Requirements 21.1, 21.2, 21.3, 21.4, 21.5**
 */
class ContentValidationPipelinePropertyTest extends TestCase
{
    use TestTrait;

    private ContentValidationPipeline $pipeline;

    protected function setUp(): void
    {
        parent::setUp();
        $this->pipeline = new ContentValidationPipeline(
            new FormatValidator(),
            new CodecValidator(),
            new ResolutionValidator(),
            new FileSizeValidator(),
            new OrientationValidator(),
        );
    }

    /**
     * Property: The pipeline accepts an image file if and only if ALL criteria are met:
     * - Format is a supported image type (Req 21.1)
     * - Resolution is within bounds 320x240 to 3840x2160 (Req 21.3)
     * - File size ≤ 10MB (Req 21.4)
     * - Orientation is detected correctly (Req 21.5)
     *
     * We generate real image files with random dimensions to test the full pipeline.
     * The biconditional is: passes iff resolution in bounds AND size within limit.
     * (Format is always valid since we create real JPEG/PNG/WebP images,
     * and codec is implicit for images.)
     *
     * **Validates: Requirements 21.1, 21.2, 21.3, 21.4, 21.5**
     */
    public function test_image_pipeline_accepts_iff_all_criteria_met(): void
    {
        $this->forAll(
            Generators::elements('jpeg', 'png', 'webp'),
            Generators::choose(100, 5000),   // width
            Generators::choose(100, 3000),   // height
            Generators::elements(true, false) // whether to make file exceed size limit
        )->then(function (string $format, int $width, int $height, bool $exceedSizeLimit): void {
            $validResolution = $width >= ResolutionValidator::MIN_WIDTH
                && $width <= ResolutionValidator::MAX_WIDTH
                && $height >= ResolutionValidator::MIN_HEIGHT
                && $height <= ResolutionValidator::MAX_HEIGHT;

            // Create a real image with specific dimensions
            $file = $this->createRealImage($format, $width, $height, $exceedSizeLimit);

            if ($file === null) {
                // Skip if image creation fails (memory constraints)
                return;
            }

            $actualSize = $file->getSize();
            $validSize = $actualSize <= FileSizeValidator::MAX_IMAGE_SIZE_BYTES;

            // Expected: passes iff resolution AND size are both valid
            // (Format and codec always pass for real images of supported types)
            $expectedPass = $validResolution && $validSize;

            $result = $this->pipeline->validate($file);

            $this->assertEquals(
                $expectedPass,
                $result->passed,
                sprintf(
                    "Pipeline should %s for format=%s, resolution=%dx%d, size=%d bytes. " .
                    "validResolution=%s, validSize=%s. Errors: %s",
                    $expectedPass ? 'PASS' : 'FAIL',
                    $format,
                    $width,
                    $height,
                    $actualSize,
                    $validResolution ? 'yes' : 'no',
                    $validSize ? 'yes' : 'no',
                    implode('; ', $result->errors)
                )
            );

            // Cleanup
            @unlink($file->getPathname());
        });
    }

    /**
     * Property: The pipeline accepts a video/mp4 file if and only if:
     * - File size ≤ 50MB (Req 21.4)
     *
     * For video/mp4: format passes, codec is assumed valid from mp4 container (Req 21.2),
     * resolution validation is skipped (Req 21.3), orientation defaults to landscape (Req 21.5).
     *
     * We test around the boundary: sizes from 1KB up to just above 50MB.
     * To keep memory usage reasonable, over-limit files are created as sparse
     * files just slightly above the threshold.
     *
     * **Validates: Requirements 21.1, 21.2, 21.3, 21.4, 21.5**
     */
    public function test_video_pipeline_accepts_iff_size_valid(): void
    {
        $this->forAll(
            Generators::choose(1024, 5 * 1024 * 1024), // offset: 1KB to 5MB
            Generators::elements(true, false)           // whether to exceed 50MB limit
        )->then(function (int $offset, bool $exceedLimit): void {
            if ($exceedLimit) {
                // Create sparse file just above the limit (use seek to avoid large memory allocation)
                $targetSize = FileSizeValidator::MAX_VIDEO_SIZE_BYTES + $offset;
            } else {
                // Use offset directly as file size (well within limits)
                $targetSize = $offset;
            }

            $validSize = $targetSize <= FileSizeValidator::MAX_VIDEO_SIZE_BYTES;

            $file = $this->createMp4File($targetSize);
            $result = $this->pipeline->validate($file);

            $this->assertEquals(
                $validSize,
                $result->passed,
                sprintf(
                    "Video pipeline should %s for size=%d bytes (limit=%d). Errors: %s",
                    $validSize ? 'PASS' : 'FAIL',
                    $targetSize,
                    FileSizeValidator::MAX_VIDEO_SIZE_BYTES,
                    implode('; ', $result->errors)
                )
            );

            // Cleanup
            @unlink($file->getPathname());
        });
    }

    /**
     * Property: Files with unsupported formats are always rejected regardless of
     * other metadata properties (size, dimensions).
     *
     * **Validates: Requirements 21.1**
     */
    public function test_unsupported_format_always_rejected(): void
    {
        $this->forAll(
            Generators::choose(100, 1024 * 1024) // random file size (keep small for perf)
        )->then(function (int $fileSize): void {
            // Create a file with random bytes - finfo will detect it as
            // application/octet-stream or similar non-supported type
            $tmpPath = tempnam(sys_get_temp_dir(), 'content_test_');
            $handle = fopen($tmpPath, 'wb');
            fwrite($handle, random_bytes($fileSize));
            fclose($handle);

            $file = new UploadedFile(
                path: $tmpPath,
                originalName: 'test_file.bin',
                mimeType: null,
                error: UPLOAD_ERR_OK,
                test: true,
            );

            $result = $this->pipeline->validate($file);

            $this->assertFalse(
                $result->passed,
                "Random bytes file (unsupported format) must always be rejected. " .
                "Detected mime: {$file->getMimeType()}"
            );

            @unlink($tmpPath);
        });
    }

    /**
     * Property: Orientation is correctly detected based on image dimensions.
     * Width >= Height → landscape, Width < Height → portrait.
     *
     * **Validates: Requirements 21.5**
     */
    public function test_orientation_detected_from_dimensions(): void
    {
        $this->forAll(
            Generators::choose(ResolutionValidator::MIN_WIDTH, ResolutionValidator::MAX_WIDTH),
            Generators::choose(ResolutionValidator::MIN_HEIGHT, ResolutionValidator::MAX_HEIGHT)
        )->then(function (int $width, int $height): void {
            $expectedOrientation = $width >= $height ? 'landscape' : 'portrait';

            $file = $this->createRealImage('jpeg', $width, $height, false);

            if ($file === null) {
                return;
            }

            $result = $this->pipeline->validate($file);

            // File should pass (valid resolution, valid format, valid size)
            $this->assertTrue($result->passed, "Valid image should pass pipeline");

            // Check orientation metadata
            $this->assertEquals(
                $expectedOrientation,
                $result->metadata['orientation'] ?? null,
                "Image {$width}x{$height} should be detected as {$expectedOrientation}"
            );

            @unlink($file->getPathname());
        });
    }

    /**
     * Create a real image file with GD at specific dimensions.
     * Returns null if GD cannot allocate the image (memory constraints).
     */
    private function createRealImage(string $format, int $width, int $height, bool $exceedSizeLimit): ?UploadedFile
    {
        // Clamp dimensions to avoid GD memory issues
        // GD needs ~4 bytes per pixel, so limit to reasonable allocation
        $maxPixels = 4000 * 3000; // ~48MB of RAM for image data
        $pixels = $width * $height;

        if ($pixels > $maxPixels) {
            // Scale down proportionally to stay within memory limits
            $scale = sqrt($maxPixels / $pixels);
            $width = max(1, (int) ($width * $scale));
            $height = max(1, (int) ($height * $scale));
        }

        $tmpPath = tempnam(sys_get_temp_dir(), 'content_test_');

        $img = @imagecreatetruecolor($width, $height);
        if ($img === false) {
            @unlink($tmpPath);

            return null;
        }

        // Fill with random color
        $color = imagecolorallocate($img, rand(0, 255), rand(0, 255), rand(0, 255));
        imagefill($img, 0, 0, $color);

        match ($format) {
            'jpeg' => imagejpeg($img, $tmpPath, 75),
            'png' => imagepng($img, $tmpPath, 1), // Low compression for speed
            'webp' => imagewebp($img, $tmpPath, 75),
            default => imagejpeg($img, $tmpPath, 75),
        };

        imagedestroy($img);

        if ($exceedSizeLimit) {
            // Pad file to exceed 10MB limit
            $currentSize = filesize($tmpPath);
            $target = FileSizeValidator::MAX_IMAGE_SIZE_BYTES + 1024; // just over limit
            if ($currentSize < $target) {
                $handle = fopen($tmpPath, 'ab');
                $padding = $target - $currentSize;
                // Write in chunks to avoid memory issues
                while ($padding > 0) {
                    $chunk = min($padding, 8192);
                    fwrite($handle, str_repeat("\0", $chunk));
                    $padding -= $chunk;
                }
                fclose($handle);
            }
        }

        // Verify the file actually has valid image data readable by getimagesize
        $dims = @getimagesize($tmpPath);
        if ($dims === false) {
            @unlink($tmpPath);

            return null;
        }

        $mimeType = match ($format) {
            'jpeg' => 'image/jpeg',
            'png' => 'image/png',
            'webp' => 'image/webp',
            default => 'image/jpeg',
        };

        return new UploadedFile(
            path: $tmpPath,
            originalName: "test_image.{$format}",
            mimeType: $mimeType,
            error: UPLOAD_ERR_OK,
            test: true,
        );
    }

    /**
     * Create a valid MP4 file with specific size.
     * Uses minimal valid MP4 file header so finfo detects it as video/mp4.
     * Uses fseek for large files to avoid excessive memory consumption.
     */
    private function createMp4File(int $targetSize): UploadedFile
    {
        $tmpPath = tempnam(sys_get_temp_dir(), 'content_test_');

        // Minimal valid MP4/ISO BMFF file header (ftyp box)
        // This is the minimum structure for finfo to detect video/mp4
        $ftypBox = pack('N', 20)            // box size: 20 bytes
            . 'ftyp'                         // box type
            . 'isom'                         // major brand
            . pack('N', 0x200)               // minor version
            . 'isom';                        // compatible brand

        $handle = fopen($tmpPath, 'wb');
        fwrite($handle, $ftypBox);

        // Fill remaining with mdat box (media data)
        $mdatSize = $targetSize - 20;
        if ($mdatSize > 8) {
            // mdat header
            fwrite($handle, pack('N', $mdatSize) . 'mdat');
            $remaining = $mdatSize - 8;
            // Use fseek + single byte write for large files (sparse file)
            if ($remaining > 1024 * 1024) {
                fseek($handle, $remaining - 1, SEEK_CUR);
                fwrite($handle, "\0");
            } else {
                while ($remaining > 0) {
                    $chunk = min($remaining, 65536);
                    fwrite($handle, str_repeat("\0", $chunk));
                    $remaining -= $chunk;
                }
            }
        } elseif ($mdatSize > 0) {
            fwrite($handle, str_repeat("\0", $mdatSize));
        }

        fclose($handle);

        return new UploadedFile(
            path: $tmpPath,
            originalName: 'test_video.mp4',
            mimeType: 'video/mp4',
            error: UPLOAD_ERR_OK,
            test: true,
        );
    }
}
