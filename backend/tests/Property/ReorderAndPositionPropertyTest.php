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
 * Property Tests for Reorder and New Creative Position.
 *
 * Property 4: Reordenamiento produce posiciones contiguas
 * For any list of creatives and any permutation (reorder), applying the reordering
 * SHALL assign contiguous positions 0, 1, 2, ..., N-1 in the new order.
 *
 * Property 5: Nuevo creativo en modo secuencial obtiene posición final
 * For any existing set of creatives with positions in a sequential-mode target,
 * adding a new creative SHALL assign position = max(existing_positions) + 1.
 *
 * **Validates: Requirements 9.2, 9.3**
 */
class ReorderAndPositionPropertyTest extends TestCase
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
     * Property 4: Reordenamiento produce posiciones contiguas
     *
     * For any number of creatives (1..6) and any permutation of their IDs,
     * calling the reorder endpoint SHALL assign positions 0, 1, 2, ..., N-1
     * exactly matching the order of the submitted creative_ids array.
     *
     * **Validates: Requirements 9.2**
     */
    public function test_reorder_produces_contiguous_positions(): void
    {
        $this->limitTo(10)->forAll(
            Generators::choose(2, 6),  // number of creatives to create
            Generators::choose(0, 719) // seed for shuffle permutation (6! = 720)
        )->then(function (int $numCreatives, int $shuffleSeed): void {
            // Setup: tenant, admin, order, order line, screen, target
            $tenant = Tenant::factory()->create();
            $admin = User::factory()->tenantAdmin()->create(['tenant_id' => $tenant->id]);
            $this->actingAs($admin);

            $order = Order::factory()->create(['tenant_id' => $tenant->id]);
            $orderLine = OrderLine::factory()->create([
                'order_id' => $order->id,
                'playback_mode' => 'sequential',
            ]);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'resolution_width' => 1920,
                'resolution_height' => 1080,
            ]);

            $target = OrderLineTarget::factory()->create([
                'order_line_id' => $orderLine->id,
                'screen_id' => $screen->id,
                'screen_group_id' => null,
            ]);

            // Create N creatives for this target
            $creativeIds = [];
            for ($i = 0; $i < $numCreatives; $i++) {
                $content = Content::factory()->create([
                    'tenant_id' => $tenant->id,
                    'width' => 1920,
                    'height' => 1080,
                ]);

                $creative = Creative::create([
                    'order_line_target_id' => $target->id,
                    'content_id' => $content->id,
                    'weight' => 100,
                    'position' => $i,
                ]);
                $creativeIds[] = $creative->id;
            }

            // Apply a deterministic permutation based on the shuffleSeed
            $permutedIds = $this->deterministicShuffle($creativeIds, $shuffleSeed);

            // Call the reorder endpoint
            $response = $this->actingAs($admin)
                ->postJson("/api/admin/order-line-targets/{$target->id}/creatives/reorder", [
                    'creative_ids' => $permutedIds,
                ]);

            $response->assertStatus(200);

            // PROPERTY ASSERTION 1: All positions are contiguous 0..N-1
            $creatives = Creative::where('order_line_target_id', $target->id)
                ->orderBy('position')
                ->get();

            $positions = $creatives->pluck('position')->toArray();
            $expectedPositions = range(0, $numCreatives - 1);

            $this->assertEquals(
                $expectedPositions,
                $positions,
                "Reorder must produce contiguous positions 0, 1, 2, ..., N-1. Got: " . json_encode($positions)
            );

            // PROPERTY ASSERTION 2: The order matches the submitted permutation
            foreach ($permutedIds as $expectedPosition => $creativeId) {
                $creative = Creative::find($creativeId);
                $this->assertEquals(
                    $expectedPosition,
                    $creative->position,
                    "Creative {$creativeId} should have position {$expectedPosition} but has {$creative->position}"
                );
            }

            // PROPERTY ASSERTION 3: No gaps, no duplicates in positions
            $this->assertCount(
                $numCreatives,
                array_unique($positions),
                "Positions must be unique (no duplicates)"
            );
            $this->assertEquals(
                $numCreatives - 1,
                max($positions),
                "Max position must be N-1"
            );
            $this->assertEquals(
                0,
                min($positions),
                "Min position must be 0"
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
     * Property 5: Nuevo creativo en modo secuencial obtiene posición final
     *
     * For any existing set of creatives with positions (0..N-1) in a sequential-mode
     * target, adding a new creative via the store endpoint SHALL assign
     * position = max(existing_positions) + 1.
     *
     * **Validates: Requirements 9.3**
     */
    public function test_new_creative_in_sequential_mode_gets_last_position(): void
    {
        $this->limitTo(10)->forAll(
            Generators::choose(0, 5),  // number of existing creatives (0 = empty target)
            Generators::choose(1, 3)   // number of new creatives to add sequentially
        )->then(function (int $numExisting, int $numToAdd): void {
            // Setup: tenant, admin, order, order line with sequential mode
            $tenant = Tenant::factory()->create();
            $admin = User::factory()->tenantAdmin()->create(['tenant_id' => $tenant->id]);
            $this->actingAs($admin);

            $order = Order::factory()->create(['tenant_id' => $tenant->id]);
            $orderLine = OrderLine::factory()->create([
                'order_id' => $order->id,
                'playback_mode' => 'sequential',
            ]);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'resolution_width' => 1920,
                'resolution_height' => 1080,
            ]);

            $target = OrderLineTarget::factory()->create([
                'order_line_id' => $orderLine->id,
                'screen_id' => $screen->id,
                'screen_group_id' => null,
            ]);

            // Create existing creatives with positions 0..numExisting-1
            for ($i = 0; $i < $numExisting; $i++) {
                $content = Content::factory()->create([
                    'tenant_id' => $tenant->id,
                    'width' => 1920,
                    'height' => 1080,
                ]);

                Creative::create([
                    'order_line_target_id' => $target->id,
                    'content_id' => $content->id,
                    'weight' => 100,
                    'position' => $i,
                ]);
            }

            // Add new creatives one by one via the store endpoint
            $newCreativeIds = [];
            for ($j = 0; $j < $numToAdd; $j++) {
                $newContent = Content::factory()->create([
                    'tenant_id' => $tenant->id,
                    'width' => 1920,
                    'height' => 1080,
                ]);

                $response = $this->actingAs($admin)
                    ->postJson("/api/admin/order-line-targets/{$target->id}/creatives", [
                        'content_id' => $newContent->id,
                        'weight' => 100,
                    ]);

                $response->assertStatus(201);

                $createdData = $response->json('data');
                $newCreativeIds[] = $createdData['id'];

                // PROPERTY ASSERTION: Each new creative gets position = max(existing) + 1
                $expectedPosition = $numExisting + $j;
                $this->assertEquals(
                    $expectedPosition,
                    $createdData['position'],
                    "New creative #{$j} should have position {$expectedPosition} but got {$createdData['position']}. " .
                    "Existing creatives: {$numExisting}, added so far: {$j}"
                );
            }

            // PROPERTY ASSERTION: After all additions, positions are still contiguous 0..N-1
            $allCreatives = Creative::where('order_line_target_id', $target->id)
                ->orderBy('position')
                ->get();

            $totalExpected = $numExisting + $numToAdd;
            $this->assertCount(
                $totalExpected,
                $allCreatives,
                "Total creatives should be {$totalExpected}"
            );

            $positions = $allCreatives->pluck('position')->toArray();
            $expectedPositions = range(0, $totalExpected - 1);
            $this->assertEquals(
                $expectedPositions,
                $positions,
                "All positions must be contiguous after additions: expected " .
                json_encode($expectedPositions) . " got " . json_encode($positions)
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
     * Produces a deterministic permutation of the array based on a seed.
     * Uses Fisher-Yates shuffle with seeded random.
     */
    private function deterministicShuffle(array $items, int $seed): array
    {
        $result = $items;
        $n = count($result);

        // Use the seed to create a deterministic permutation
        mt_srand($seed);
        for ($i = $n - 1; $i > 0; $i--) {
            $j = mt_rand(0, $i);
            [$result[$i], $result[$j]] = [$result[$j], $result[$i]];
        }
        // Reset random state
        mt_srand();

        return $result;
    }
}
