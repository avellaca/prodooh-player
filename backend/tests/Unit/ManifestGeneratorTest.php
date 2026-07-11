<?php

namespace Tests\Unit;

use App\Models\Content;
use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\Playlist;
use App\Models\PlaylistItem;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\ScreenManifest;
use App\Models\Tenant;
use App\Services\CreativeSelector;
use App\Services\ManifestGenerator;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ManifestGeneratorTest extends TestCase
{
    use RefreshDatabase;

    private ManifestGenerator $generator;
    private Tenant $tenant;
    private ScreenGroup $group;
    private Screen $screen;

    protected function setUp(): void
    {
        parent::setUp();
        $this->generator = new ManifestGenerator(new CreativeSelector());

        $this->tenant = Tenant::factory()->create([
            'default_duration_seconds' => 10,
        ]);
        $this->group = ScreenGroup::factory()->create([
            'tenant_id' => $this->tenant->id,
            'duration_seconds' => 10,
        ]);
        $this->screen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'group_id' => $this->group->id,
        ]);
    }

    private function createOrderLineWithCreative(): array
    {
        $today = Carbon::today()->toDateString();

        $order = Order::factory()->create([
            'tenant_id' => $this->tenant->id,
            'status' => 'active',
        ]);

        $line = OrderLine::factory()->create([
            'order_id' => $order->id,
            'status' => 'active',
        ]);

        $content = Content::factory()->create([
            'tenant_id' => $this->tenant->id,
            'checksum_sha256' => hash('sha256', 'test-content'),
        ]);

        $creative = Creative::factory()->create([
            'order_line_id' => $line->id,
            'content_id' => $content->id,
            'weight' => 1,
            'active_dates' => [$today],
        ]);

        return ['line' => $line, 'creative' => $creative, 'content' => $content];
    }

    private function createPlaylistWithItems(int $itemCount = 2): Playlist
    {
        $playlist = Playlist::factory()->create([
            'tenant_id' => $this->tenant->id,
        ]);

        for ($i = 0; $i < $itemCount; $i++) {
            $content = Content::factory()->create([
                'tenant_id' => $this->tenant->id,
                'checksum_sha256' => hash('sha256', "playlist-content-{$i}"),
            ]);

            PlaylistItem::factory()->create([
                'playlist_id' => $playlist->id,
                'content_id' => $content->id,
                'position' => $i,
                'duration_seconds' => 10,
            ]);
        }

        // Assign playlist to screen
        $this->screen->playlists()->attach($playlist->id, ['assigned_at' => now()]);

        return $playlist;
    }

    public function test_generate_with_only_order_line_items(): void
    {
        $data = $this->createOrderLineWithCreative();
        $line = $data['line'];

        $sequence = [
            ['position' => 0, 'order_line_id' => $line->id],
            ['position' => 1, 'order_line_id' => $line->id],
            ['position' => 2, 'order_line_id' => $line->id],
        ];

        $manifest = $this->generator->generate($this->screen, $sequence, 0, 0);

        $this->assertInstanceOf(ScreenManifest::class, $manifest);
        $this->assertEquals($this->screen->id, $manifest->screen_id);
        $this->assertCount(3, $manifest->items);

        foreach ($manifest->items as $item) {
            $this->assertEquals('order_line_creative', $item['type']);
            $this->assertArrayHasKey('asset_url', $item);
            $this->assertArrayHasKey('checksum_sha256', $item);
            $this->assertArrayHasKey('order_line_id', $item);
            $this->assertArrayHasKey('creative_id', $item);
            $this->assertArrayHasKey('duration_seconds', $item);
            $this->assertEquals(10, $item['duration_seconds']);
            $this->assertEquals($line->id, $item['order_line_id']);
        }
    }

    public function test_generate_with_ssp_slots(): void
    {
        $data = $this->createOrderLineWithCreative();
        $line = $data['line'];

        $sequence = [
            ['position' => 0, 'order_line_id' => $line->id],
        ];

        $manifest = $this->generator->generate($this->screen, $sequence, 2, 0);

        $this->assertCount(3, $manifest->items);

        $sspItems = array_filter($manifest->items, fn($i) => $i['type'] === 'prodooh_ssp_call');
        $this->assertCount(2, $sspItems);

        foreach ($sspItems as $item) {
            $this->assertEquals('prodooh_ssp_call', $item['type']);
            $this->assertEquals(10, $item['duration_seconds']);
            // SSP items should NOT have asset_url or checksum
            $this->assertArrayNotHasKey('asset_url', $item);
            $this->assertArrayNotHasKey('checksum_sha256', $item);
            $this->assertArrayNotHasKey('order_line_id', $item);
            $this->assertArrayNotHasKey('creative_id', $item);
        }
    }

    public function test_generate_with_playlist_slots(): void
    {
        $this->createPlaylistWithItems(2);
        $data = $this->createOrderLineWithCreative();
        $line = $data['line'];

        $sequence = [
            ['position' => 0, 'order_line_id' => $line->id],
        ];

        $manifest = $this->generator->generate($this->screen, $sequence, 0, 2);

        $this->assertCount(3, $manifest->items);

        $playlistItems = array_filter($manifest->items, fn($i) => $i['type'] === 'playlist_item');
        $this->assertCount(2, $playlistItems);

        foreach ($playlistItems as $item) {
            $this->assertEquals('playlist_item', $item['type']);
            $this->assertArrayHasKey('asset_url', $item);
            $this->assertArrayHasKey('checksum_sha256', $item);
            $this->assertArrayHasKey('playlist_item_id', $item);
            $this->assertEquals(10, $item['duration_seconds']);
            // Playlist items should NOT have order_line_id or creative_id
            $this->assertArrayNotHasKey('order_line_id', $item);
            $this->assertArrayNotHasKey('creative_id', $item);
        }
    }

    public function test_generate_mixed_items_all_types(): void
    {
        $this->createPlaylistWithItems(3);
        $data = $this->createOrderLineWithCreative();
        $line = $data['line'];

        $sequence = [
            ['position' => 0, 'order_line_id' => $line->id],
            ['position' => 1, 'order_line_id' => $line->id],
        ];

        $manifest = $this->generator->generate($this->screen, $sequence, 1, 1);

        $this->assertCount(4, $manifest->items);

        // Verify positions are sequential 0-based
        $positions = array_column($manifest->items, 'position');
        $this->assertEquals([0, 1, 2, 3], $positions);

        // Verify type counts
        $types = array_column($manifest->items, 'type');
        $this->assertEquals(2, count(array_filter($types, fn($t) => $t === 'order_line_creative')));
        $this->assertEquals(1, count(array_filter($types, fn($t) => $t === 'prodooh_ssp_call')));
        $this->assertEquals(1, count(array_filter($types, fn($t) => $t === 'playlist_item')));
    }

    public function test_compute_version_deterministic(): void
    {
        $items = [
            ['position' => 0, 'type' => 'order_line_creative', 'duration_seconds' => 10],
            ['position' => 1, 'type' => 'prodooh_ssp_call', 'duration_seconds' => 10],
        ];

        $version1 = $this->generator->computeVersion($items);
        $version2 = $this->generator->computeVersion($items);

        $this->assertEquals($version1, $version2);
        $this->assertEquals(64, strlen($version1)); // SHA-256 produces 64 hex chars
    }

    public function test_compute_version_different_for_different_items(): void
    {
        $items1 = [
            ['position' => 0, 'type' => 'order_line_creative', 'duration_seconds' => 10],
        ];

        $items2 = [
            ['position' => 0, 'type' => 'prodooh_ssp_call', 'duration_seconds' => 10],
        ];

        $version1 = $this->generator->computeVersion($items1);
        $version2 = $this->generator->computeVersion($items2);

        $this->assertNotEquals($version1, $version2);
    }

    public function test_generate_upserts_manifest_by_screen_id(): void
    {
        $data = $this->createOrderLineWithCreative();
        $line = $data['line'];

        $sequence = [
            ['position' => 0, 'order_line_id' => $line->id],
        ];

        // Generate first manifest
        $manifest1 = $this->generator->generate($this->screen, $sequence, 0, 0);
        $this->assertDatabaseCount('screen_manifests', 1);

        // Generate again — should upsert, not create a second row
        $manifest2 = $this->generator->generate($this->screen, $sequence, 1, 0);
        $this->assertDatabaseCount('screen_manifests', 1);

        // Version should have changed since items changed
        $this->assertNotEquals($manifest1->version, $manifest2->fresh()->version);
    }

    public function test_generate_empty_sequence_with_only_fillers(): void
    {
        $this->createPlaylistWithItems(2);

        $manifest = $this->generator->generate($this->screen, [], 1, 2);

        $this->assertCount(3, $manifest->items);

        $positions = array_column($manifest->items, 'position');
        $this->assertEquals([0, 1, 2], $positions);
    }

    public function test_playlist_items_cycle_when_more_slots_than_items(): void
    {
        $this->createPlaylistWithItems(2);

        $manifest = $this->generator->generate($this->screen, [], 0, 5);

        $this->assertCount(5, $manifest->items);

        // All should be playlist items
        foreach ($manifest->items as $item) {
            $this->assertEquals('playlist_item', $item['type']);
        }

        // Should cycle through the 2 playlist items
        $playlistItemIds = array_column($manifest->items, 'playlist_item_id');
        $uniqueIds = array_unique($playlistItemIds);
        $this->assertCount(2, $uniqueIds);
    }

    public function test_generate_sets_total_and_remaining_spots(): void
    {
        $this->createPlaylistWithItems(2);
        $data = $this->createOrderLineWithCreative();
        $line = $data['line'];

        $sequence = [
            ['position' => 0, 'order_line_id' => $line->id],
            ['position' => 1, 'order_line_id' => $line->id],
        ];

        $manifest = $this->generator->generate($this->screen, $sequence, 1, 1);

        $this->assertEquals(4, $manifest->total_spots);
        // remaining_spots = total - order_line items
        $this->assertEquals(2, $manifest->remaining_spots);
    }

    public function test_uses_effective_duration_from_group(): void
    {
        $this->group->update(['duration_seconds' => 15]);

        $data = $this->createOrderLineWithCreative();
        $line = $data['line'];

        $sequence = [
            ['position' => 0, 'order_line_id' => $line->id],
        ];

        $manifest = $this->generator->generate($this->screen, $sequence, 0, 0);

        $this->assertEquals(15, $manifest->items[0]['duration_seconds']);
    }

    public function test_generate_empty_manifest(): void
    {
        $manifest = $this->generator->generate($this->screen, [], 0, 0);

        $this->assertInstanceOf(ScreenManifest::class, $manifest);
        $this->assertCount(0, $manifest->items);
        $this->assertEquals(0, $manifest->total_spots);
    }
}
