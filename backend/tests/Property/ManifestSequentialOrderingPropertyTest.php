<?php

namespace Tests\Property;

use App\Models\Content;
use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\Tenant;
use App\Services\LoopTemplateGeneratorInterface;
use Eris\Generators;
use Eris\TestTrait;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Property Test: Manifest secuencial ordena candidatos por position (Property 3)
 *
 * For any screen whose effective mode is "sequential" and with creatives assigned,
 * the generated manifest SHALL contain:
 * (a) strategy: 'sequential' in the slot, and
 * (b) candidates ordered ascending by position (nulls last).
 *
 * **Validates: Requirements 10.1, 10.2, 10.3**
 */
class ManifestSequentialOrderingPropertyTest extends TestCase
{
    use RefreshDatabase, TestTrait;

    private LoopTemplateGeneratorInterface $generator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->generator = $this->app->make(LoopTemplateGeneratorInterface::class);
    }

    /**
     * Prevent seeding — Eris TestTrait's $seed property conflicts with Laravel's shouldSeed().
     */
    protected function shouldSeed(): bool
    {
        return false;
    }

    /**
     * Helper: clean up all test data in correct order.
     */
    private function cleanupTestData(): void
    {
        \App\Models\ScreenManifest::query()->delete();
        Creative::query()->delete();
        OrderLineTarget::query()->delete();
        Screen::withoutGlobalScopes()->delete();
        OrderLine::withoutEvents(function () {
            OrderLine::query()->forceDelete();
        });
        \App\Models\AuditLog::query()->delete();
        Order::withoutGlobalScopes()->delete();
        Content::withoutGlobalScopes()->delete();
        Tenant::query()->delete();
    }

    /**
     * Property 3: Sequential manifest contains strategy 'sequential' and candidates ordered by position ASC (nulls last).
     *
     * For any randomized set of creatives with varied positions (including nulls),
     * when the effective playback mode is 'sequential', the generated manifest slot SHALL:
     * (a) have strategy = 'sequential'
     * (b) list candidates in ascending order by their Creative's position field, with null positions at the end
     *
     * **Validates: Requirements 10.1, 10.2, 10.3**
     */
    public function test_sequential_manifest_orders_candidates_by_position_asc_nulls_last(): void
    {
        $this->limitTo(10)->forAll(
            // Generate between 2 and 8 creatives per iteration
            Generators::choose(2, 8)
        )->then(function (int $numCreatives): void {
            $tenant = Tenant::factory()->create([
                'num_slots' => 5,
                'ssp_slots' => 1,
                'playlist_slots' => 1,
                'default_duration_seconds' => 10,
            ]);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
            ]);

            $order = Order::factory()->create([
                'tenant_id' => $tenant->id,
                'status' => 'active',
            ]);

            $line = OrderLine::withoutEvents(function () use ($order) {
                return OrderLine::factory()->create([
                    'order_id' => $order->id,
                    'priority_tier' => 'patrocinio',
                    'delivery_pace' => 'uniform',
                    'status' => 'active',
                    'starts_at' => now()->subDays(1),
                    'ends_at' => now()->addDays(10),
                    'slots_purchased' => 1,
                    'playback_mode' => 'sequential',
                ]);
            });

            $target = OrderLineTarget::withoutEvents(function () use ($line, $screen) {
                return OrderLineTarget::factory()->create([
                    'order_line_id' => $line->id,
                    'screen_id' => $screen->id,
                    'screen_group_id' => null,
                ]);
            });

            // Generate randomized positions: some integers, some nulls
            // Create a shuffled array of positions to assign randomly
            $positions = [];
            for ($i = 0; $i < $numCreatives; $i++) {
                // ~25% chance of null position
                if (rand(0, 3) === 0) {
                    $positions[] = null;
                } else {
                    $positions[] = rand(0, 50);
                }
            }

            // Shuffle positions to ensure creation order is random
            shuffle($positions);

            // Create creatives without triggering observer side-effects (which dispatch regeneration jobs)
            $creativeIds = [];
            $creativePositions = [];
            Creative::withoutEvents(function () use ($numCreatives, $positions, $target, $tenant, &$creativeIds, &$creativePositions) {
                for ($i = 0; $i < $numCreatives; $i++) {
                    $content = Content::factory()->create(['tenant_id' => $tenant->id]);
                    $creative = Creative::factory()->create([
                        'order_line_target_id' => $target->id,
                        'content_id' => $content->id,
                        'position' => $positions[$i],
                    ]);
                    $creativeIds[] = $creative->id;
                    $creativePositions[$creative->id] = $positions[$i];
                }
            });

            // Generate the manifest
            $manifest = $this->generator->generate($screen);
            $slots = $manifest->items['slots'];

            // Find the ad slot with candidates (should be position 0)
            $adSlot = collect($slots)->first(fn($s) => $s['type'] === 'ad' && !empty($s['candidates']));

            $this->assertNotNull($adSlot, 'There should be at least one ad slot with candidates');

            // PROPERTY (a): strategy must be 'sequential'
            $this->assertEquals(
                'sequential',
                $adSlot['strategy'],
                "When playback_mode is 'sequential', slot strategy must be 'sequential'"
            );

            // PROPERTY (b): candidates must be ordered by position ASC, nulls last
            $this->assertCount(
                $numCreatives,
                $adSlot['candidates'],
                "All creatives should appear in the manifest candidates"
            );

            $candidateCreativeIds = array_map(fn($c) => $c['creative_id'], $adSlot['candidates']);

            // Verify ordering: extract positions in manifest order and check they are sorted
            $manifestPositions = array_map(
                fn($cId) => $creativePositions[$cId],
                $candidateCreativeIds
            );

            // Check that non-null positions come first and are in ascending order,
            // and null positions come last
            $nonNullPositions = array_filter($manifestPositions, fn($p) => $p !== null);
            $nullCount = count(array_filter($manifestPositions, fn($p) => $p === null));

            // Non-null positions should appear first in the manifest
            $nonNullFromManifest = array_slice($manifestPositions, 0, count($nonNullPositions));
            $nullsFromManifest = array_slice($manifestPositions, count($nonNullPositions));

            // All items in the first part should be non-null
            foreach ($nonNullFromManifest as $idx => $pos) {
                $this->assertNotNull(
                    $pos,
                    "Position at index {$idx} should be non-null (nulls should be at the end)"
                );
            }

            // All items in the last part should be null
            foreach ($nullsFromManifest as $idx => $pos) {
                $this->assertNull(
                    $pos,
                    "Position at tail index {$idx} should be null (nulls last)"
                );
            }

            // Non-null positions should be in ascending order
            $sortedNonNull = $nonNullFromManifest;
            sort($sortedNonNull);
            $this->assertEquals(
                $sortedNonNull,
                $nonNullFromManifest,
                "Non-null positions must be in ascending order. Got: "
                . implode(', ', $nonNullFromManifest) . " Expected: " . implode(', ', $sortedNonNull)
            );

            // Verify the count of nulls at end matches expected
            $this->assertEquals(
                $nullCount,
                count($nullsFromManifest),
                "Number of null positions at end must match total null positions"
            );

            $this->cleanupTestData();
        });
    }

    /**
     * Property 3 (variant): Target override to sequential also produces ordered manifest.
     *
     * When the OrderLine is round_robin but the target has playback_mode_override = 'sequential',
     * the manifest SHALL still produce strategy 'sequential' with ordered candidates.
     *
     * **Validates: Requirements 10.1, 10.2, 10.3**
     */
    public function test_target_override_sequential_also_produces_ordered_manifest(): void
    {
        $this->limitTo(8)->forAll(
            Generators::choose(2, 6)
        )->then(function (int $numCreatives): void {
            $tenant = Tenant::factory()->create([
                'num_slots' => 5,
                'ssp_slots' => 1,
                'playlist_slots' => 1,
                'default_duration_seconds' => 10,
            ]);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
            ]);

            $order = Order::factory()->create([
                'tenant_id' => $tenant->id,
                'status' => 'active',
            ]);

            // OrderLine is round_robin, but target overrides to sequential
            $line = OrderLine::withoutEvents(function () use ($order) {
                return OrderLine::factory()->create([
                    'order_id' => $order->id,
                    'priority_tier' => 'patrocinio',
                    'delivery_pace' => 'uniform',
                    'status' => 'active',
                    'starts_at' => now()->subDays(1),
                    'ends_at' => now()->addDays(10),
                    'slots_purchased' => 1,
                    'playback_mode' => 'round_robin',
                ]);
            });

            $target = OrderLineTarget::withoutEvents(function () use ($line, $screen) {
                return OrderLineTarget::factory()->create([
                    'order_line_id' => $line->id,
                    'screen_id' => $screen->id,
                    'screen_group_id' => null,
                    'playback_mode_override' => 'sequential',
                ]);
            });

            // Create creatives with sequential positions (0, 1, 2, ...) but insert in reverse
            $creatives = [];
            Creative::withoutEvents(function () use ($numCreatives, $target, $tenant, &$creatives) {
                for ($i = $numCreatives - 1; $i >= 0; $i--) {
                    $content = Content::factory()->create(['tenant_id' => $tenant->id]);
                    $creative = Creative::factory()->create([
                        'order_line_target_id' => $target->id,
                        'content_id' => $content->id,
                        'position' => $i,
                    ]);
                    $creatives[$i] = $creative;
                }
            });

            // Generate manifest
            $manifest = $this->generator->generate($screen);
            $slots = $manifest->items['slots'];

            $adSlot = collect($slots)->first(fn($s) => $s['type'] === 'ad' && !empty($s['candidates']));
            $this->assertNotNull($adSlot);

            // PROPERTY (a): strategy must be 'sequential'
            $this->assertEquals(
                'sequential',
                $adSlot['strategy'],
                "Target override to 'sequential' must produce strategy 'sequential' in manifest"
            );

            // PROPERTY (b): candidates ordered by position ascending
            $this->assertCount($numCreatives, $adSlot['candidates']);

            // Verify order matches position 0, 1, 2, ..., N-1
            for ($i = 0; $i < $numCreatives; $i++) {
                $this->assertEquals(
                    $creatives[$i]->id,
                    $adSlot['candidates'][$i]['creative_id'],
                    "Candidate at index {$i} should be creative with position {$i}"
                );
            }

            $this->cleanupTestData();
        });
    }
}
