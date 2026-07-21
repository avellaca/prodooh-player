<?php

namespace Tests\Property;

use App\Models\Content;
use App\Models\Tag;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Property-based test for batch resilience in bulk upload.
 *
 * Property 16: Resiliencia de lotes — fallo parcial no afecta éxitos
 *
 * For any batch of operations (upload) where some items fail, the successful
 * items SHALL be processed completely and persisted, and the failed items SHALL
 * be reported without affecting the others.
 *
 * **Validates: Requirements 1.4**
 */
class BatchResiliencePropertyTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Prevent seeding — avoids conflict with property seed integers.
     */
    protected function shouldSeed(): bool
    {
        return false;
    }

    /**
     * Property 16a: In any batch with mixed valid/invalid files, all valid files
     * SHALL be persisted in the database regardless of failures in other items.
     *
     * Strategy:
     * 1. Generate a random batch (2-10 files) with a random mix of valid images and invalid PDFs
     * 2. Ensure at least one valid and at least one invalid file
     * 3. Call POST /api/admin/content/bulk
     * 4. Verify: all valid files are persisted in the database
     * 5. Verify: no invalid files are persisted
     * 6. Verify: summary counts match expectations
     *
     * **Validates: Requirements 1.4**
     */
    public function test_partial_failure_does_not_prevent_successful_items_from_persisting(): void
    {
        Storage::fake('local');

        for ($iteration = 0; $iteration < 10; $iteration++) {
            $tenant = Tenant::factory()->create();
            $admin = User::factory()->tenantAdmin()->create([
                'tenant_id' => $tenant->id,
            ]);

            // Generate a random batch size between 3 and 10
            $batchSize = random_int(3, 10);

            // Decide randomly how many valid and invalid files (at least 1 of each)
            $validCount = random_int(1, $batchSize - 1);
            $invalidCount = $batchSize - $validCount;

            // Build the files array with randomized order
            $files = [];
            $validFilenames = [];
            $invalidFilenames = [];

            // Create valid image files
            $resolutions = [[1920, 1080], [1080, 1920], [3840, 2160], [1280, 720], [800, 600]];
            for ($v = 0; $v < $validCount; $v++) {
                [$w, $h] = $resolutions[array_rand($resolutions)];
                $filename = "valid_iter{$iteration}_file{$v}.jpg";
                $files[] = ['file' => UploadedFile::fake()->image($filename, $w, $h), 'valid' => true];
                $validFilenames[] = $filename;
            }

            // Create invalid files (PDF — unsupported mime type)
            for ($inv = 0; $inv < $invalidCount; $inv++) {
                $filename = "invalid_iter{$iteration}_file{$inv}.pdf";
                $files[] = ['file' => UploadedFile::fake()->create($filename, 100, 'application/pdf'), 'valid' => false];
                $invalidFilenames[] = $filename;
            }

            // Shuffle to randomize order (failures can be anywhere in the batch)
            shuffle($files);

            $uploadFiles = array_map(fn ($f) => $f['file'], $files);

            // Call the bulk upload endpoint
            $response = $this->actingAs($admin, 'sanctum')
                ->postJson('/api/admin/content/bulk', [
                    'files' => $uploadFiles,
                ]);

            $response->assertStatus(207);

            $summary = $response->json('summary');

            // Property: successful count equals valid files count
            $this->assertEquals(
                $validCount,
                $summary['successful'],
                "Property 16a (iter {$iteration}): Expected {$validCount} successes but got {$summary['successful']}. "
                . "Batch size: {$batchSize}, valid: {$validCount}, invalid: {$invalidCount}"
            );

            // Property: failed count equals invalid files count
            $this->assertEquals(
                $invalidCount,
                $summary['failed'],
                "Property 16a (iter {$iteration}): Expected {$invalidCount} failures but got {$summary['failed']}. "
                . "Batch size: {$batchSize}, valid: {$validCount}, invalid: {$invalidCount}"
            );

            // Property: total = batch size
            $this->assertEquals(
                $batchSize,
                $summary['total'],
                "Property 16a (iter {$iteration}): Expected total {$batchSize} but got {$summary['total']}"
            );

            // Property: all valid files are persisted in the database
            foreach ($validFilenames as $filename) {
                $this->assertDatabaseHas('content', [
                    'tenant_id' => $tenant->id,
                    'filename' => $filename,
                ], null, "Property 16a (iter {$iteration}): Valid file '{$filename}' must be persisted in DB");
            }

            // Property: no invalid files are persisted
            foreach ($invalidFilenames as $filename) {
                $this->assertDatabaseMissing('content', [
                    'tenant_id' => $tenant->id,
                    'filename' => $filename,
                ]);
            }

            // Property: the failures array contains entries with filenames and errors
            $failures = $response->json('failures');
            $this->assertCount(
                $invalidCount,
                $failures,
                "Property 16a (iter {$iteration}): failures array must contain {$invalidCount} entries"
            );

            foreach ($failures as $failure) {
                $this->assertArrayHasKey('filename', $failure);
                $this->assertArrayHasKey('errors', $failure);
                $this->assertNotEmpty($failure['errors']);
            }

            // Cleanup for next iteration
            Content::withoutGlobalScopes()->where('tenant_id', $tenant->id)->delete();
            User::query()->where('tenant_id', $tenant->id)->delete();
            Tenant::query()->where('id', $tenant->id)->delete();
        }
    }

    /**
     * Property 16b: In any batch with mixed valid/invalid files and tags specified,
     * successful items SHALL have all tags associated, and failed items SHALL NOT
     * create any partial tag associations.
     *
     * Strategy:
     * 1. Create random tags (1-3)
     * 2. Generate a mixed batch with valid and invalid files
     * 3. Call bulk upload with tag_ids
     * 4. Verify: each successful file has exactly the specified tags
     * 5. Verify: failed files have no content record (so no tag associations)
     *
     * **Validates: Requirements 1.4**
     */
    public function test_partial_failure_does_not_affect_tag_association_of_successful_items(): void
    {
        Storage::fake('local');

        for ($iteration = 0; $iteration < 10; $iteration++) {
            $tenant = Tenant::factory()->create();
            $admin = User::factory()->tenantAdmin()->create([
                'tenant_id' => $tenant->id,
            ]);

            // Create random number of tags (1-3)
            $tagCount = random_int(1, 3);
            $tags = [];
            for ($t = 0; $t < $tagCount; $t++) {
                $tags[] = Tag::create([
                    'tenant_id' => $tenant->id,
                    'name' => "Tag_{$iteration}_{$t}_" . fake()->word(),
                ]);
            }
            $tagIds = array_map(fn ($tag) => $tag->id, $tags);

            // Generate batch with at least 1 valid and 1 invalid
            $batchSize = random_int(3, 8);
            $validCount = random_int(1, $batchSize - 1);
            $invalidCount = $batchSize - $validCount;

            $files = [];
            $validFilenames = [];

            $resolutions = [[1920, 1080], [1080, 1920], [3840, 2160]];
            for ($v = 0; $v < $validCount; $v++) {
                [$w, $h] = $resolutions[array_rand($resolutions)];
                $filename = "tagged_valid_iter{$iteration}_file{$v}.png";
                $files[] = UploadedFile::fake()->image($filename, $w, $h);
                $validFilenames[] = $filename;
            }

            for ($inv = 0; $inv < $invalidCount; $inv++) {
                $filename = "tagged_invalid_iter{$iteration}_file{$inv}.pdf";
                $files[] = UploadedFile::fake()->create($filename, 100, 'application/pdf');
            }

            shuffle($files);

            $response = $this->actingAs($admin, 'sanctum')
                ->postJson('/api/admin/content/bulk', [
                    'files' => $files,
                    'tag_ids' => $tagIds,
                ]);

            $response->assertStatus(207);

            // Property: each successful content has exactly the specified tags
            $persistedContents = Content::where('tenant_id', $tenant->id)->get();
            $this->assertCount(
                $validCount,
                $persistedContents,
                "Property 16b (iter {$iteration}): Expected {$validCount} content records, got {$persistedContents->count()}"
            );

            foreach ($persistedContents as $content) {
                $contentTagIds = $content->tags()->pluck('tags.id')->sort()->values()->toArray();
                $expectedTagIds = collect($tagIds)->sort()->values()->toArray();

                $this->assertEquals(
                    $expectedTagIds,
                    $contentTagIds,
                    "Property 16b (iter {$iteration}): Content '{$content->filename}' must have exactly "
                    . "{$tagCount} tags associated. Expected: " . json_encode($expectedTagIds)
                    . ", Got: " . json_encode($contentTagIds)
                );
            }

            // Property: total content_tags records = validCount * tagCount
            $totalPivotRecords = \DB::table('content_tags')
                ->whereIn('content_id', $persistedContents->pluck('id'))
                ->count();
            $this->assertEquals(
                $validCount * $tagCount,
                $totalPivotRecords,
                "Property 16b (iter {$iteration}): Expected {$validCount}*{$tagCount}=" . ($validCount * $tagCount)
                . " content_tags records, got {$totalPivotRecords}"
            );

            // Cleanup for next iteration
            \DB::table('content_tags')->whereIn('content_id', $persistedContents->pluck('id'))->delete();
            Content::withoutGlobalScopes()->where('tenant_id', $tenant->id)->delete();
            Tag::where('tenant_id', $tenant->id)->delete();
            User::query()->where('tenant_id', $tenant->id)->delete();
            Tenant::query()->where('id', $tenant->id)->delete();
        }
    }

    /**
     * Property 16c: For any batch where the position of failures is randomized,
     * the successes array SHALL contain correct indices mapping to the original
     * batch positions, preserving traceability.
     *
     * Strategy:
     * 1. Build a batch with known valid/invalid positions
     * 2. After upload, verify that each success entry's index matches the original position
     * 3. Verify that each failure entry's index matches the original position
     *
     * **Validates: Requirements 1.4**
     */
    public function test_success_and_failure_indices_map_to_original_batch_positions(): void
    {
        Storage::fake('local');

        for ($iteration = 0; $iteration < 10; $iteration++) {
            $tenant = Tenant::factory()->create();
            $admin = User::factory()->tenantAdmin()->create([
                'tenant_id' => $tenant->id,
            ]);

            $batchSize = random_int(3, 8);

            // Randomly assign valid/invalid to each position (at least 1 of each)
            $validPositions = [];
            $invalidPositions = [];
            $files = [];

            // Ensure at least 1 valid and 1 invalid
            $mustHaveValid = random_int(0, $batchSize - 1);
            $mustHaveInvalid = $mustHaveValid === 0 ? 1 : 0;

            for ($pos = 0; $pos < $batchSize; $pos++) {
                if ($pos === $mustHaveValid) {
                    $isValid = true;
                } elseif ($pos === $mustHaveInvalid) {
                    $isValid = false;
                } else {
                    $isValid = (bool) random_int(0, 1);
                }

                if ($isValid) {
                    $files[] = UploadedFile::fake()->image("idx_iter{$iteration}_pos{$pos}.jpg", 1920, 1080);
                    $validPositions[] = $pos;
                } else {
                    $files[] = UploadedFile::fake()->create("idx_iter{$iteration}_pos{$pos}.pdf", 100, 'application/pdf');
                    $invalidPositions[] = $pos;
                }
            }

            $response = $this->actingAs($admin, 'sanctum')
                ->postJson('/api/admin/content/bulk', [
                    'files' => $files,
                ]);

            $response->assertStatus(207);

            $successes = $response->json('successes');
            $failures = $response->json('failures');

            // Property: success indices match the known valid positions
            $successIndices = array_map(fn ($s) => $s['index'], $successes);
            sort($successIndices);
            sort($validPositions);
            $this->assertEquals(
                $validPositions,
                $successIndices,
                "Property 16c (iter {$iteration}): Success indices must match valid positions. "
                . "Expected: " . json_encode($validPositions) . ", Got: " . json_encode($successIndices)
            );

            // Property: failure indices match the known invalid positions
            $failureIndices = array_map(fn ($f) => $f['index'], $failures);
            sort($failureIndices);
            sort($invalidPositions);
            $this->assertEquals(
                $invalidPositions,
                $failureIndices,
                "Property 16c (iter {$iteration}): Failure indices must match invalid positions. "
                . "Expected: " . json_encode($invalidPositions) . ", Got: " . json_encode($failureIndices)
            );

            // Property: union of success + failure indices = full range [0, batchSize-1]
            $allIndices = array_merge($successIndices, $failureIndices);
            sort($allIndices);
            $this->assertEquals(
                range(0, $batchSize - 1),
                $allIndices,
                "Property 16c (iter {$iteration}): All indices [0..{$batchSize}-1] must be covered"
            );

            // Cleanup for next iteration
            Content::withoutGlobalScopes()->where('tenant_id', $tenant->id)->delete();
            User::query()->where('tenant_id', $tenant->id)->delete();
            Tenant::query()->where('id', $tenant->id)->delete();
        }
    }
}
