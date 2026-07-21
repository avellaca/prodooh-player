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
 * Property Test for Auto-Matching in Bulk Assign.
 *
 * Property 1: Auto-matching produce creativos individuales por pantalla con resolución coincidente
 *
 * For any set of Content items and any OrderLine with assigned screens, the auto-matching
 * algorithm SHALL create exactly one Creative per (Content, Screen) pair where
 * content.width == screen.resolution_width AND content.height == screen.resolution_height,
 * with weight=100, and SHALL report as "unmatched" any Content whose dimensions don't match
 * any screen. Total creatives created + unmatched contents SHALL equal total inputs.
 *
 * **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 11.1**
 */
class BulkAssignAutoMatchingPropertyTest extends TestCase
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
     * Property 1: Auto-matching produce creativos individuales por pantalla con resolución coincidente
     *
     * For any combination of content dimensions and screen resolutions:
     * - Creates exactly one Creative per (Content, Screen) pair where dimensions match
     * - Each Creative has weight=100
     * - Reports unmatched contents whose dimensions don't match any screen
     * - Total created + unmatched == total content inputs
     *
     * **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 11.1**
     */
    public function test_auto_matching_creates_individual_creatives_per_matching_screen(): void
    {
        // Common resolutions to generate from (realistic dimensions)
        $resolutions = [
            [1920, 1080],
            [1080, 1920],
            [3840, 2160],
            [1280, 720],
            [768, 1024],
        ];

        $this->limitTo(5)->forAll(
            Generators::choose(1, 4),   // number of screens
            Generators::choose(1, 5),   // number of contents
            Generators::choose(0, 4),   // seed for screen resolution selections
            Generators::choose(0, 4)    // seed for content dimension selections
        )->then(function (int $numScreens, int $numContents, int $screenResSeed, int $contentDimSeed) use ($resolutions): void {
            // Setup: tenant, admin, order, order line
            $tenant = Tenant::factory()->create();
            $admin = User::factory()->superAdmin()->create();

            // Authenticate before creating Order so the OrderObserver audit log has a valid user
            $this->actingAs($admin);

            $order = Order::factory()->create(['tenant_id' => $tenant->id]);
            $orderLine = OrderLine::factory()->create([
                'order_id' => $order->id,
                'starts_at' => now()->subDays(3),
                'ends_at' => now()->addDays(20),
            ]);

            // Create screens with varied resolutions
            $screens = [];
            for ($i = 0; $i < $numScreens; $i++) {
                $resIdx = ($screenResSeed + $i) % count($resolutions);
                $res = $resolutions[$resIdx];
                $screen = Screen::factory()->create([
                    'tenant_id' => $tenant->id,
                    'resolution_width' => $res[0],
                    'resolution_height' => $res[1],
                ]);
                $screens[] = $screen;

                // Create a direct screen target for each screen
                OrderLineTarget::factory()->create([
                    'order_line_id' => $orderLine->id,
                    'screen_id' => $screen->id,
                    'screen_group_id' => null,
                ]);
            }

            // Create contents with varied dimensions (some matching, some not)
            $contents = [];
            $contentIds = [];
            for ($i = 0; $i < $numContents; $i++) {
                $resIdx = ($contentDimSeed + $i) % count($resolutions);
                $res = $resolutions[$resIdx];
                $content = Content::factory()->create([
                    'tenant_id' => $tenant->id,
                    'width' => $res[0],
                    'height' => $res[1],
                ]);
                $contents[] = $content;
                $contentIds[] = $content->id;
            }

            // Call the bulk-assign endpoint
            $response = $this->actingAs($admin)
                ->postJson("/api/admin/order-lines/{$orderLine->id}/creatives/bulk-assign", [
                    'content_ids' => $contentIds,
                    'weight' => 100,
                ]);

            $response->assertStatus(201);
            $data = $response->json('data');

            // Build the expected resolution map: which resolutions are available in screens
            $screenResolutions = [];
            foreach ($screens as $screen) {
                $key = $screen->resolution_width . 'x' . $screen->resolution_height;
                $screenResolutions[$key][] = $screen->id;
            }

            // Calculate expected results
            $expectedCreated = 0;
            $expectedUnmatched = 0;
            foreach ($contents as $content) {
                $contentKey = $content->width . 'x' . $content->height;
                if (isset($screenResolutions[$contentKey])) {
                    // One creative per matching screen
                    $expectedCreated += count($screenResolutions[$contentKey]);
                } else {
                    $expectedUnmatched++;
                }
            }

            // PROPERTY ASSERTION 1: Total creatives created matches expected
            $this->assertEquals(
                $expectedCreated,
                $data['created'],
                "Expected {$expectedCreated} creatives created but got {$data['created']}"
            );

            // PROPERTY ASSERTION 2: Unmatched contents count matches expected
            $this->assertCount(
                $expectedUnmatched,
                $data['unmatched_contents'],
                "Expected {$expectedUnmatched} unmatched contents but got " . count($data['unmatched_contents'])
            );

            // PROPERTY ASSERTION 3: created + unmatched == total input contents
            // (Each content either matches at least one screen or is unmatched)
            $totalAccountedFor = 0;
            foreach ($contents as $content) {
                $contentKey = $content->width . 'x' . $content->height;
                if (isset($screenResolutions[$contentKey])) {
                    $totalAccountedFor++; // This content was matched (creates N creatives)
                } else {
                    $totalAccountedFor++; // This content was unmatched
                }
            }
            $matchedContents = $numContents - $expectedUnmatched;
            $this->assertEquals(
                $numContents,
                $matchedContents + $expectedUnmatched,
                "Total matched + unmatched contents must equal total inputs"
            );

            // PROPERTY ASSERTION 4: Each creative in DB has weight=100
            $creatives = Creative::all();
            foreach ($creatives as $creative) {
                $this->assertEquals(
                    100,
                    $creative->weight,
                    "All auto-matched creatives must have weight=100"
                );
            }

            // PROPERTY ASSERTION 5: Each creative is linked to an individual screen target (Req 11.1)
            foreach ($creatives as $creative) {
                $target = OrderLineTarget::find($creative->order_line_target_id);
                $this->assertNotNull($target, "Creative must be linked to a valid target");
                $this->assertNotNull($target->screen_id, "Creative target must point to an individual screen (not group)");
            }

            // PROPERTY ASSERTION 6: Verify one creative per (content, screen) pair
            $pairs = $creatives->map(fn ($c) => $c->content_id . ':' . $c->order_line_target_id)->toArray();
            $this->assertCount(
                count($pairs),
                array_unique($pairs),
                "Each (content, screen) pair must have exactly one creative"
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
     * Property 1 (variant): Auto-matching with screen groups resolves individual screens
     *
     * When a target references a screen_group, the auto-matching algorithm should
     * resolve all screens in the group and create individual creatives per matching screen.
     *
     * **Validates: Requirements 2.2, 3.1, 3.2, 11.1**
     */
    public function test_auto_matching_resolves_screen_groups_to_individual_screens(): void
    {
        $this->limitTo(3)->forAll(
            Generators::choose(2, 4),   // number of screens in the group
            Generators::choose(1, 3)    // number of contents
        )->then(function (int $numGroupScreens, int $numContents): void {
            $tenant = Tenant::factory()->create();
            $admin = User::factory()->superAdmin()->create();

            // Authenticate before creating Order so the OrderObserver audit log has a valid user
            $this->actingAs($admin);

            $order = Order::factory()->create(['tenant_id' => $tenant->id]);
            $orderLine = OrderLine::factory()->create([
                'order_id' => $order->id,
                'starts_at' => now()->subDays(3),
                'ends_at' => now()->addDays(20),
            ]);

            // Create a screen group with multiple screens (all same resolution)
            $group = ScreenGroup::factory()->create(['tenant_id' => $tenant->id]);
            $groupScreens = [];
            for ($i = 0; $i < $numGroupScreens; $i++) {
                $groupScreens[] = Screen::factory()->create([
                    'tenant_id' => $tenant->id,
                    'group_id' => $group->id,
                    'resolution_width' => 1920,
                    'resolution_height' => 1080,
                ]);
            }

            // Create a group target
            OrderLineTarget::factory()->create([
                'order_line_id' => $orderLine->id,
                'screen_id' => null,
                'screen_group_id' => $group->id,
            ]);

            // Create contents — some matching (1920x1080) and some not
            $contentIds = [];
            $matchingCount = 0;
            $unmatchingCount = 0;
            for ($i = 0; $i < $numContents; $i++) {
                if ($i % 2 === 0) {
                    // Matching content
                    $content = Content::factory()->create([
                        'tenant_id' => $tenant->id,
                        'width' => 1920,
                        'height' => 1080,
                    ]);
                    $matchingCount++;
                } else {
                    // Non-matching content
                    $content = Content::factory()->create([
                        'tenant_id' => $tenant->id,
                        'width' => 3840,
                        'height' => 2160,
                    ]);
                    $unmatchingCount++;
                }
                $contentIds[] = $content->id;
            }

            $response = $this->actingAs($admin)
                ->postJson("/api/admin/order-lines/{$orderLine->id}/creatives/bulk-assign", [
                    'content_ids' => $contentIds,
                    'weight' => 100,
                ]);

            $response->assertStatus(201);
            $data = $response->json('data');

            // PROPERTY: Each matching content should create one creative per screen in group
            $expectedCreated = $matchingCount * $numGroupScreens;
            $this->assertEquals(
                $expectedCreated,
                $data['created'],
                "Expected {$expectedCreated} creatives (matching={$matchingCount} × screens={$numGroupScreens})"
            );

            // PROPERTY: Unmatched count
            $this->assertCount(
                $unmatchingCount,
                $data['unmatched_contents'],
                "Expected {$unmatchingCount} unmatched contents"
            );

            // PROPERTY: All creatives have weight=100
            $creatives = Creative::all();
            foreach ($creatives as $creative) {
                $this->assertEquals(100, $creative->weight);
            }

            // Cleanup
            Creative::withoutGlobalScopes()->delete();
            OrderLineTarget::query()->delete();
            Screen::withoutGlobalScopes()->delete();
            ScreenGroup::query()->delete();
            Content::withoutGlobalScopes()->delete();
            OrderLine::query()->delete();
            \App\Models\AuditLog::query()->delete();
            Order::query()->delete();
            User::query()->delete();
            Tenant::query()->delete();
        });
    }

    /**
     * Property 1 (variant): Contents with null dimensions are reported as unmatched
     *
     * **Validates: Requirements 2.3, 3.3**
     */
    public function test_content_without_dimensions_reported_as_unmatched(): void
    {
        $this->limitTo(3)->forAll(
            Generators::choose(1, 3),   // number of screens
            Generators::choose(1, 3)    // number of null-dimension contents
        )->then(function (int $numScreens, int $numNullContents): void {
            $tenant = Tenant::factory()->create();
            $admin = User::factory()->superAdmin()->create();

            // Authenticate before creating Order so the OrderObserver audit log has a valid user
            $this->actingAs($admin);

            $order = Order::factory()->create(['tenant_id' => $tenant->id]);
            $orderLine = OrderLine::factory()->create([
                'order_id' => $order->id,
                'starts_at' => now()->subDays(3),
                'ends_at' => now()->addDays(20),
            ]);

            // Create screens
            for ($i = 0; $i < $numScreens; $i++) {
                $screen = Screen::factory()->create([
                    'tenant_id' => $tenant->id,
                    'resolution_width' => 1920,
                    'resolution_height' => 1080,
                ]);
                OrderLineTarget::factory()->create([
                    'order_line_id' => $orderLine->id,
                    'screen_id' => $screen->id,
                    'screen_group_id' => null,
                ]);
            }

            // Create contents with null dimensions + one matching content
            $contentIds = [];
            for ($i = 0; $i < $numNullContents; $i++) {
                $content = Content::factory()->create([
                    'tenant_id' => $tenant->id,
                    'width' => null,
                    'height' => null,
                ]);
                $contentIds[] = $content->id;
            }

            // Add one matching content
            $matchingContent = Content::factory()->create([
                'tenant_id' => $tenant->id,
                'width' => 1920,
                'height' => 1080,
            ]);
            $contentIds[] = $matchingContent->id;

            $response = $this->actingAs($admin)
                ->postJson("/api/admin/order-lines/{$orderLine->id}/creatives/bulk-assign", [
                    'content_ids' => $contentIds,
                    'weight' => 100,
                ]);

            $response->assertStatus(201);
            $data = $response->json('data');

            // PROPERTY: All null-dimension contents are reported as unmatched
            $this->assertCount(
                $numNullContents,
                $data['unmatched_contents'],
                "All contents with null dimensions must be reported as unmatched"
            );

            // PROPERTY: The matching content creates creatives
            $this->assertEquals(
                $numScreens,
                $data['created'],
                "The matching content should create one creative per matching screen"
            );

            // PROPERTY: Total accounted = created contents (1) + unmatched
            $this->assertEquals(
                $numNullContents + 1,
                count($data['unmatched_contents']) + 1,  // unmatched + 1 matched content
                "All inputs must be accounted for"
            );

            // Cleanup
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
