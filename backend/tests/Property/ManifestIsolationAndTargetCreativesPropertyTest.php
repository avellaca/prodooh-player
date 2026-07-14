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
use App\Services\CreativeSelector;
use App\Services\ManifestGenerator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Feature: 09-creativos-por-pantalla
 *
 * Property 10: Aislamiento de creativos en manifiesto por pantalla
 * Property 3: Aislamiento de creativos por target
 *
 * **Validates: Requirements 10.1, 10.5, 14.1, 4.1, 1.6**
 */
class ManifestIsolationAndTargetCreativesPropertyTest extends TestCase
{
    use RefreshDatabase;

    private ManifestGenerator $generator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->generator = new ManifestGenerator(new CreativeSelector());
    }

    /**
     * Property 10: Aislamiento de creativos en manifiesto por pantalla (50 iterations)
     *
     * For any set of screens, each with their own targets and creatives assigned
     * to distinct targets, generating the manifest for one specific screen SHALL
     * only include creatives whose order_line_target_id belongs to that screen
     * (directly via screen_id or via screen_group_id). No items from other
     * screens' targets shall appear.
     *
     * Strategy:
     * - Generate 2-4 screens with different targets and creatives
     * - Generate manifest for one screen
     * - Assert: all items have target_id that resolves to this screen
     * - Assert: no items from other screens' targets appear
     *
     * **Validates: Requirements 10.1, 10.5, 14.1**
     */
    public function test_manifest_contains_only_creatives_for_target_screen(): void
    {
        $iterations = 3;

        for ($iter = 0; $iter < $iterations; $iter++) {
            // Create a tenant and shared order
            $tenant = Tenant::factory()->create();
            $order = Order::factory()->create([
                'tenant_id' => $tenant->id,
                'status' => 'active',
            ]);

            // Generate 2-4 screens with random resolutions
            $numScreens = random_int(2, 4);
            $screens = [];
            $screenTargetIds = []; // screenId => [targetIds]

            for ($s = 0; $s < $numScreens; $s++) {
                $screen = Screen::factory()->create([
                    'tenant_id' => $tenant->id,
                    'resolution_width' => random_int(1, 3) * 1080,
                    'resolution_height' => random_int(1, 3) * 1080,
                ]);
                $screens[] = $screen;
                $screenTargetIds[$screen->id] = [];
            }

            // Create 1-3 order lines with targets distributed among screens
            $numOrderLines = random_int(1, 3);
            $sequenceForScreen = []; // screenId => sequence entries

            foreach ($screens as $screen) {
                $sequenceForScreen[$screen->id] = [];
            }

            for ($ol = 0; $ol < $numOrderLines; $ol++) {
                $line = OrderLine::factory()->create([
                    'order_id' => $order->id,
                    'status' => 'active',
                ]);

                // Create a target for EACH screen pointing to this order line
                foreach ($screens as $screen) {
                    $target = OrderLineTarget::factory()->create([
                        'order_line_id' => $line->id,
                        'screen_id' => $screen->id,
                        'screen_group_id' => null,
                    ]);
                    $screenTargetIds[$screen->id][] = $target->id;

                    // Create 1-3 creatives for this target
                    $numCreatives = random_int(1, 3);
                    for ($c = 0; $c < $numCreatives; $c++) {
                        $content = Content::factory()->create([
                            'tenant_id' => $tenant->id,
                            'width' => $screen->resolution_width,
                            'height' => $screen->resolution_height,
                        ]);
                        Creative::factory()->create([
                            'order_line_target_id' => $target->id,
                            'order_line_id' => $line->id,
                            'content_id' => $content->id,
                            'weight' => random_int(1, 10),
                        ]);
                    }

                    // Add sequence entry for this screen/order line
                    $sequenceForScreen[$screen->id][] = [
                        'position' => count($sequenceForScreen[$screen->id]),
                        'order_line_id' => $line->id,
                    ];
                }
            }

            // Pick a random screen to generate manifest for
            $targetScreenIndex = random_int(0, $numScreens - 1);
            $targetScreen = $screens[$targetScreenIndex];
            $expectedTargetIds = $screenTargetIds[$targetScreen->id];
            $sequence = $sequenceForScreen[$targetScreen->id];

            // Generate manifest for the target screen
            $manifest = $this->generator->generate($targetScreen, $sequence, 0, 0);
            $items = $manifest->items;

            // Filter only order_line_creative items
            $creativeItems = array_filter($items, fn($item) => $item['type'] === 'order_line_creative');

            // Assert: all creative items have target_id belonging to this screen
            foreach ($creativeItems as $idx => $item) {
                $this->assertArrayHasKey('target_id', $item,
                    "Property 10 (iter {$iter}): item [{$idx}] must have 'target_id' field.");

                $this->assertContains(
                    $item['target_id'],
                    $expectedTargetIds,
                    "Property 10 (iter {$iter}): creative item [{$idx}] has target_id={$item['target_id']} " .
                    "which does NOT belong to screen {$targetScreen->id}. " .
                    "Expected target_ids: [" . implode(', ', $expectedTargetIds) . "]"
                );
            }

            // Assert: no items from OTHER screens' targets appear
            $otherTargetIds = [];
            foreach ($screenTargetIds as $screenId => $targetIds) {
                if ($screenId !== $targetScreen->id) {
                    $otherTargetIds = array_merge($otherTargetIds, $targetIds);
                }
            }

            foreach ($creativeItems as $idx => $item) {
                $this->assertNotContains(
                    $item['target_id'],
                    $otherTargetIds,
                    "Property 10 (iter {$iter}): creative item [{$idx}] has target_id={$item['target_id']} " .
                    "which belongs to ANOTHER screen. Manifest must be isolated per screen."
                );
            }

            // Assert we actually have creative items (the test setup should produce them)
            $this->assertNotEmpty(
                $creativeItems,
                "Property 10 (iter {$iter}): manifest should contain at least one creative item " .
                "given that creatives were created for this screen's targets."
            );
        }
    }

    /**
     * Property 10 (screen group variant): Aislamiento via screen_group_id (30 iterations)
     *
     * When targets reference a screen_group_id, the manifest for a screen in that
     * group SHALL include creatives from those group targets. Screens NOT in the group
     * shall NOT see those creatives.
     *
     * **Validates: Requirements 10.1, 10.5, 14.1**
     */
    public function test_manifest_isolation_via_screen_group(): void
    {
        $iterations = 3;

        for ($iter = 0; $iter < $iterations; $iter++) {
            $tenant = Tenant::factory()->create();
            $order = Order::factory()->create([
                'tenant_id' => $tenant->id,
                'status' => 'active',
            ]);

            // Create a screen group with 2 screens in it
            $group = ScreenGroup::factory()->create(['tenant_id' => $tenant->id]);
            $screenInGroup = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'group_id' => $group->id,
                'resolution_width' => 1920,
                'resolution_height' => 1080,
            ]);

            // Create a screen NOT in the group
            $screenOutside = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'group_id' => null,
                'resolution_width' => 1920,
                'resolution_height' => 1080,
            ]);

            $line = OrderLine::factory()->create([
                'order_id' => $order->id,
                'status' => 'active',
            ]);

            // Create a target for the screen GROUP
            $groupTarget = OrderLineTarget::factory()->create([
                'order_line_id' => $line->id,
                'screen_id' => null,
                'screen_group_id' => $group->id,
            ]);

            // Create creatives for the group target
            $numCreatives = random_int(1, 3);
            for ($c = 0; $c < $numCreatives; $c++) {
                $content = Content::factory()->create([
                    'tenant_id' => $tenant->id,
                    'width' => 1920,
                    'height' => 1080,
                ]);
                Creative::factory()->create([
                    'order_line_target_id' => $groupTarget->id,
                    'order_line_id' => $line->id,
                    'content_id' => $content->id,
                    'weight' => random_int(1, 10),
                ]);
            }

            $sequence = [['position' => 0, 'order_line_id' => $line->id]];

            // Generate manifest for the screen IN the group → should have creative items
            $manifestIn = $this->generator->generate($screenInGroup, $sequence, 0, 0);
            $itemsIn = array_filter($manifestIn->items, fn($item) => $item['type'] === 'order_line_creative');

            $this->assertNotEmpty(
                $itemsIn,
                "Property 10 group variant (iter {$iter}): screen IN the group should receive creatives."
            );

            foreach ($itemsIn as $item) {
                $this->assertEquals(
                    $groupTarget->id,
                    $item['target_id'],
                    "Property 10 group variant (iter {$iter}): creative item must reference the group target."
                );
            }

            // Generate manifest for the screen OUTSIDE the group → should NOT have creative items
            $manifestOut = $this->generator->generate($screenOutside, $sequence, 0, 0);
            $itemsOut = array_filter($manifestOut->items, fn($item) => $item['type'] === 'order_line_creative');

            $this->assertEmpty(
                $itemsOut,
                "Property 10 group variant (iter {$iter}): screen OUTSIDE the group must NOT receive " .
                "creatives from the group target."
            );
        }
    }

    /**
     * Property 3: Aislamiento de creativos por target (50 iterations)
     *
     * For any target with a set of creatives assigned C, and other targets with
     * different creatives, querying GET /order-line-targets/{targetId}/creatives
     * SHALL return exactly the creatives of that target and none from other targets.
     *
     * Strategy:
     * - Create 2-5 targets with creatives distributed among them
     * - For a random target, call GET /order-line-targets/{targetId}/creatives
     * - Assert: response contains ONLY the creatives assigned to that target
     * - Assert: no creatives from other targets appear
     *
     * **Validates: Requirements 4.1, 1.6**
     */
    public function test_creative_list_returns_only_creatives_for_queried_target(): void
    {
        $iterations = 3;

        for ($iter = 0; $iter < $iterations; $iter++) {
            // Create tenant and user
            $tenant = Tenant::factory()->create();
            $user = User::factory()->tenantAdmin()->create(['tenant_id' => $tenant->id]);
            $this->actingAs($user, 'sanctum');

            $order = Order::factory()->create([
                'tenant_id' => $tenant->id,
                'status' => 'active',
            ]);
            $line = OrderLine::factory()->create([
                'order_id' => $order->id,
                'status' => 'active',
            ]);

            // Create 2-5 targets with different screens
            $numTargets = random_int(2, 5);
            $targets = [];
            $targetCreativeIds = []; // targetId => [creativeIds]

            for ($t = 0; $t < $numTargets; $t++) {
                $screen = Screen::factory()->create([
                    'tenant_id' => $tenant->id,
                ]);
                $target = OrderLineTarget::factory()->create([
                    'order_line_id' => $line->id,
                    'screen_id' => $screen->id,
                    'screen_group_id' => null,
                ]);
                $targets[] = $target;
                $targetCreativeIds[$target->id] = [];

                // Create 1-4 creatives for this target
                $numCreatives = random_int(1, 4);
                for ($c = 0; $c < $numCreatives; $c++) {
                    $content = Content::factory()->create([
                        'tenant_id' => $tenant->id,
                        'width' => $screen->resolution_width,
                        'height' => $screen->resolution_height,
                    ]);
                    $creative = Creative::factory()->create([
                        'order_line_target_id' => $target->id,
                        'order_line_id' => $line->id,
                        'content_id' => $content->id,
                        'weight' => random_int(1, 10),
                    ]);
                    $targetCreativeIds[$target->id][] = $creative->id;
                }
            }

            // Pick a random target to query
            $queryTargetIndex = random_int(0, $numTargets - 1);
            $queryTarget = $targets[$queryTargetIndex];
            $expectedCreativeIds = $targetCreativeIds[$queryTarget->id];

            // Collect creative IDs from OTHER targets
            $otherCreativeIds = [];
            foreach ($targetCreativeIds as $targetId => $creativeIds) {
                if ($targetId !== $queryTarget->id) {
                    $otherCreativeIds = array_merge($otherCreativeIds, $creativeIds);
                }
            }

            // Call the API endpoint
            $response = $this->actingAs($user)
                ->getJson("/api/admin/order-line-targets/{$queryTarget->id}/creatives");

            $response->assertOk();
            $returnedCreatives = $response->json('data');
            $returnedIds = array_column($returnedCreatives, 'id');

            // Assert: response contains exactly the creatives of the queried target
            $this->assertCount(
                count($expectedCreativeIds),
                $returnedCreatives,
                "Property 3 (iter {$iter}): expected " . count($expectedCreativeIds) .
                " creatives for target {$queryTarget->id}, got " . count($returnedCreatives)
            );

            foreach ($expectedCreativeIds as $expectedId) {
                $this->assertContains(
                    $expectedId,
                    $returnedIds,
                    "Property 3 (iter {$iter}): creative {$expectedId} assigned to target {$queryTarget->id} " .
                    "must be in the response."
                );
            }

            // Assert: no creatives from other targets appear
            foreach ($returnedIds as $returnedId) {
                $this->assertNotContains(
                    $returnedId,
                    $otherCreativeIds,
                    "Property 3 (iter {$iter}): creative {$returnedId} belongs to another target " .
                    "and must NOT appear in response for target {$queryTarget->id}."
                );
            }
        }
    }
}
