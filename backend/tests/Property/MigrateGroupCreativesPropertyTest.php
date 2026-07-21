<?php

namespace Tests\Property;

use App\Models\Content;
use App\Models\Creative;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use Eris\Generators;
use Eris\TestTrait;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Property Tests for MigrateGroupCreativesCommand.
 *
 * Property 14: Migración de grupo explota a pantallas individuales
 * Property 15: Migración corrige dimensiones null desde Content
 *
 * **Validates: Requirements 21.2, 21.3, 11.3, 21.5**
 */
class MigrateGroupCreativesPropertyTest extends TestCase
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
     * Property 14: Migración de grupo explota a pantallas individuales
     *
     * For any Creative linked to an OrderLineTarget with screen_group_id (group with N screens),
     * the migration SHALL:
     * (a) create exactly N individual creatives (one per screen), each with same content_id,
     *     weight, resolution_width, resolution_height,
     * (b) delete the original group Creative.
     *
     * **Validates: Requirements 21.2, 21.3, 11.3**
     */
    public function test_migration_explodes_group_creative_to_individual_screens(): void
    {
        $resolutions = [
            [1920, 1080],
            [1080, 1920],
            [3840, 2160],
            [1280, 720],
            [768, 1024],
        ];

        $this->limitTo(10)->forAll(
            Generators::choose(1, 6),   // number of screens in the group
            Generators::choose(1, 100), // weight
            Generators::choose(0, 4)    // resolution index
        )->then(function (int $numScreens, int $weight, int $resIdx) use ($resolutions): void {
            $res = $resolutions[$resIdx];
            $resWidth = $res[0];
            $resHeight = $res[1];

            // Setup
            $tenant = Tenant::factory()->create();
            $group = ScreenGroup::factory()->create(['tenant_id' => $tenant->id]);

            $screens = [];
            for ($i = 0; $i < $numScreens; $i++) {
                $screens[] = Screen::factory()->create([
                    'tenant_id' => $tenant->id,
                    'group_id' => $group->id,
                    'resolution_width' => $resWidth,
                    'resolution_height' => $resHeight,
                ]);
            }

            $orderLine = OrderLine::factory()->create();
            $groupTarget = OrderLineTarget::factory()->forScreenGroup($group->id)->create([
                'order_line_id' => $orderLine->id,
            ]);

            $content = Content::factory()->create([
                'tenant_id' => $tenant->id,
                'width' => $resWidth,
                'height' => $resHeight,
            ]);

            $originalCreative = Creative::factory()->create([
                'order_line_target_id' => $groupTarget->id,
                'content_id' => $content->id,
                'weight' => $weight,
                'resolution_width' => $resWidth,
                'resolution_height' => $resHeight,
            ]);

            $originalCreativeId = $originalCreative->id;

            // Execute migration
            $this->artisan('creatives:migrate-groups')->assertSuccessful();

            // (b) Original group creative should be deleted
            $this->assertDatabaseMissing('creatives', ['id' => $originalCreativeId]);

            // (a) Should have created exactly N individual creatives
            $newCreatives = Creative::where('content_id', $content->id)->get();
            $this->assertCount(
                $numScreens,
                $newCreatives,
                "Property 14: Should create exactly {$numScreens} individual creatives (one per screen in group), got {$newCreatives->count()}"
            );

            // Verify each new creative has same content_id, weight, resolution_width, resolution_height
            foreach ($newCreatives as $newCreative) {
                $this->assertEquals(
                    $content->id,
                    $newCreative->content_id,
                    "Property 14: New creative must retain same content_id"
                );
                $this->assertEquals(
                    $weight,
                    $newCreative->weight,
                    "Property 14: New creative must retain same weight ({$weight})"
                );
                $this->assertEquals(
                    $resWidth,
                    $newCreative->resolution_width,
                    "Property 14: New creative must retain same resolution_width ({$resWidth})"
                );
                $this->assertEquals(
                    $resHeight,
                    $newCreative->resolution_height,
                    "Property 14: New creative must retain same resolution_height ({$resHeight})"
                );

                // Each new creative should be linked to a screen-level target (not group)
                $target = OrderLineTarget::find($newCreative->order_line_target_id);
                $this->assertNotNull(
                    $target->screen_id,
                    "Property 14: New creative's target must have screen_id (individual screen)"
                );
                $this->assertNull(
                    $target->screen_group_id,
                    "Property 14: New creative's target must NOT have screen_group_id"
                );
            }

            // Verify the new targets reference exactly the screens from the group
            $targetScreenIds = $newCreatives
                ->map(fn ($c) => OrderLineTarget::find($c->order_line_target_id)->screen_id)
                ->sort()
                ->values()
                ->toArray();
            $expectedScreenIds = collect($screens)
                ->pluck('id')
                ->sort()
                ->values()
                ->toArray();

            $this->assertEquals(
                $expectedScreenIds,
                $targetScreenIds,
                "Property 14: New creatives should reference exactly the screens from the group"
            );

            // Cleanup for next iteration
            Creative::withoutGlobalScopes()->delete();
            OrderLineTarget::query()->delete();
            Screen::withoutGlobalScopes()->delete();
            ScreenGroup::query()->delete();
            OrderLine::query()->delete();
            Content::withoutGlobalScopes()->delete();
            Tenant::query()->delete();
        });
    }

    /**
     * Property 14 (variant): Multiple group creatives on same group all get exploded
     *
     * When multiple creatives exist on the same group target, each one produces N
     * individual creatives (one per screen) and each original is deleted.
     *
     * **Validates: Requirements 21.2, 21.3**
     */
    public function test_migration_explodes_multiple_creatives_on_same_group(): void
    {
        $this->limitTo(5)->forAll(
            Generators::choose(2, 4),  // number of screens
            Generators::choose(2, 4)   // number of creatives on the group
        )->then(function (int $numScreens, int $numCreatives): void {
            $tenant = Tenant::factory()->create();
            $group = ScreenGroup::factory()->create(['tenant_id' => $tenant->id]);

            for ($i = 0; $i < $numScreens; $i++) {
                Screen::factory()->create([
                    'tenant_id' => $tenant->id,
                    'group_id' => $group->id,
                ]);
            }

            $orderLine = OrderLine::factory()->create();
            $groupTarget = OrderLineTarget::factory()->forScreenGroup($group->id)->create([
                'order_line_id' => $orderLine->id,
            ]);

            $originalIds = [];
            $contentIds = [];
            for ($i = 0; $i < $numCreatives; $i++) {
                $content = Content::factory()->create(['tenant_id' => $tenant->id]);
                $contentIds[] = $content->id;
                $creative = Creative::factory()->create([
                    'order_line_target_id' => $groupTarget->id,
                    'content_id' => $content->id,
                    'weight' => fake()->numberBetween(1, 100),
                    'resolution_width' => 1920,
                    'resolution_height' => 1080,
                ]);
                $originalIds[] = $creative->id;
            }

            // Execute migration
            $this->artisan('creatives:migrate-groups')->assertSuccessful();

            // All original group creatives should be deleted
            foreach ($originalIds as $id) {
                $this->assertDatabaseMissing('creatives', ['id' => $id]);
            }

            // Total new creatives = numCreatives * numScreens
            $expectedTotal = $numCreatives * $numScreens;
            $totalNewCreatives = Creative::count();
            $this->assertEquals(
                $expectedTotal,
                $totalNewCreatives,
                "Property 14: Should create {$expectedTotal} total creatives ({$numCreatives} originals × {$numScreens} screens), got {$totalNewCreatives}"
            );

            // Each content should have exactly numScreens creatives
            foreach ($contentIds as $contentId) {
                $count = Creative::where('content_id', $contentId)->count();
                $this->assertEquals(
                    $numScreens,
                    $count,
                    "Property 14: Each content should have exactly {$numScreens} creatives after migration"
                );
            }

            // Cleanup for next iteration
            Creative::withoutGlobalScopes()->delete();
            OrderLineTarget::query()->delete();
            Screen::withoutGlobalScopes()->delete();
            ScreenGroup::query()->delete();
            OrderLine::query()->delete();
            Content::withoutGlobalScopes()->delete();
            Tenant::query()->delete();
        });
    }

    /**
     * Property 15: Migración corrige dimensiones null desde Content
     *
     * For any Creative with resolution_width = NULL or resolution_height = NULL that has
     * an associated Content with valid dimensions, the migration SHALL assign
     * resolution_width = content.width and resolution_height = content.height.
     *
     * **Validates: Requirements 21.5**
     */
    public function test_migration_fixes_null_resolution_from_content(): void
    {
        $resolutions = [
            [1920, 1080],
            [1080, 1920],
            [3840, 2160],
            [1280, 720],
            [768, 1024],
            [2560, 1440],
        ];

        $this->limitTo(10)->forAll(
            Generators::choose(1, 5),   // number of screens
            Generators::choose(0, 5),   // resolution index
            Generators::choose(1, 100), // weight
            Generators::choose(0, 2)    // null mode: 0=both null, 1=width null only, 2=height null only
        )->then(function (int $numScreens, int $resIdx, int $weight, int $nullMode) use ($resolutions): void {
            $res = $resolutions[$resIdx];
            $contentWidth = $res[0];
            $contentHeight = $res[1];

            $tenant = Tenant::factory()->create();
            $group = ScreenGroup::factory()->create(['tenant_id' => $tenant->id]);

            for ($i = 0; $i < $numScreens; $i++) {
                Screen::factory()->create([
                    'tenant_id' => $tenant->id,
                    'group_id' => $group->id,
                ]);
            }

            $orderLine = OrderLine::factory()->create();
            $groupTarget = OrderLineTarget::factory()->forScreenGroup($group->id)->create([
                'order_line_id' => $orderLine->id,
            ]);

            $content = Content::factory()->create([
                'tenant_id' => $tenant->id,
                'width' => $contentWidth,
                'height' => $contentHeight,
            ]);

            // Create creative with null resolution(s) depending on mode
            $creativeResWidth = ($nullMode === 0 || $nullMode === 1) ? null : $contentWidth;
            $creativeResHeight = ($nullMode === 0 || $nullMode === 2) ? null : $contentHeight;

            Creative::factory()->create([
                'order_line_target_id' => $groupTarget->id,
                'content_id' => $content->id,
                'weight' => $weight,
                'resolution_width' => $creativeResWidth,
                'resolution_height' => $creativeResHeight,
            ]);

            // Execute migration
            $this->artisan('creatives:migrate-groups')->assertSuccessful();

            // All new creatives should have resolution copied from content
            $newCreatives = Creative::where('content_id', $content->id)->get();

            $this->assertCount(
                $numScreens,
                $newCreatives,
                "Property 15: Should create {$numScreens} creatives after migration"
            );

            foreach ($newCreatives as $newCreative) {
                $this->assertEquals(
                    $contentWidth,
                    $newCreative->resolution_width,
                    "Property 15: resolution_width must be corrected to content.width ({$contentWidth}) when original was null"
                );
                $this->assertEquals(
                    $contentHeight,
                    $newCreative->resolution_height,
                    "Property 15: resolution_height must be corrected to content.height ({$contentHeight}) when original was null"
                );
            }

            // Cleanup for next iteration
            Creative::withoutGlobalScopes()->delete();
            OrderLineTarget::query()->delete();
            Screen::withoutGlobalScopes()->delete();
            ScreenGroup::query()->delete();
            OrderLine::query()->delete();
            Content::withoutGlobalScopes()->delete();
            Tenant::query()->delete();
        });
    }

    /**
     * Property 15 (variant): Creatives with valid resolution retain their values
     *
     * When a group creative already has non-null resolution_width and resolution_height,
     * the migration preserves those values (does not overwrite from content).
     *
     * **Validates: Requirements 21.5**
     */
    public function test_migration_preserves_existing_resolution_when_not_null(): void
    {
        $this->limitTo(5)->forAll(
            Generators::choose(1, 4),     // number of screens
            Generators::choose(1920, 3840), // creative resolution width (different from content)
            Generators::choose(1080, 2160)  // creative resolution height
        )->then(function (int $numScreens, int $creativeWidth, int $creativeHeight): void {
            $tenant = Tenant::factory()->create();
            $group = ScreenGroup::factory()->create(['tenant_id' => $tenant->id]);

            for ($i = 0; $i < $numScreens; $i++) {
                Screen::factory()->create([
                    'tenant_id' => $tenant->id,
                    'group_id' => $group->id,
                ]);
            }

            $orderLine = OrderLine::factory()->create();
            $groupTarget = OrderLineTarget::factory()->forScreenGroup($group->id)->create([
                'order_line_id' => $orderLine->id,
            ]);

            // Content has different dimensions than the creative
            $content = Content::factory()->create([
                'tenant_id' => $tenant->id,
                'width' => 1280,
                'height' => 720,
            ]);

            Creative::factory()->create([
                'order_line_target_id' => $groupTarget->id,
                'content_id' => $content->id,
                'weight' => 50,
                'resolution_width' => $creativeWidth,
                'resolution_height' => $creativeHeight,
            ]);

            // Execute migration
            $this->artisan('creatives:migrate-groups')->assertSuccessful();

            // New creatives should retain the original creative's resolution, not content's
            $newCreatives = Creative::where('content_id', $content->id)->get();

            foreach ($newCreatives as $newCreative) {
                $this->assertEquals(
                    $creativeWidth,
                    $newCreative->resolution_width,
                    "Property 15 (variant): When resolution_width was not null ({$creativeWidth}), it should be preserved, not overwritten by content.width"
                );
                $this->assertEquals(
                    $creativeHeight,
                    $newCreative->resolution_height,
                    "Property 15 (variant): When resolution_height was not null ({$creativeHeight}), it should be preserved, not overwritten by content.height"
                );
            }

            // Cleanup for next iteration
            Creative::withoutGlobalScopes()->delete();
            OrderLineTarget::query()->delete();
            Screen::withoutGlobalScopes()->delete();
            ScreenGroup::query()->delete();
            OrderLine::query()->delete();
            Content::withoutGlobalScopes()->delete();
            Tenant::query()->delete();
        });
    }
}
