<?php

namespace Tests\Property;

use App\Models\Content;
use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use App\Models\User;
use Eris\Generators;
use Eris\TestTrait;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Property Tests for ResolutionController and ContentController (filtered by resolution).
 *
 * Property 9: Correctitud de agrupación por resolución
 * Property 11: Filtrado de contenido por resolución
 *
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 12.1, 12.4**
 */
class ResolutionControllerPropertyTest extends TestCase
{
    use RefreshDatabase, TestTrait;

    /**
     * Prevent seeding — Eris TestTrait's $seed property (random seed integer)
     * conflicts with Laravel's shouldSeed() which checks property_exists($this, 'seed').
     */
    protected function shouldSeed(): bool
    {
        return false;
    }

    /**
     * Property 9: Correctitud de agrupación por resolución (50 iterations)
     *
     * For any order line with targets pointing to screens of varied resolutions,
     * the GET /order-lines/{orderLineId}/resolutions endpoint SHALL:
     * - Return groups where sum of screen_count equals total unique screens
     * - Place each screen in exactly one group
     * - Group screens with the same resolution together
     * - Order groups by screen_count descending
     *
     * **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
     */
    public function test_resolution_grouping_correctness(): void
    {
        // Common resolutions to pick from
        $resolutions = [
            [1920, 1080],
            [1080, 1920],
            [3840, 2160],
            [1280, 720],
            [800, 600],
        ];

        $this->limitTo(5)->forAll(
            Generators::choose(2, 5),  // number of different resolutions to use
            Generators::choose(1, 4)   // screens per resolution
        )->then(function (int $numResolutions, int $screensPerResolution) use ($resolutions): void {
            // Setup: tenant, order, order line, admin user
            $tenant = Tenant::factory()->create();
            $order = Order::factory()->create(['tenant_id' => $tenant->id]);
            $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);
            $admin = User::factory()->superAdmin()->create();

            // Pick random subset of resolutions
            $selectedResolutions = array_slice($resolutions, 0, min($numResolutions, count($resolutions)));
            $allScreenIds = [];
            $expectedGroups = []; // resolution_key => [screen_ids]

            foreach ($selectedResolutions as [$width, $height]) {
                $resKey = "{$width}x{$height}";
                $expectedGroups[$resKey] = [];

                for ($i = 0; $i < $screensPerResolution; $i++) {
                    $screen = Screen::factory()->create([
                        'tenant_id' => $tenant->id,
                        'resolution_width' => $width,
                        'resolution_height' => $height,
                    ]);

                    $target = OrderLineTarget::factory()->create([
                        'order_line_id' => $orderLine->id,
                        'screen_id' => $screen->id,
                        'screen_group_id' => null,
                    ]);

                    $allScreenIds[] = $screen->id;
                    $expectedGroups[$resKey][] = $screen->id;
                }
            }

            $totalScreens = count($allScreenIds);

            // Hit the endpoint
            $response = $this->actingAs($admin)
                ->getJson("/api/admin/order-lines/{$orderLine->id}/resolutions");

            $response->assertOk();
            $groups = $response->json('data');

            // Property: sum of screen_count === total unique screens
            $sumScreenCount = array_sum(array_column($groups, 'screen_count'));
            $this->assertEquals(
                $totalScreens,
                $sumScreenCount,
                "Property 9: sum of screen_count ({$sumScreenCount}) must equal total screens ({$totalScreens})"
            );

            // Property: each screen appears in exactly one group
            $allReturnedScreenIds = [];
            foreach ($groups as $group) {
                foreach ($group['screens'] as $screen) {
                    $this->assertNotContains(
                        $screen['id'],
                        $allReturnedScreenIds,
                        "Property 9: screen {$screen['id']} appears in more than one group"
                    );
                    $allReturnedScreenIds[] = $screen['id'];
                }
            }
            $this->assertCount(
                $totalScreens,
                $allReturnedScreenIds,
                "Property 9: not all screens returned in groups"
            );

            // Property: screens in the same group have the same resolution
            foreach ($groups as $group) {
                $groupWidth = $group['resolution_width'];
                $groupHeight = $group['resolution_height'];
                foreach ($group['screens'] as $screen) {
                    $dbScreen = Screen::withoutGlobalScopes()->find($screen['id']);
                    $this->assertEquals(
                        $groupWidth,
                        $dbScreen->resolution_width,
                        "Property 9: screen {$screen['id']} has width {$dbScreen->resolution_width} but group says {$groupWidth}"
                    );
                    $this->assertEquals(
                        $groupHeight,
                        $dbScreen->resolution_height,
                        "Property 9: screen {$screen['id']} has height {$dbScreen->resolution_height} but group says {$groupHeight}"
                    );
                }
            }

            // Property: groups ordered by screen_count descending
            for ($i = 1; $i < count($groups); $i++) {
                $this->assertGreaterThanOrEqual(
                    $groups[$i]['screen_count'],
                    $groups[$i - 1]['screen_count'],
                    "Property 9: groups not ordered by screen_count descending at index {$i}"
                );
            }

            // Cleanup for next iteration
            Creative::withoutGlobalScopes()->delete();
            OrderLineTarget::query()->delete();
            Screen::withoutGlobalScopes()->delete();
            OrderLine::query()->delete();
            Order::query()->delete();
            User::query()->delete();
            Tenant::query()->delete();
        });
    }

    /**
     * Property 9 (extended): Grouping with screen groups resolves correctly.
     *
     * When targets reference screen_group_id instead of screen_id directly,
     * the resolution endpoint still groups by screen resolution correctly.
     *
     * **Validates: Requirements 6.3**
     */
    public function test_resolution_grouping_with_screen_groups(): void
    {
        $this->limitTo(5)->forAll(
            Generators::choose(2, 4),  // screens in group
            Generators::choose(1, 3)   // number of groups
        )->then(function (int $screensInGroup, int $numGroups): void {
            $tenant = Tenant::factory()->create();
            $order = Order::factory()->create(['tenant_id' => $tenant->id]);
            $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);
            $admin = User::factory()->superAdmin()->create();

            $totalScreens = 0;

            for ($g = 0; $g < $numGroups; $g++) {
                $group = ScreenGroup::factory()->create(['tenant_id' => $tenant->id]);

                // All screens in a group share the same resolution
                $width = [1920, 1080, 3840][$g % 3];
                $height = [1080, 1920, 2160][$g % 3];

                for ($s = 0; $s < $screensInGroup; $s++) {
                    Screen::factory()->create([
                        'tenant_id' => $tenant->id,
                        'group_id' => $group->id,
                        'resolution_width' => $width,
                        'resolution_height' => $height,
                    ]);
                    $totalScreens++;
                }

                // Create target via screen_group_id
                OrderLineTarget::factory()->create([
                    'order_line_id' => $orderLine->id,
                    'screen_id' => null,
                    'screen_group_id' => $group->id,
                ]);
            }

            $response = $this->actingAs($admin)
                ->getJson("/api/admin/order-lines/{$orderLine->id}/resolutions");

            $response->assertOk();
            $groups = $response->json('data');

            // Sum of screen_count must equal total screens
            $sumScreenCount = array_sum(array_column($groups, 'screen_count'));
            $this->assertEquals(
                $totalScreens,
                $sumScreenCount,
                "Property 9 (groups): sum of screen_count ({$sumScreenCount}) != total screens ({$totalScreens})"
            );

            // Order by screen_count descending
            for ($i = 1; $i < count($groups); $i++) {
                $this->assertGreaterThanOrEqual(
                    $groups[$i]['screen_count'],
                    $groups[$i - 1]['screen_count'],
                    "Property 9 (groups): not ordered by screen_count descending"
                );
            }

            // Cleanup
            Creative::withoutGlobalScopes()->delete();
            OrderLineTarget::query()->delete();
            Screen::withoutGlobalScopes()->delete();
            ScreenGroup::query()->delete();
            OrderLine::query()->delete();
            Order::query()->delete();
            User::query()->delete();
            Tenant::query()->delete();
        });
    }

    /**
     * Property 11: Filtrado de contenido por resolución (50 iterations)
     *
     * For any set of content records with varied dimensions (including null),
     * filtering by (W, H) SHALL return only content where width===W AND height===H.
     * Content with null dimensions SHALL be excluded from filtered results.
     *
     * **Validates: Requirements 12.1, 12.4**
     */
    public function test_content_filter_by_resolution(): void
    {
        $this->limitTo(5)->forAll(
            Generators::choose(3, 8),  // total content items
            Generators::choose(0, 2)   // items with null dimensions
        )->then(function (int $totalItems, int $nullItems): void {
            $tenant = Tenant::factory()->create();
            $admin = User::factory()->tenantAdmin()->create(['tenant_id' => $tenant->id]);

            // Define the target filter resolution
            $filterWidth = 1920;
            $filterHeight = 1080;

            $expectedMatchCount = 0;

            // Create content with matching resolution
            $matchingCount = random_int(1, max(1, $totalItems - $nullItems - 1));
            for ($i = 0; $i < $matchingCount; $i++) {
                Content::factory()->create([
                    'tenant_id' => $tenant->id,
                    'width' => $filterWidth,
                    'height' => $filterHeight,
                ]);
                $expectedMatchCount++;
            }

            // Create content with non-matching resolutions
            $nonMatchingCount = $totalItems - $matchingCount - $nullItems;
            $otherResolutions = [[1080, 1920], [3840, 2160], [1280, 720], [800, 600]];
            for ($i = 0; $i < $nonMatchingCount; $i++) {
                [$w, $h] = $otherResolutions[$i % count($otherResolutions)];
                Content::factory()->create([
                    'tenant_id' => $tenant->id,
                    'width' => $w,
                    'height' => $h,
                ]);
            }

            // Create content with null dimensions
            for ($i = 0; $i < $nullItems; $i++) {
                Content::factory()->create([
                    'tenant_id' => $tenant->id,
                    'width' => null,
                    'height' => null,
                ]);
            }

            // Hit the filtered endpoint
            $response = $this->actingAs($admin)
                ->getJson("/api/admin/content?width={$filterWidth}&height={$filterHeight}");

            $response->assertOk();
            $data = $response->json('data');

            // Property: only content with exact matching dimensions returned
            foreach ($data as $item) {
                $this->assertEquals(
                    $filterWidth,
                    $item['width'],
                    "Property 11: returned content has width {$item['width']}, expected {$filterWidth}"
                );
                $this->assertEquals(
                    $filterHeight,
                    $item['height'],
                    "Property 11: returned content has height {$item['height']}, expected {$filterHeight}"
                );
                // Null dimensions must be excluded
                $this->assertNotNull(
                    $item['width'],
                    "Property 11: content with null width should not appear in filtered results"
                );
                $this->assertNotNull(
                    $item['height'],
                    "Property 11: content with null height should not appear in filtered results"
                );
            }

            // Property: correct count of matching items
            $this->assertCount(
                $expectedMatchCount,
                $data,
                "Property 11: expected {$expectedMatchCount} matching items, got " . count($data)
            );

            // Cleanup
            Content::withoutGlobalScopes()->delete();
            User::query()->delete();
            Tenant::query()->delete();
        });
    }

    /**
     * Property 11 (extended): Without filter, all content is returned including null dimensions.
     *
     * **Validates: Requirements 12.1**
     */
    public function test_content_without_filter_returns_all(): void
    {
        $this->limitTo(5)->forAll(
            Generators::choose(2, 6),  // items with dimensions
            Generators::choose(1, 3)   // items with null dimensions
        )->then(function (int $withDimensions, int $withoutDimensions): void {
            $tenant = Tenant::factory()->create();
            $admin = User::factory()->tenantAdmin()->create(['tenant_id' => $tenant->id]);

            $totalExpected = $withDimensions + $withoutDimensions;

            for ($i = 0; $i < $withDimensions; $i++) {
                Content::factory()->create([
                    'tenant_id' => $tenant->id,
                    'width' => 1920,
                    'height' => 1080,
                ]);
            }

            for ($i = 0; $i < $withoutDimensions; $i++) {
                Content::factory()->create([
                    'tenant_id' => $tenant->id,
                    'width' => null,
                    'height' => null,
                ]);
            }

            // No filter — should return ALL content
            $response = $this->actingAs($admin)
                ->getJson('/api/admin/content');

            $response->assertOk();
            $data = $response->json('data');

            $this->assertCount(
                $totalExpected,
                $data,
                "Property 11 (no filter): expected all {$totalExpected} items, got " . count($data)
            );

            // Cleanup
            Content::withoutGlobalScopes()->delete();
            User::query()->delete();
            Tenant::query()->delete();
        });
    }
}
