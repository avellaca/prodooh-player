<?php

namespace Tests\Property;

use App\Models\Content;
use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\Playlist;
use App\Models\PlaylistItem;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use App\Services\CreativeSelector;
use App\Services\ManifestGenerator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Feature: 06-player-reingenieria-motor
 *
 * Property 15: Manifest version determinism — same sequence → same hash; different → different hash
 * Property 16: Manifest item type field validation — correct fields per type
 *
 * **Validates: Requirements 6.5, 7.3, 7.4, 7.5, 7.6**
 */
class ManifestGeneratorPropertyTest extends TestCase
{
    use RefreshDatabase;

    private ManifestGenerator $generator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->generator = new ManifestGenerator(new CreativeSelector());
    }

    /**
     * Property 15: Manifest version determinism (100 iterations)
     *
     * For any two manifests with identical item sequences, they SHALL produce the same
     * version hash. For any two manifests with different item sequences, they SHALL
     * produce different version hashes.
     *
     * Strategy: Generate random items arrays (3-20 items with random position/type/duration).
     * Call computeVersion twice with same input → assert same hash.
     * Modify one field → assert different hash. No DB needed for this property.
     *
     * **Validates: Requirements 6.5**
     */
    public function test_manifest_version_determinism(): void
    {
        $iterations = 100;
        $types = ['order_line_creative', 'prodooh_ssp_call', 'playlist_item'];

        for ($iter = 0; $iter < $iterations; $iter++) {
            // Generate random items array (3-20 items)
            $numItems = random_int(3, 20);
            $items = [];

            for ($i = 0; $i < $numItems; $i++) {
                $type = $types[array_rand($types)];
                $item = [
                    'position' => $i,
                    'type' => $type,
                    'duration_seconds' => random_int(5, 60),
                ];

                if ($type === 'order_line_creative') {
                    $item['asset_url'] = 'https://cdn.example.com/content/' . bin2hex(random_bytes(8)) . '.mp4';
                    $item['checksum_sha256'] = hash('sha256', random_bytes(16));
                    $item['order_line_id'] = (string) \Illuminate\Support\Str::uuid();
                    $item['creative_id'] = (string) \Illuminate\Support\Str::uuid();
                } elseif ($type === 'playlist_item') {
                    $item['asset_url'] = 'https://cdn.example.com/content/' . bin2hex(random_bytes(8)) . '.jpg';
                    $item['checksum_sha256'] = hash('sha256', random_bytes(16));
                    $item['playlist_item_id'] = (string) \Illuminate\Support\Str::uuid();
                }
                // prodooh_ssp_call: only position, type, duration_seconds

                $items[] = $item;
            }

            // Same input → same hash
            $hash1 = $this->generator->computeVersion($items);
            $hash2 = $this->generator->computeVersion($items);

            $this->assertSame(
                $hash1,
                $hash2,
                "Property 15 violated (same input → same hash): iteration {$iter}, " .
                "items count={$numItems}. Got different hashes for identical input."
            );

            // Modify one field → different hash
            $modifiedItems = $items;
            $modifyIndex = random_int(0, $numItems - 1);

            // Pick a random modification strategy
            $modStrategy = random_int(0, 2);
            switch ($modStrategy) {
                case 0:
                    // Change duration
                    $modifiedItems[$modifyIndex]['duration_seconds'] += 1;
                    break;
                case 1:
                    // Change position
                    $modifiedItems[$modifyIndex]['position'] += 100;
                    break;
                case 2:
                    // Change type (swap to a different one)
                    $currentType = $modifiedItems[$modifyIndex]['type'];
                    $otherTypes = array_values(array_diff($types, [$currentType]));
                    $modifiedItems[$modifyIndex]['type'] = $otherTypes[array_rand($otherTypes)];
                    break;
            }

            $hashModified = $this->generator->computeVersion($modifiedItems);

            $this->assertNotSame(
                $hash1,
                $hashModified,
                "Property 15 violated (different input → different hash): iteration {$iter}, " .
                "modified index={$modifyIndex}, strategy={$modStrategy}. " .
                "Expected different hashes for modified input."
            );
        }
    }

    /**
     * Property 16: Manifest item type field validation (50 iterations)
     *
     * For any manifest item, it SHALL contain position, type, and duration_seconds.
     * Additionally:
     * - order_line_creative: asset_url, checksum_sha256, order_line_id, creative_id present; NO playlist_item_id
     * - prodooh_ssp_call: NO asset_url, checksum_sha256, order_line_id, creative_id, playlist_item_id
     * - playlist_item: asset_url, checksum_sha256, playlist_item_id present; NO order_line_id, creative_id
     *
     * Strategy: Create screen+group+tenant+playlist+order_lines+creatives. Generate manifest
     * with random sequence (1-5 order lines), random ssp (0-3), random playlist (0-3).
     * For each item assert correct fields by type.
     *
     * **Validates: Requirements 7.3, 7.4, 7.5, 7.6**
     */
    public function test_manifest_item_type_field_validation(): void
    {
        $iterations = 50;

        for ($iter = 0; $iter < $iterations; $iter++) {
            // Create tenant, group, screen, playlist with items
            $tenant = Tenant::factory()->create();
            $group = ScreenGroup::factory()->create(['tenant_id' => $tenant->id]);
            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'group_id' => $group->id,
            ]);

            // Create a playlist with items for this screen
            $playlist = Playlist::factory()->create(['tenant_id' => $tenant->id]);
            $numPlaylistItems = random_int(1, 5);
            for ($pi = 0; $pi < $numPlaylistItems; $pi++) {
                $content = Content::factory()->create(['tenant_id' => $tenant->id]);
                PlaylistItem::factory()->create([
                    'playlist_id' => $playlist->id,
                    'content_id' => $content->id,
                    'position' => $pi,
                ]);
            }
            // Attach playlist to screen
            $screen->playlists()->attach($playlist->id, ['assigned_at' => now()]);

            // Create order lines with creatives (1-5 lines)
            $numOrderLines = random_int(1, 5);
            $order = Order::factory()->create([
                'tenant_id' => $tenant->id,
                'status' => 'active',
            ]);

            $sequence = [];
            $position = 0;
            for ($ol = 0; $ol < $numOrderLines; $ol++) {
                $line = OrderLine::factory()->create([
                    'order_id' => $order->id,
                    'status' => 'active',
                ]);

                // Each order line has 1-3 creatives
                $numCreatives = random_int(1, 3);
                for ($c = 0; $c < $numCreatives; $c++) {
                    $content = Content::factory()->create(['tenant_id' => $tenant->id]);
                    Creative::factory()->create([
                        'order_line_id' => $line->id,
                        'content_id' => $content->id,
                        'weight' => random_int(1, 10),
                        'active_dates' => [now()->toDateString()],
                    ]);
                }

                // Add 1-3 entries per order line to the sequence
                $entriesForLine = random_int(1, 3);
                for ($e = 0; $e < $entriesForLine; $e++) {
                    $sequence[] = [
                        'position' => $position,
                        'order_line_id' => $line->id,
                    ];
                    $position++;
                }
            }

            // Random SSP and playlist slots
            $sspSlots = random_int(0, 3);
            $playlistSlots = random_int(0, 3);

            // Generate manifest
            $manifest = $this->generator->generate($screen, $sequence, $sspSlots, $playlistSlots);
            $items = $manifest->items;

            $this->assertNotEmpty(
                $items,
                "Property 16: manifest should not be empty. Iteration {$iter}."
            );

            foreach ($items as $idx => $item) {
                // All items MUST have position (int), type (string), duration_seconds (int)
                $this->assertArrayHasKey('position', $item,
                    "Property 16: item [{$idx}] missing 'position'. Iteration {$iter}.");
                $this->assertArrayHasKey('type', $item,
                    "Property 16: item [{$idx}] missing 'type'. Iteration {$iter}.");
                $this->assertArrayHasKey('duration_seconds', $item,
                    "Property 16: item [{$idx}] missing 'duration_seconds'. Iteration {$iter}.");

                $this->assertIsInt($item['position'],
                    "Property 16: item [{$idx}] 'position' must be int. Iteration {$iter}.");
                $this->assertIsString($item['type'],
                    "Property 16: item [{$idx}] 'type' must be string. Iteration {$iter}.");
                $this->assertIsInt($item['duration_seconds'],
                    "Property 16: item [{$idx}] 'duration_seconds' must be int. Iteration {$iter}.");

                $type = $item['type'];

                switch ($type) {
                    case 'order_line_creative':
                        // MUST have: asset_url, checksum_sha256, order_line_id, creative_id
                        $this->assertArrayHasKey('asset_url', $item,
                            "Property 16: order_line_creative [{$idx}] missing 'asset_url'. Iteration {$iter}.");
                        $this->assertArrayHasKey('checksum_sha256', $item,
                            "Property 16: order_line_creative [{$idx}] missing 'checksum_sha256'. Iteration {$iter}.");
                        $this->assertArrayHasKey('order_line_id', $item,
                            "Property 16: order_line_creative [{$idx}] missing 'order_line_id'. Iteration {$iter}.");
                        $this->assertArrayHasKey('creative_id', $item,
                            "Property 16: order_line_creative [{$idx}] missing 'creative_id'. Iteration {$iter}.");
                        // MUST NOT have: playlist_item_id
                        $this->assertArrayNotHasKey('playlist_item_id', $item,
                            "Property 16: order_line_creative [{$idx}] must NOT have 'playlist_item_id'. Iteration {$iter}.");
                        break;

                    case 'prodooh_ssp_call':
                        // MUST NOT have: asset_url, checksum_sha256, order_line_id, creative_id, playlist_item_id
                        $this->assertArrayNotHasKey('asset_url', $item,
                            "Property 16: prodooh_ssp_call [{$idx}] must NOT have 'asset_url'. Iteration {$iter}.");
                        $this->assertArrayNotHasKey('checksum_sha256', $item,
                            "Property 16: prodooh_ssp_call [{$idx}] must NOT have 'checksum_sha256'. Iteration {$iter}.");
                        $this->assertArrayNotHasKey('order_line_id', $item,
                            "Property 16: prodooh_ssp_call [{$idx}] must NOT have 'order_line_id'. Iteration {$iter}.");
                        $this->assertArrayNotHasKey('creative_id', $item,
                            "Property 16: prodooh_ssp_call [{$idx}] must NOT have 'creative_id'. Iteration {$iter}.");
                        $this->assertArrayNotHasKey('playlist_item_id', $item,
                            "Property 16: prodooh_ssp_call [{$idx}] must NOT have 'playlist_item_id'. Iteration {$iter}.");
                        break;

                    case 'playlist_item':
                        // MUST have: asset_url, checksum_sha256, playlist_item_id
                        $this->assertArrayHasKey('asset_url', $item,
                            "Property 16: playlist_item [{$idx}] missing 'asset_url'. Iteration {$iter}.");
                        $this->assertArrayHasKey('checksum_sha256', $item,
                            "Property 16: playlist_item [{$idx}] missing 'checksum_sha256'. Iteration {$iter}.");
                        $this->assertArrayHasKey('playlist_item_id', $item,
                            "Property 16: playlist_item [{$idx}] missing 'playlist_item_id'. Iteration {$iter}.");
                        // MUST NOT have: order_line_id, creative_id
                        $this->assertArrayNotHasKey('order_line_id', $item,
                            "Property 16: playlist_item [{$idx}] must NOT have 'order_line_id'. Iteration {$iter}.");
                        $this->assertArrayNotHasKey('creative_id', $item,
                            "Property 16: playlist_item [{$idx}] must NOT have 'creative_id'. Iteration {$iter}.");
                        break;

                    default:
                        $this->fail(
                            "Property 16: item [{$idx}] has unknown type '{$type}'. Iteration {$iter}."
                        );
                }
            }
        }
    }
}
