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
 * Property-based test for tag assignment in bulk upload.
 *
 * Uses randomized inputs (50 iterations) to verify Property 17:
 * For any batch of uploaded files with a set of tags T specified,
 * each successfully uploaded file SHALL have exactly the tags T
 * associated in the content_tags table.
 *
 * **Validates: Requirements 1.2**
 */
class BulkUploadTagAssignmentPropertyTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $tenantAdmin;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');

        $this->tenant = Tenant::factory()->create();
        $this->tenantAdmin = User::factory()->tenantAdmin()->create([
            'tenant_id' => $this->tenant->id,
        ]);
    }

    /**
     * Property 17: For any batch of files uploaded with a set of tags T,
     * each successfully uploaded file has exactly the tags T in content_tags.
     *
     * Strategy:
     * - Generate a random number of tags (1 to 5) for the tenant
     * - Select a random subset of those tags (1 to all) as the upload tag set T
     * - Generate a random number of valid image files (1 to 10)
     * - Upload the batch with tag set T
     * - Assert every successfully uploaded Content has EXACTLY the tags T associated
     *
     * **Validates: Requirements 1.2**
     */
    public function test_each_uploaded_file_has_exactly_the_specified_tags(): void
    {
        for ($i = 0; $i < 50; $i++) {
            // Random number of available tags for the tenant (1 to 5)
            $totalTagCount = random_int(1, 5);
            $allTags = [];
            for ($t = 0; $t < $totalTagCount; $t++) {
                $allTags[] = Tag::create([
                    'tenant_id' => $this->tenant->id,
                    'name' => "Tag_{$i}_{$t}_" . bin2hex(random_bytes(4)),
                ]);
            }

            // Select a random non-empty subset of tags as the upload tag set T
            $tagSubsetSize = random_int(1, $totalTagCount);
            $shuffledTags = collect($allTags)->shuffle();
            $selectedTags = $shuffledTags->take($tagSubsetSize);
            $selectedTagIds = $selectedTags->pluck('id')->toArray();

            // Random number of files (1 to 10)
            $fileCount = random_int(1, 10);
            $files = [];
            for ($f = 0; $f < $fileCount; $f++) {
                $files[] = UploadedFile::fake()->image(
                    "file_{$i}_{$f}.jpg",
                    random_int(100, 3840),
                    random_int(100, 2160)
                );
            }

            // Perform bulk upload with tags
            $response = $this->actingAs($this->tenantAdmin, 'sanctum')
                ->postJson('/api/admin/content/bulk', [
                    'files' => $files,
                    'tag_ids' => $selectedTagIds,
                ]);

            $response->assertStatus(207);

            $successfulCount = $response->json('summary.successful');
            $successes = $response->json('successes');

            // For each successfully uploaded content, verify exactly the tags T are associated
            foreach ($successes as $success) {
                $contentId = $success['data']['id'];
                $content = Content::find($contentId);

                $this->assertNotNull(
                    $content,
                    "Property 17 (iter {$i}): Content {$contentId} should exist in the database"
                );

                $associatedTagIds = $content->tags()->pluck('tags.id')->sort()->values()->toArray();
                $expectedTagIds = collect($selectedTagIds)->sort()->values()->toArray();

                $this->assertEquals(
                    $expectedTagIds,
                    $associatedTagIds,
                    "Property 17 (iter {$i}): Content '{$content->filename}' should have exactly " .
                    count($expectedTagIds) . " tags (IDs: " . implode(', ', $expectedTagIds) . "), " .
                    "but has " . count($associatedTagIds) . " tags (IDs: " . implode(', ', $associatedTagIds) . ")"
                );
            }

            // Verify the count of content_tags rows matches expectations
            $totalExpectedPivotRows = $successfulCount * $tagSubsetSize;
            $actualPivotRows = \DB::table('content_tags')
                ->whereIn('content_id', collect($successes)->pluck('data.id')->toArray())
                ->count();

            $this->assertEquals(
                $totalExpectedPivotRows,
                $actualPivotRows,
                "Property 17 (iter {$i}): Expected {$totalExpectedPivotRows} content_tags rows " .
                "({$successfulCount} files × {$tagSubsetSize} tags), got {$actualPivotRows}"
            );

            // Cleanup for next iteration to avoid unique constraint conflicts
            Content::query()->delete();
            Tag::query()->delete();
            \DB::table('content_tags')->delete();
        }
    }

    /**
     * Property 17b: When no tags are specified in bulk upload, no tag associations are created.
     *
     * For any batch of files uploaded WITHOUT tag_ids, no content_tags rows should be created.
     *
     * **Validates: Requirements 1.2**
     */
    public function test_no_tags_specified_means_no_tag_associations(): void
    {
        for ($i = 0; $i < 50; $i++) {
            // Random number of files (1 to 10)
            $fileCount = random_int(1, 10);
            $files = [];
            for ($f = 0; $f < $fileCount; $f++) {
                $files[] = UploadedFile::fake()->image(
                    "noTag_{$i}_{$f}.jpg",
                    random_int(100, 3840),
                    random_int(100, 2160)
                );
            }

            $response = $this->actingAs($this->tenantAdmin, 'sanctum')
                ->postJson('/api/admin/content/bulk', [
                    'files' => $files,
                ]);

            $response->assertStatus(207);

            $successes = $response->json('successes');

            foreach ($successes as $success) {
                $contentId = $success['data']['id'];
                $content = Content::find($contentId);

                $this->assertNotNull($content);
                $this->assertCount(
                    0,
                    $content->tags,
                    "Property 17b (iter {$i}): Content '{$content->filename}' should have " .
                    "no tags when tag_ids is not specified, but has " . $content->tags->count()
                );
            }

            // Verify no content_tags rows exist for these uploads
            $contentIds = collect($successes)->pluck('data.id')->toArray();
            $pivotCount = \DB::table('content_tags')
                ->whereIn('content_id', $contentIds)
                ->count();

            $this->assertEquals(
                0,
                $pivotCount,
                "Property 17b (iter {$i}): Expected 0 content_tags rows when no tags specified, got {$pivotCount}"
            );

            // Cleanup
            Content::query()->delete();
        }
    }

    /**
     * Property 17c: Tags are assigned consistently even with partial upload failures.
     *
     * For any batch containing a mix of valid and invalid files with tags T specified,
     * only the successfully uploaded files get the tags T — failed files get nothing.
     *
     * **Validates: Requirements 1.2**
     */
    public function test_tags_assigned_only_to_successful_uploads_in_partial_failure(): void
    {
        for ($i = 0; $i < 50; $i++) {
            // Create random tags (1 to 3)
            $tagCount = random_int(1, 3);
            $tags = [];
            for ($t = 0; $t < $tagCount; $t++) {
                $tags[] = Tag::create([
                    'tenant_id' => $this->tenant->id,
                    'name' => "PartialTag_{$i}_{$t}_" . bin2hex(random_bytes(4)),
                ]);
            }
            $tagIds = collect($tags)->pluck('id')->toArray();

            // Create a mix of valid images and invalid files (PDFs)
            $validCount = random_int(1, 5);
            $invalidCount = random_int(1, 3);
            $files = [];

            for ($f = 0; $f < $validCount; $f++) {
                $files[] = UploadedFile::fake()->image(
                    "valid_{$i}_{$f}.jpg",
                    random_int(100, 3840),
                    random_int(100, 2160)
                );
            }

            for ($f = 0; $f < $invalidCount; $f++) {
                $files[] = UploadedFile::fake()->create(
                    "invalid_{$i}_{$f}.pdf",
                    100,
                    'application/pdf'
                );
            }

            // Shuffle to randomize order
            shuffle($files);

            $response = $this->actingAs($this->tenantAdmin, 'sanctum')
                ->postJson('/api/admin/content/bulk', [
                    'files' => $files,
                    'tag_ids' => $tagIds,
                ]);

            $response->assertStatus(207);

            $successes = $response->json('successes');
            $failures = $response->json('failures');

            // Successful uploads should have exactly the tags T
            foreach ($successes as $success) {
                $contentId = $success['data']['id'];
                $content = Content::find($contentId);

                $associatedTagIds = $content->tags()->pluck('tags.id')->sort()->values()->toArray();
                $expectedTagIds = collect($tagIds)->sort()->values()->toArray();

                $this->assertEquals(
                    $expectedTagIds,
                    $associatedTagIds,
                    "Property 17c (iter {$i}): Successful content '{$content->filename}' should have exactly " .
                    "the specified tags even in partial failure scenario"
                );
            }

            // Total content_tags rows should be successful_count × tag_count
            $contentIds = collect($successes)->pluck('data.id')->toArray();
            $totalPivotRows = \DB::table('content_tags')
                ->whereIn('content_id', $contentIds)
                ->count();

            $expectedPivotRows = count($successes) * $tagCount;
            $this->assertEquals(
                $expectedPivotRows,
                $totalPivotRows,
                "Property 17c (iter {$i}): Expected {$expectedPivotRows} content_tags rows, got {$totalPivotRows}"
            );

            // Failed files should NOT exist in content table at all
            foreach ($failures as $failure) {
                $this->assertDatabaseMissing('content', [
                    'filename' => $failure['filename'],
                    'tenant_id' => $this->tenant->id,
                ]);
            }

            // Cleanup
            Content::query()->delete();
            Tag::query()->delete();
            \DB::table('content_tags')->delete();
        }
    }
}
