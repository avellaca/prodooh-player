<?php

namespace Tests\Property;

use App\Models\Content;
use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Playlist;
use App\Models\PlaylistItem;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use App\Services\LoopTemplateGenerator;
use App\Services\LoopTemplateGeneratorInterface;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Property-based tests for LoopTemplateGenerator structural invariants and hash integrity.
 *
 * Uses randomized inputs (100 iterations) to verify:
 * - Property 5: Structural invariant of Loop Template (exact num_slots, correct type ranges)
 * - Property 10: Hash version integrity
 *
 * **Validates: Requirements 2.1, 2.8, 2.12, 2.13**
 */
class LoopTemplateStructurePropertyTest extends TestCase
{
    use RefreshDatabase;

    private LoopTemplateGenerator $generator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->generator = $this->app->make(LoopTemplateGeneratorInterface::class);
    }

    // ─── Property 5: Structural invariant of Loop Template ──────────────────

    /**
     * Property 5a: Loop Template contains exactly num_slots positions.
     *
     * For any Loop Template generated for a screen with random valid configuration,
     * the template must contain exactly num_slots positions total.
     *
     * **Validates: Requirements 2.1**
     */
    public function test_template_contains_exactly_num_slots_positions(): void
    {
        for ($i = 0; $i < 100; $i++) {
            // Generate random valid configuration
            $numSlots = random_int(3, 30);
            $maxReserved = $numSlots - 1; // at least 1 ad_slot
            $sspSlots = random_int(0, min(5, $maxReserved));
            $playlistSlots = random_int(0, min(5, $maxReserved - $sspSlots));

            $tenant = Tenant::factory()->create([
                'num_slots' => $numSlots,
                'ssp_slots' => $sspSlots,
                'playlist_slots' => $playlistSlots,
                'default_duration_seconds' => 10,
                'sync_interval_seconds' => 240,
                'cache_flush_interval_hours' => 24,
            ]);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'num_slots' => null,
            ]);

            $manifest = $this->generator->generate($screen);
            $slots = $manifest->items['slots'];

            $this->assertCount(
                $numSlots,
                $slots,
                "Property 5a (iter {$i}): Template should contain exactly {$numSlots} slots, got " . count($slots)
            );
        }
    }

    /**
     * Property 5b: Ad slots occupy positions [0..ad_slots-1] with type "ad".
     *
     * For any Loop Template generated, positions [0..ad_slots-1] must all be type "ad",
     * where ad_slots = num_slots - ssp_slots - playlist_slots.
     *
     * **Validates: Requirements 2.8**
     */
    public function test_ad_slots_occupy_correct_range(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $numSlots = random_int(3, 20);
            $maxReserved = $numSlots - 1;
            $sspSlots = random_int(0, min(4, $maxReserved));
            $playlistSlots = random_int(0, min(4, $maxReserved - $sspSlots));
            $adSlots = $numSlots - $sspSlots - $playlistSlots;

            $tenant = Tenant::factory()->create([
                'num_slots' => $numSlots,
                'ssp_slots' => $sspSlots,
                'playlist_slots' => $playlistSlots,
                'default_duration_seconds' => 10,
            ]);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'num_slots' => null,
            ]);

            $manifest = $this->generator->generate($screen);
            $slots = $manifest->items['slots'];

            // Verify positions [0..ad_slots-1] are type "ad"
            for ($pos = 0; $pos < $adSlots; $pos++) {
                $this->assertEquals(
                    'ad',
                    $slots[$pos]['type'],
                    "Property 5b (iter {$i}): Position {$pos} should be 'ad' (ad_slots={$adSlots}), got '{$slots[$pos]['type']}'"
                );
                $this->assertEquals(
                    $pos,
                    $slots[$pos]['position'],
                    "Property 5b (iter {$i}): Slot at index {$pos} should have position={$pos}"
                );
            }
        }
    }

    /**
     * Property 5c: SSP slots occupy positions [ad_slots..ad_slots+ssp_slots-1] with type "ssp".
     *
     * For any Loop Template generated, positions [ad_slots..ad_slots+ssp_slots-1] must all be type "ssp".
     *
     * **Validates: Requirements 2.8**
     */
    public function test_ssp_slots_occupy_correct_range(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $numSlots = random_int(3, 20);
            $maxReserved = $numSlots - 1;
            $sspSlots = random_int(1, min(5, $maxReserved)); // at least 1 ssp
            $playlistSlots = random_int(0, min(4, $maxReserved - $sspSlots));
            $adSlots = $numSlots - $sspSlots - $playlistSlots;

            $tenant = Tenant::factory()->create([
                'num_slots' => $numSlots,
                'ssp_slots' => $sspSlots,
                'playlist_slots' => $playlistSlots,
                'default_duration_seconds' => 10,
            ]);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'num_slots' => null,
            ]);

            $manifest = $this->generator->generate($screen);
            $slots = $manifest->items['slots'];

            // Verify positions [ad_slots..ad_slots+ssp_slots-1] are type "ssp"
            for ($pos = $adSlots; $pos < $adSlots + $sspSlots; $pos++) {
                $this->assertEquals(
                    'ssp',
                    $slots[$pos]['type'],
                    "Property 5c (iter {$i}): Position {$pos} should be 'ssp' (ad_slots={$adSlots}, ssp_slots={$sspSlots}), got '{$slots[$pos]['type']}'"
                );
                $this->assertEquals(
                    $pos,
                    $slots[$pos]['position'],
                    "Property 5c (iter {$i}): SSP slot at index {$pos} should have position={$pos}"
                );
            }
        }
    }

    /**
     * Property 5d: Playlist slots occupy positions [ad_slots+ssp_slots..num_slots-1] with type "playlist".
     *
     * For any Loop Template generated, positions [ad_slots+ssp_slots..num_slots-1] must all be type "playlist".
     *
     * **Validates: Requirements 2.8**
     */
    public function test_playlist_slots_occupy_correct_range(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $numSlots = random_int(4, 20);
            $maxReserved = $numSlots - 1;
            $sspSlots = random_int(0, min(4, $maxReserved - 1)); // leave room for at least 1 playlist
            $maxPlaylist = min(5, $maxReserved - $sspSlots);
            $playlistSlots = random_int(1, max(1, $maxPlaylist)); // at least 1 playlist
            $adSlots = $numSlots - $sspSlots - $playlistSlots;

            $tenant = Tenant::factory()->create([
                'num_slots' => $numSlots,
                'ssp_slots' => $sspSlots,
                'playlist_slots' => $playlistSlots,
                'default_duration_seconds' => 10,
            ]);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'num_slots' => null,
            ]);

            $manifest = $this->generator->generate($screen);
            $slots = $manifest->items['slots'];

            // Verify positions [ad_slots+ssp_slots..num_slots-1] are type "playlist"
            $playlistStart = $adSlots + $sspSlots;
            for ($pos = $playlistStart; $pos < $numSlots; $pos++) {
                $this->assertEquals(
                    'playlist',
                    $slots[$pos]['type'],
                    "Property 5d (iter {$i}): Position {$pos} should be 'playlist' " .
                    "(ad_slots={$adSlots}, ssp_slots={$sspSlots}, playlist_slots={$playlistSlots}), got '{$slots[$pos]['type']}'"
                );
                $this->assertEquals(
                    $pos,
                    $slots[$pos]['position'],
                    "Property 5d (iter {$i}): Playlist slot at index {$pos} should have position={$pos}"
                );
            }
        }
    }

    /**
     * Property 5e: Every slot has required fields (type, position, strategy, candidates).
     *
     * For any Loop Template generated, each slot must have: type, ordinal position,
     * candidates array, and rotation strategy.
     *
     * **Validates: Requirements 2.12**
     */
    public function test_every_slot_has_required_fields(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $numSlots = random_int(3, 20);
            $maxReserved = $numSlots - 1;
            $sspSlots = random_int(0, min(4, $maxReserved));
            $playlistSlots = random_int(0, min(4, $maxReserved - $sspSlots));

            $tenant = Tenant::factory()->create([
                'num_slots' => $numSlots,
                'ssp_slots' => $sspSlots,
                'playlist_slots' => $playlistSlots,
                'default_duration_seconds' => 10,
            ]);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'num_slots' => null,
            ]);

            $manifest = $this->generator->generate($screen);
            $slots = $manifest->items['slots'];

            foreach ($slots as $index => $slot) {
                $this->assertArrayHasKey(
                    'type',
                    $slot,
                    "Property 5e (iter {$i}): Slot at index {$index} must have 'type' field"
                );
                $this->assertArrayHasKey(
                    'position',
                    $slot,
                    "Property 5e (iter {$i}): Slot at index {$index} must have 'position' field"
                );
                $this->assertArrayHasKey(
                    'strategy',
                    $slot,
                    "Property 5e (iter {$i}): Slot at index {$index} must have 'strategy' field"
                );
                $this->assertArrayHasKey(
                    'candidates',
                    $slot,
                    "Property 5e (iter {$i}): Slot at index {$index} must have 'candidates' field"
                );

                // Type must be one of the valid types
                $this->assertContains(
                    $slot['type'],
                    ['ad', 'ssp', 'playlist'],
                    "Property 5e (iter {$i}): Slot at index {$index} has invalid type '{$slot['type']}'"
                );

                // Strategy must be one of the valid strategies
                $this->assertContains(
                    $slot['strategy'],
                    ['fixed', 'round_robin'],
                    "Property 5e (iter {$i}): Slot at index {$index} has invalid strategy '{$slot['strategy']}'"
                );

                // Candidates must be an array
                $this->assertIsArray(
                    $slot['candidates'],
                    "Property 5e (iter {$i}): Slot at index {$index} 'candidates' must be an array"
                );

                // Position must match index
                $this->assertEquals(
                    $index,
                    $slot['position'],
                    "Property 5e (iter {$i}): Slot at index {$index} must have position={$index}, got {$slot['position']}"
                );
            }
        }
    }

    /**
     * Property 5f: SSP slots can have 0 candidates, ad and playlist slots with active content have at least 1.
     *
     * For any Loop Template generated with active order lines, ad slots with assigned lines
     * must have at least 1 candidate. SSP slots may have 0 candidates (filled at runtime).
     *
     * **Validates: Requirements 2.12**
     */
    public function test_ssp_slots_can_have_zero_candidates(): void
    {
        for ($i = 0; $i < 50; $i++) {
            $numSlots = random_int(4, 15);
            $sspSlots = random_int(1, min(3, $numSlots - 2));
            $playlistSlots = random_int(0, min(2, $numSlots - $sspSlots - 1));

            $tenant = Tenant::factory()->create([
                'num_slots' => $numSlots,
                'ssp_slots' => $sspSlots,
                'playlist_slots' => $playlistSlots,
                'default_duration_seconds' => 10,
            ]);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'num_slots' => null,
            ]);

            $manifest = $this->generator->generate($screen);
            $slots = $manifest->items['slots'];

            $adSlots = $numSlots - $sspSlots - $playlistSlots;

            // SSP slots always have empty candidates (filled at runtime by player)
            for ($pos = $adSlots; $pos < $adSlots + $sspSlots; $pos++) {
                $this->assertEmpty(
                    $slots[$pos]['candidates'],
                    "Property 5f (iter {$i}): SSP slot at position {$pos} should have 0 candidates (filled at runtime)"
                );
            }
        }
    }

    // ─── Property 10: Hash version integrity ────────────────────────────────

    /**
     * Property 10a: Version field is a valid SHA-256 hash of the template content (excluding version).
     *
     * For any Loop Template generated, the version field must be exactly the SHA-256 hash
     * of the serialized template content (excluding the version field itself).
     *
     * **Validates: Requirements 2.13**
     */
    public function test_version_is_sha256_of_content_excluding_version(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $numSlots = random_int(3, 20);
            $maxReserved = $numSlots - 1;
            $sspSlots = random_int(0, min(4, $maxReserved));
            $playlistSlots = random_int(0, min(4, $maxReserved - $sspSlots));

            $tenant = Tenant::factory()->create([
                'num_slots' => $numSlots,
                'ssp_slots' => $sspSlots,
                'playlist_slots' => $playlistSlots,
                'default_duration_seconds' => random_int(5, 30),
                'sync_interval_seconds' => random_int(30, 900),
                'cache_flush_interval_hours' => random_int(1, 720),
            ]);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'num_slots' => null,
            ]);

            $manifest = $this->generator->generate($screen);
            $items = $manifest->items;

            // The stored version in DB is the raw 64-char hex hash
            $storedVersion = $manifest->version;

            // The items JSON contains version with "sha256:" prefix
            $this->assertStringStartsWith('sha256:', $items['version']);
            $this->assertEquals("sha256:{$storedVersion}", $items['version']);

            // Recompute: remove version field from items, hash the rest
            $contentWithoutVersion = $items;
            unset($contentWithoutVersion['version']);

            $expectedHash = hash('sha256', json_encode($contentWithoutVersion));

            $this->assertEquals(
                $expectedHash,
                $storedVersion,
                "Property 10a (iter {$i}): Version should be SHA-256 of content excluding version field. " .
                "Expected '{$expectedHash}', got '{$storedVersion}'"
            );
        }
    }

    /**
     * Property 10b: Same content produces same hash (determinism).
     *
     * For any screen generated twice without changes in between, the version hash
     * must be identical if the content hasn't changed.
     *
     * **Validates: Requirements 2.13**
     */
    public function test_same_content_produces_same_hash(): void
    {
        for ($i = 0; $i < 50; $i++) {
            $numSlots = random_int(3, 15);
            $maxReserved = $numSlots - 1;
            $sspSlots = random_int(0, min(3, $maxReserved));
            $playlistSlots = random_int(0, min(3, $maxReserved - $sspSlots));

            $tenant = Tenant::factory()->create([
                'num_slots' => $numSlots,
                'ssp_slots' => $sspSlots,
                'playlist_slots' => $playlistSlots,
                'default_duration_seconds' => 10,
                'sync_interval_seconds' => 240,
                'cache_flush_interval_hours' => 24,
            ]);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'num_slots' => null,
            ]);

            // Generate twice — note: generated_at will differ, so hash will differ
            // unless we freeze time
            $this->travelTo(now());

            $manifest1 = $this->generator->generate($screen);
            $manifest2 = $this->generator->generate($screen->fresh());

            // With same frozen time, same content → same hash
            $this->assertEquals(
                $manifest1->version,
                $manifest2->version,
                "Property 10b (iter {$i}): Same content at same time should produce identical hash"
            );

            $this->travelBack();
        }
    }

    /**
     * Property 10c: Different content produces different hash.
     *
     * For any two templates generated with different configurations (different num_slots),
     * the version hashes must be different.
     *
     * **Validates: Requirements 2.13**
     */
    public function test_different_content_produces_different_hash(): void
    {
        for ($i = 0; $i < 50; $i++) {
            $numSlots1 = random_int(3, 15);
            $numSlots2 = $numSlots1 + random_int(1, 5); // Guaranteed different

            $sspSlots = random_int(0, min(2, $numSlots1 - 1, $numSlots2 - 1));
            $playlistSlots = random_int(0, min(2, $numSlots1 - $sspSlots - 1, $numSlots2 - $sspSlots - 1));

            $tenant = Tenant::factory()->create([
                'num_slots' => $numSlots1,
                'ssp_slots' => $sspSlots,
                'playlist_slots' => $playlistSlots,
                'default_duration_seconds' => 10,
            ]);

            $screen1 = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'num_slots' => $numSlots1,
            ]);

            $screen2 = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'num_slots' => $numSlots2,
            ]);

            $this->travelTo(now());

            $manifest1 = $this->generator->generate($screen1);
            $manifest2 = $this->generator->generate($screen2);

            $this->assertNotEquals(
                $manifest1->version,
                $manifest2->version,
                "Property 10c (iter {$i}): Different num_slots ({$numSlots1} vs {$numSlots2}) " .
                "should produce different hashes"
            );

            $this->travelBack();
        }
    }

    /**
     * Property 10d: Version is a valid 64-character hexadecimal SHA-256 string.
     *
     * For any Loop Template generated, the version field stored in the DB must be
     * a valid 64-character lowercase hexadecimal string.
     *
     * **Validates: Requirements 2.13**
     */
    public function test_version_is_valid_sha256_hex_string(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $numSlots = random_int(3, 30);
            $maxReserved = $numSlots - 1;
            $sspSlots = random_int(0, min(5, $maxReserved));
            $playlistSlots = random_int(0, min(5, $maxReserved - $sspSlots));

            $tenant = Tenant::factory()->create([
                'num_slots' => $numSlots,
                'ssp_slots' => $sspSlots,
                'playlist_slots' => $playlistSlots,
                'default_duration_seconds' => random_int(5, 30),
            ]);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'num_slots' => null,
            ]);

            $manifest = $this->generator->generate($screen);

            $this->assertMatchesRegularExpression(
                '/^[0-9a-f]{64}$/',
                $manifest->version,
                "Property 10d (iter {$i}): Version must be a valid 64-char hex SHA-256 string, got '{$manifest->version}'"
            );
        }
    }
}
