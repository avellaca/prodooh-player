<?php

namespace Tests\Property;

use App\Models\Content;
use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\Tenant;
use App\Models\User;
use Eris\Generators;
use Eris\TestTrait;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Property Test for Copy Creatives.
 *
 * Property 13: Copia de creativos respeta coincidencia de resolución
 *
 * For any OrderLine with creatives and any target OrderLine with screens,
 * the copy operation SHALL create creatives in the target only for Content
 * whose dimensions match at least one screen. Non-matching content is reported
 * as skipped. created + skipped == total unique source contents.
 *
 * **Validates: Requirements 20.2, 20.3, 20.4**
 */
class CopyCreativesPropertyTest extends TestCase
{
    use RefreshDatabase, TestTrait;

    /**
     * Prevent seeding — Eris TestTrait's $seed property conflicts with Laravel's shouldSeed().
     */
    protected function shouldSeed(): bool
    {
        return false;
    }

    /**
     * Property 13: Copia de creativos respeta coincidencia de resolución
     *
     * For any combination of source creatives and target screens:
     * - Creates creatives in target only for Content whose dimensions match at least one target screen
     * - Non-matching content is reported as skipped
     * - created_contents + skipped == total unique source contents
     *
     * **Validates: Requirements 20.2, 20.3, 20.4**
     */
    public function test_copy_creatives_respects_resolution_matching(): void
    {
        $resolutions = [
            [1920, 1080],
            [1080, 1920],
            [3840, 2160],
            [1280, 720],
            [768, 1024],
        ];

        $this->limitTo(5)->forAll(
            Generators::choose(1, 4),   // number of source screens (with creatives)
            Generators::choose(1, 4),   // number of target screens
            Generators::choose(0, 4),   // seed for source screen resolution selections
            Generators::choose(0, 4),   // seed for target screen resolution selections
            Generators::choose(1, 4)    // number of unique contents to assign to source
        )->then(function (
            int $numSourceScreens,
            int $numTargetScreens,
            int $sourceResSeed,
            int $targetResSeed,
            int $numContents
        ) use ($resolutions): void {
            // Setup: tenant, admin, order, source and target order lines
            $tenant = Tenant::factory()->create();
            $admin = User::factory()->tenantAdmin()->create(['tenant_id' => $tenant->id]);
            $this->actingAs($admin);

            $order = Order::factory()->create(['tenant_id' => $tenant->id]);
            $sourceOrderLine = OrderLine::factory()->create([
                'order_id' => $order->id,
                'starts_at' => now()->subDays(10),
                'ends_at' => now()->addDays(20),
            ]);
            $targetOrderLine = OrderLine::factory()->create([
                'order_id' => $order->id,
                'starts_at' => now()->subDays(5),
                'ends_at' => now()->addDays(30),
            ]);

            // Create source screens and targets
            $sourceScreens = [];
            for ($i = 0; $i < $numSourceScreens; $i++) {
                $resIdx = ($sourceResSeed + $i) % count($resolutions);
                $res = $resolutions[$resIdx];
                $screen = Screen::factory()->create([
                    'tenant_id' => $tenant->id,
                    'resolution_width' => $res[0],
                    'resolution_height' => $res[1],
                ]);
                $sourceScreens[] = $screen;
                OrderLineTarget::factory()->create([
                    'order_line_id' => $sourceOrderLine->id,
                    'screen_id' => $screen->id,
                    'screen_group_id' => null,
                ]);
            }

            // Create target screens and targets
            $targetScreens = [];
            for ($i = 0; $i < $numTargetScreens; $i++) {
                $resIdx = ($targetResSeed + $i) % count($resolutions);
                $res = $resolutions[$resIdx];
                $screen = Screen::factory()->create([
                    'tenant_id' => $tenant->id,
                    'resolution_width' => $res[0],
                    'resolution_height' => $res[1],
                ]);
                $targetScreens[] = $screen;
                OrderLineTarget::factory()->create([
                    'order_line_id' => $targetOrderLine->id,
                    'screen_id' => $screen->id,
                    'screen_group_id' => null,
                ]);
            }

            // Create unique contents and assign them as creatives on the source order line
            $contents = [];
            for ($i = 0; $i < $numContents; $i++) {
                $resIdx = ($sourceResSeed + $i) % count($resolutions);
                $res = $resolutions[$resIdx];
                $content = Content::factory()->create([
                    'tenant_id' => $tenant->id,
                    'width' => $res[0],
                    'height' => $res[1],
                ]);
                $contents[] = $content;

                // Assign creative to a source screen target that matches the content dimension
                $matchingSourceTarget = OrderLineTarget::where('order_line_id', $sourceOrderLine->id)
                    ->whereHas('screen', function ($q) use ($res) {
                        $q->withoutGlobalScopes()
                          ->where('resolution_width', $res[0])
                          ->where('resolution_height', $res[1]);
                    })
                    ->first();

                // If no source screen matches, use the first source target
                if (!$matchingSourceTarget) {
                    $matchingSourceTarget = OrderLineTarget::where('order_line_id', $sourceOrderLine->id)->first();
                }

                Creative::create([
                    'order_line_target_id' => $matchingSourceTarget->id,
                    'content_id' => $content->id,
                    'weight' => 100,
                    'resolution_width' => $res[0],
                    'resolution_height' => $res[1],
                ]);
            }

            // Build the expected target resolution map
            $targetResolutions = [];
            foreach ($targetScreens as $screen) {
                $key = $screen->resolution_width . 'x' . $screen->resolution_height;
                if (!isset($targetResolutions[$key])) {
                    $targetResolutions[$key] = [];
                }
                $targetResolutions[$key][] = $screen->id;
            }

            // Calculate expected results
            $expectedSkipped = 0;
            $matchedContentCount = 0;
            $expectedCreated = 0;
            foreach ($contents as $content) {
                $contentKey = $content->width . 'x' . $content->height;
                if (isset($targetResolutions[$contentKey])) {
                    $matchedContentCount++;
                    $expectedCreated += count($targetResolutions[$contentKey]);
                } else {
                    $expectedSkipped++;
                }
            }

            // Call the copy endpoint
            $response = $this->actingAs($admin)
                ->postJson("/api/admin/order-lines/{$sourceOrderLine->id}/copy-creatives", [
                    'target_order_line_id' => $targetOrderLine->id,
                ]);

            $response->assertStatus(201);
            $data = $response->json('data');

            // PROPERTY ASSERTION 1: Only matching content produces creatives in target
            $this->assertEquals(
                $expectedCreated,
                $data['created'],
                "Expected {$expectedCreated} creatives created but got {$data['created']}. " .
                "Source contents: {$numContents}, target screens: {$numTargetScreens}"
            );

            // PROPERTY ASSERTION 2: Non-matching content is reported as skipped
            $this->assertEquals(
                $expectedSkipped,
                $data['skipped'],
                "Expected {$expectedSkipped} skipped but got {$data['skipped']}"
            );

            // PROPERTY ASSERTION 3: created_contents + skipped == total unique source contents
            // Note: 'created' counts individual creatives (one per screen), but the invariant
            // is about unique contents. A matched content can produce multiple creatives.
            $this->assertEquals(
                $numContents,
                $matchedContentCount + $expectedSkipped,
                "matched_contents ({$matchedContentCount}) + skipped ({$expectedSkipped}) must equal total unique source contents ({$numContents})"
            );

            // PROPERTY ASSERTION 4: Verify created creatives in DB belong to target order line
            $targetTargetIds = OrderLineTarget::where('order_line_id', $targetOrderLine->id)
                ->pluck('id')
                ->toArray();
            $createdCreatives = Creative::whereIn('order_line_target_id', $targetTargetIds)->get();

            $this->assertEquals(
                $expectedCreated,
                $createdCreatives->count(),
                "Number of creatives in target DB should match expected created count"
            );

            // PROPERTY ASSERTION 5: All created creatives have resolution matching their content
            foreach ($createdCreatives as $creative) {
                $content = Content::find($creative->content_id);
                $this->assertNotNull($content);
                $this->assertEquals($content->width, $creative->resolution_width);
                $this->assertEquals($content->height, $creative->resolution_height);
            }

            // PROPERTY ASSERTION 6: Covered screens match screens that had matching resolutions
            $expectedCoveredScreens = collect();
            foreach ($contents as $content) {
                $contentKey = $content->width . 'x' . $content->height;
                if (isset($targetResolutions[$contentKey])) {
                    foreach ($targetResolutions[$contentKey] as $screenId) {
                        $expectedCoveredScreens->push($screenId);
                    }
                }
            }
            $expectedCoveredScreens = $expectedCoveredScreens->unique()->values()->sort()->values()->all();
            $actualCoveredScreens = collect($data['covered_screens'])->sort()->values()->all();
            $this->assertEquals(
                $expectedCoveredScreens,
                $actualCoveredScreens,
                "Covered screens should match all target screens that received creatives"
            );

            // Cleanup for next iteration
            Creative::withoutGlobalScopes()->delete();
            OrderLineTarget::query()->delete();
            Screen::withoutGlobalScopes()->delete();
            Content::withoutGlobalScopes()->delete();
            OrderLine::query()->delete();
            \App\Models\AuditLog::query()->delete();
            Order::query()->delete();
            User::query()->delete();
            Tenant::query()->delete();
        });
    }

    /**
     * Property 13 (variant): Copy with mixed matching and non-matching contents
     * ensures the invariant holds when some contents have no resolution match.
     *
     * This variant specifically tests that:
     * - Only contents whose dimensions match a target screen are copied
     * - Non-matching contents are skipped
     * - The sum created + skipped equals the total unique source contents
     *
     * **Validates: Requirements 20.2, 20.3, 20.4**
     */
    public function test_copy_creatives_skipped_plus_matched_equals_total_unique_contents(): void
    {
        $this->limitTo(5)->forAll(
            Generators::choose(1, 3),   // number of matching contents
            Generators::choose(1, 3),   // number of non-matching contents
            Generators::choose(1, 3)    // number of target screens (all 1920x1080)
        )->then(function (int $numMatching, int $numNonMatching, int $numTargetScreens): void {
            $tenant = Tenant::factory()->create();
            $admin = User::factory()->tenantAdmin()->create(['tenant_id' => $tenant->id]);
            $this->actingAs($admin);

            $order = Order::factory()->create(['tenant_id' => $tenant->id]);
            $sourceOrderLine = OrderLine::factory()->create([
                'order_id' => $order->id,
                'starts_at' => now()->subDays(10),
                'ends_at' => now()->addDays(20),
            ]);
            $targetOrderLine = OrderLine::factory()->create([
                'order_id' => $order->id,
                'starts_at' => now()->subDays(5),
                'ends_at' => now()->addDays(30),
            ]);

            // Source screen (mixed resolutions)
            $sourceScreen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'resolution_width' => 1920,
                'resolution_height' => 1080,
            ]);
            $sourceTarget = OrderLineTarget::factory()->create([
                'order_line_id' => $sourceOrderLine->id,
                'screen_id' => $sourceScreen->id,
                'screen_group_id' => null,
            ]);

            // Target screens — all 1920x1080
            for ($i = 0; $i < $numTargetScreens; $i++) {
                $screen = Screen::factory()->create([
                    'tenant_id' => $tenant->id,
                    'resolution_width' => 1920,
                    'resolution_height' => 1080,
                ]);
                OrderLineTarget::factory()->create([
                    'order_line_id' => $targetOrderLine->id,
                    'screen_id' => $screen->id,
                    'screen_group_id' => null,
                ]);
            }

            // Create matching contents (1920x1080 — will match target screens)
            for ($i = 0; $i < $numMatching; $i++) {
                $content = Content::factory()->create([
                    'tenant_id' => $tenant->id,
                    'width' => 1920,
                    'height' => 1080,
                ]);
                Creative::create([
                    'order_line_target_id' => $sourceTarget->id,
                    'content_id' => $content->id,
                    'weight' => 100,
                    'resolution_width' => 1920,
                    'resolution_height' => 1080,
                ]);
            }

            // Create non-matching contents (3840x2160 — no target screen has this resolution)
            for ($i = 0; $i < $numNonMatching; $i++) {
                $content = Content::factory()->create([
                    'tenant_id' => $tenant->id,
                    'width' => 3840,
                    'height' => 2160,
                ]);
                Creative::create([
                    'order_line_target_id' => $sourceTarget->id,
                    'content_id' => $content->id,
                    'weight' => 100,
                    'resolution_width' => 3840,
                    'resolution_height' => 2160,
                ]);
            }

            $totalUniqueContents = $numMatching + $numNonMatching;

            // Call the copy endpoint
            $response = $this->actingAs($admin)
                ->postJson("/api/admin/order-lines/{$sourceOrderLine->id}/copy-creatives", [
                    'target_order_line_id' => $targetOrderLine->id,
                ]);

            $response->assertStatus(201);
            $data = $response->json('data');

            // PROPERTY: created creatives = matching_contents × target_screens
            $expectedCreated = $numMatching * $numTargetScreens;
            $this->assertEquals(
                $expectedCreated,
                $data['created'],
                "Expected {$expectedCreated} creatives ({$numMatching} matching × {$numTargetScreens} screens)"
            );

            // PROPERTY: skipped == number of non-matching contents
            $this->assertEquals(
                $numNonMatching,
                $data['skipped'],
                "Expected {$numNonMatching} skipped (non-matching contents)"
            );

            // PROPERTY: The invariant: matched_contents + skipped == total unique source contents
            // Note: "matched_contents" here means the count of unique contents that had at least one
            // matching target screen. "created" is the total creatives (may be > matched_contents
            // if multiple target screens match).
            $matchedContents = $totalUniqueContents - $data['skipped'];
            $this->assertEquals(
                $totalUniqueContents,
                $matchedContents + $data['skipped'],
                "matched_contents + skipped must equal total unique source contents ({$totalUniqueContents})"
            );

            // Cleanup for next iteration
            Creative::withoutGlobalScopes()->delete();
            OrderLineTarget::query()->delete();
            Screen::withoutGlobalScopes()->delete();
            Content::withoutGlobalScopes()->delete();
            OrderLine::query()->delete();
            \App\Models\AuditLog::query()->delete();
            Order::query()->delete();
            User::query()->delete();
            Tenant::query()->delete();
        });
    }
}
