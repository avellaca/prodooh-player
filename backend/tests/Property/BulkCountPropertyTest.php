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
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Property Test for Bulk by Resolution count correctness.
 *
 * Property 2: Bulk por resolución crea creativos solo para targets coincidentes
 *
 * For any order line with N targets assigned to screens of mixed resolutions,
 * and a bulk assignment request with resolution (W, H), the system SHALL create
 * exactly K creatives where K = number of targets whose screen has resolution (W, H).
 * The `creatives_created` response field must equal K, and `affected_screens` must
 * contain exactly K screen IDs.
 *
 * **Validates: Requirements 3.1, 3.2, 5.1**
 */
class BulkCountPropertyTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Prevent seeding — Eris TestTrait's $seed property (random seed integer)
     * conflicts with Laravel's shouldSeed() which checks property_exists($this, 'seed').
     */
    protected function shouldSeed(): bool
    {
        return false;
    }

    /**
     * Property 2: Bulk por resolución crea creativos solo para targets coincidentes (5 iterations)
     *
     * Strategy:
     * 1. Create a tenant, order, order line
     * 2. Create N screens (random 2-5) with mix of resolutions (some matching, some not)
     * 3. Create targets for each screen
     * 4. Create content matching one specific resolution
     * 5. Call POST /order-lines/{orderLineId}/creatives/bulk-by-resolution
     * 6. Verify: creatives_created equals the number of targets with matching resolution
     * 7. Verify: affected_screens contains exactly those screen IDs
     *
     * **Validates: Requirements 3.1, 3.2, 5.1**
     */
    public function test_bulk_creates_creatives_only_for_matching_resolution_targets(): void
    {
        $availableResolutions = [
            [1920, 1080],
            [1080, 1920],
            [3840, 2160],
            [1280, 720],
            [800, 600],
        ];

        for ($iteration = 0; $iteration < 5; $iteration++) {
            // Setup: tenant, order, order line, admin user
            $tenant = Tenant::factory()->create();
            $order = Order::factory()->create([
                'tenant_id' => $tenant->id,
                'starts_at' => '2025-01-01',
                'ends_at' => '2025-12-31',
            ]);
            $orderLine = OrderLine::factory()->create([
                'order_id' => $order->id,
                'starts_at' => '2025-01-10',
                'ends_at' => '2025-06-30',
            ]);
            $admin = User::factory()->superAdmin()->create();

            // Pick the target resolution (the one we'll request bulk for)
            $targetResolutionIndex = array_rand($availableResolutions);
            [$targetWidth, $targetHeight] = $availableResolutions[$targetResolutionIndex];

            // Create N screens (random 2-5) with mixed resolutions
            $totalScreens = random_int(2, 5);
            $matchingScreenIds = [];
            $allScreenIds = [];

            for ($s = 0; $s < $totalScreens; $s++) {
                // Ensure at least one matches: first screen always matches
                if ($s === 0) {
                    $width = $targetWidth;
                    $height = $targetHeight;
                } else {
                    // Randomly decide if this screen matches or not
                    $shouldMatch = (bool) random_int(0, 1);
                    if ($shouldMatch) {
                        $width = $targetWidth;
                        $height = $targetHeight;
                    } else {
                        // Pick a different resolution
                        $otherResolutions = array_filter(
                            $availableResolutions,
                            fn ($r) => $r[0] !== $targetWidth || $r[1] !== $targetHeight
                        );
                        $otherResolutions = array_values($otherResolutions);
                        [$width, $height] = $otherResolutions[array_rand($otherResolutions)];
                    }
                }

                $screen = Screen::factory()->create([
                    'tenant_id' => $tenant->id,
                    'resolution_width' => $width,
                    'resolution_height' => $height,
                ]);

                OrderLineTarget::factory()->create([
                    'order_line_id' => $orderLine->id,
                    'screen_id' => $screen->id,
                    'screen_group_id' => null,
                ]);

                $allScreenIds[] = $screen->id;

                if ($width === $targetWidth && $height === $targetHeight) {
                    $matchingScreenIds[] = $screen->id;
                }
            }

            $expectedCount = count($matchingScreenIds);

            // Create content with matching resolution
            $content = Content::factory()->create([
                'tenant_id' => $tenant->id,
                'width' => $targetWidth,
                'height' => $targetHeight,
            ]);

            // Call the bulk endpoint
            $response = $this->actingAs($admin)
                ->postJson("/api/admin/order-lines/{$orderLine->id}/creatives/bulk-by-resolution", [
                    'content_id' => $content->id,
                    'resolution_width' => $targetWidth,
                    'resolution_height' => $targetHeight,
                    'weight' => random_int(1, 100),
                    'active_dates' => ['2025-01-15', '2025-01-16'],
                ]);

            $response->assertStatus(201);

            $data = $response->json('data');

            // Property: creatives_created === K (number of targets with matching resolution)
            $this->assertEquals(
                $expectedCount,
                $data['creatives_created'],
                "Property 2 (iteration {$iteration}): creatives_created ({$data['creatives_created']}) must equal matching targets ({$expectedCount}). "
                . "Target resolution: {$targetWidth}×{$targetHeight}, total screens: {$totalScreens}"
            );

            // Property: affected_screens contains exactly K screen IDs
            $this->assertCount(
                $expectedCount,
                $data['affected_screens'],
                "Property 2 (iteration {$iteration}): affected_screens count (" . count($data['affected_screens']) . ") must equal {$expectedCount}"
            );

            // Property: affected_screens contains exactly the matching screen IDs
            foreach ($matchingScreenIds as $screenId) {
                $this->assertContains(
                    $screenId,
                    $data['affected_screens'],
                    "Property 2 (iteration {$iteration}): affected_screens must contain matching screen {$screenId}"
                );
            }

            // Property: no non-matching screen IDs appear in affected_screens
            $nonMatchingScreenIds = array_diff($allScreenIds, $matchingScreenIds);
            foreach ($nonMatchingScreenIds as $screenId) {
                $this->assertNotContains(
                    $screenId,
                    $data['affected_screens'],
                    "Property 2 (iteration {$iteration}): affected_screens must NOT contain non-matching screen {$screenId}"
                );
            }

            // Cleanup for next iteration
            Creative::withoutGlobalScopes()->delete();
            OrderLineTarget::query()->delete();
            Screen::withoutGlobalScopes()->delete();
            Content::withoutGlobalScopes()->delete();
            OrderLine::query()->delete();
            Order::query()->delete();
            User::query()->delete();
            Tenant::query()->delete();
        }
    }
}
