<?php

namespace Tests\Feature;

use App\Models\Content;
use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Playlist;
use App\Models\PlaylistItem;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\ScreenManifest;
use App\Models\Tenant;
use App\Services\LoopTemplateGenerator;
use App\Services\LoopTemplateGeneratorInterface;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class LoopTemplateGeneratorGenerateTest extends TestCase
{
    use RefreshDatabase;

    private LoopTemplateGenerator $generator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->generator = $this->app->make(LoopTemplateGeneratorInterface::class);
    }

    // ─── Basic generation with active lines ─────────────────────────────────

    public function test_generate_creates_loop_template_with_correct_structure(): void
    {
        // Setup: Tenant with 10 slots, 2 ssp, 1 playlist → 7 ad_slots
        $tenant = Tenant::factory()->create([
            'num_slots' => 10,
            'ssp_slots' => 2,
            'playlist_slots' => 1,
            'default_duration_seconds' => 10,
            'sync_interval_seconds' => 240,
            'cache_flush_interval_hours' => 24,
        ]);

        $group = ScreenGroup::factory()->create([
            'tenant_id' => $tenant->id,
            'duration_seconds' => 10,
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'group_id' => $group->id,
            'num_slots' => null,
        ]);

        // Create a patrocinio order line targeting this screen
        $order = Order::factory()->create([
            'tenant_id' => $tenant->id,
            'status' => 'active',
        ]);

        $patrocinioLine = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'patrocinio',
            'delivery_pace' => 'uniform',
            'status' => 'active',
            'starts_at' => now()->subDays(1),
            'ends_at' => now()->addDays(10),
            'slots_purchased' => 2,
        ]);

        $content = Content::factory()->create(['tenant_id' => $tenant->id]);
        $target = OrderLineTarget::factory()->create([
            'order_line_id' => $patrocinioLine->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);
        Creative::factory()->create([
            'order_line_target_id' => $target->id,
            'content_id' => $content->id,
        ]);

        // Generate the template
        $manifest = $this->generator->generate($screen);

        // Assertions
        $this->assertInstanceOf(ScreenManifest::class, $manifest);
        $this->assertEquals($screen->id, $manifest->screen_id);
        $this->assertNotEmpty($manifest->version);
        // DB stores raw 64-char hash; JSON items have sha256: prefix
        $this->assertEquals(64, strlen($manifest->version));

        // Verify items structure
        $items = $manifest->items;
        $this->assertArrayHasKey('version', $items);
        $this->assertStringStartsWith('sha256:', $items['version']);
        $this->assertArrayHasKey('generated_at', $items);
        $this->assertArrayHasKey('loop_config', $items);
        $this->assertArrayHasKey('slots', $items);
        $this->assertArrayHasKey('sync_interval_seconds', $items);
        $this->assertArrayHasKey('cache_flush_interval_hours', $items);

        // Verify loop_config
        $this->assertEquals(10, $items['loop_config']['num_slots']);
        $this->assertEquals(10, $items['loop_config']['slot_duration_seconds']);
        $this->assertEquals(100, $items['loop_config']['loop_duration_seconds']);
        $this->assertGreaterThan(0, $items['loop_config']['loops_per_day']);

        // Verify slots count matches num_slots
        $this->assertCount(10, $items['slots']);

        // Verify sync settings
        $this->assertEquals(240, $items['sync_interval_seconds']);
        $this->assertEquals(24, $items['cache_flush_interval_hours']);
    }

    // ─── Slot type ranges are predictable ───────────────────────────────────

    public function test_generate_produces_predictable_slot_type_ranges(): void
    {
        $tenant = Tenant::factory()->create([
            'num_slots' => 10,
            'ssp_slots' => 2,
            'playlist_slots' => 1,
            'default_duration_seconds' => 10,
        ]);

        $group = ScreenGroup::factory()->create([
            'tenant_id' => $tenant->id,
            'duration_seconds' => 10,
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'group_id' => $group->id,
        ]);

        $manifest = $this->generator->generate($screen);
        $slots = $manifest->items['slots'];

        // Positions 0-6 should be 'ad' (7 ad_slots = 10 - 2 - 1)
        for ($i = 0; $i < 7; $i++) {
            $this->assertEquals('ad', $slots[$i]['type'], "Position {$i} should be 'ad'");
            $this->assertEquals($i, $slots[$i]['position']);
        }

        // Positions 7-8 should be 'ssp' (2 ssp_slots)
        for ($i = 7; $i < 9; $i++) {
            $this->assertEquals('ssp', $slots[$i]['type'], "Position {$i} should be 'ssp'");
            $this->assertEquals($i, $slots[$i]['position']);
        }

        // Position 9 should be 'playlist' (1 playlist_slot)
        $this->assertEquals('playlist', $slots[9]['type'], 'Position 9 should be playlist');
        $this->assertEquals(9, $slots[9]['position']);
    }

    // ─── SSP slots have provider config ─────────────────────────────────────

    public function test_generate_ssp_slots_include_provider_config(): void
    {
        $tenant = Tenant::factory()->create([
            'num_slots' => 5,
            'ssp_slots' => 2,
            'playlist_slots' => 1,
            'default_duration_seconds' => 10,
            'api_credential' => 'test-api-key',
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'venue_id' => 'venue-123',
        ]);

        $manifest = $this->generator->generate($screen);
        $slots = $manifest->items['slots'];

        // ad_slots = 5 - 2 - 1 = 2, so SSP starts at position 2
        $sspSlot = collect($slots)->firstWhere('type', 'ssp');
        $this->assertNotNull($sspSlot);
        $this->assertEquals('prodooh', $sspSlot['provider']);
        $this->assertEquals('test-api-key', $sspSlot['config']['api_key']);
        $this->assertEquals($tenant->id, $sspSlot['config']['network_id']);
        $this->assertEquals('venue-123', $sspSlot['config']['venue_id']);
        $this->assertEmpty($sspSlot['candidates']);
    }

    // ─── Playlist slots include playlist items ──────────────────────────────

    public function test_generate_playlist_slots_include_playlist_items(): void
    {
        $tenant = Tenant::factory()->create([
            'num_slots' => 5,
            'ssp_slots' => 1,
            'playlist_slots' => 1,
            'default_duration_seconds' => 10,
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
        ]);

        $content1 = Content::factory()->create(['tenant_id' => $tenant->id]);
        $content2 = Content::factory()->create(['tenant_id' => $tenant->id]);

        $playlist = Playlist::factory()->create(['tenant_id' => $tenant->id]);
        PlaylistItem::factory()->create([
            'playlist_id' => $playlist->id,
            'content_id' => $content1->id,
            'position' => 0,
        ]);
        PlaylistItem::factory()->create([
            'playlist_id' => $playlist->id,
            'content_id' => $content2->id,
            'position' => 1,
        ]);

        // Assign playlist to screen
        $screen->playlists()->attach($playlist->id, ['assigned_at' => now()]);

        $manifest = $this->generator->generate($screen);
        $slots = $manifest->items['slots'];

        $playlistSlot = collect($slots)->firstWhere('type', 'playlist');
        $this->assertNotNull($playlistSlot);
        $this->assertCount(2, $playlistSlot['candidates']);
        $this->assertEquals('round_robin', $playlistSlot['strategy']);

        // Verify candidates have playlist_item_id and asset_url
        foreach ($playlistSlot['candidates'] as $candidate) {
            $this->assertArrayHasKey('playlist_item_id', $candidate);
            $this->assertArrayHasKey('asset_url', $candidate);
            $this->assertArrayHasKey('checksum_sha256', $candidate);
        }
    }

    // ─── Version is SHA-256 hash ────────────────────────────────────────────

    public function test_generate_version_is_sha256_hash(): void
    {
        $tenant = Tenant::factory()->create([
            'num_slots' => 5,
            'ssp_slots' => 1,
            'playlist_slots' => 1,
            'default_duration_seconds' => 10,
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
        ]);

        $manifest = $this->generator->generate($screen);

        // DB column stores raw 64-char hex hash
        $this->assertEquals(64, strlen($manifest->version));
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $manifest->version);

        // JSON items contain the prefixed version
        $this->assertStringStartsWith('sha256:', $manifest->items['version']);
        $this->assertStringContainsString($manifest->version, $manifest->items['version']);
    }

    // ─── Upsert: regenerating same screen updates existing manifest ─────────

    public function test_generate_upserts_manifest_for_same_screen(): void
    {
        $tenant = Tenant::factory()->create([
            'num_slots' => 5,
            'ssp_slots' => 1,
            'playlist_slots' => 1,
            'default_duration_seconds' => 10,
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
        ]);

        // Generate twice
        $manifest1 = $this->generator->generate($screen);
        $manifest2 = $this->generator->generate($screen->fresh());

        // Same screen should have only one manifest record
        $this->assertEquals(1, ScreenManifest::where('screen_id', $screen->id)->count());
        $this->assertEquals($manifest1->id, $manifest2->id);
    }

    // ─── Empty template when no active lines ────────────────────────────────

    public function test_generate_produces_empty_ad_slots_when_no_active_lines(): void
    {
        $tenant = Tenant::factory()->create([
            'num_slots' => 5,
            'ssp_slots' => 1,
            'playlist_slots' => 1,
            'default_duration_seconds' => 10,
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
        ]);

        $manifest = $this->generator->generate($screen);
        $slots = $manifest->items['slots'];

        // ad_slots = 5 - 1 - 1 = 3
        $adSlots = collect($slots)->where('type', 'ad');
        $this->assertCount(3, $adSlots);

        // All ad slots should have empty candidates
        foreach ($adSlots as $slot) {
            $this->assertEmpty($slot['candidates']);
            $this->assertEquals('fixed', $slot['strategy']);
        }
    }

    // ─── loops_per_day calculation ──────────────────────────────────────────

    public function test_generate_calculates_loops_per_day_correctly(): void
    {
        $tenant = Tenant::factory()->create([
            'num_slots' => 10,
            'ssp_slots' => 2,
            'playlist_slots' => 1,
            'default_duration_seconds' => 10,
            'default_schedule' => null, // No schedule = 16h default (57600s)
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'schedule' => null,
        ]);

        $manifest = $this->generator->generate($screen);

        // loops_per_day = 57600 / (10 * 10) = 576
        $this->assertEquals(576, $manifest->items['loop_config']['loops_per_day']);
    }

    // ─── Ad slot candidates are enriched with creative data ─────────────────

    public function test_generate_enriches_ad_candidates_with_creative_data(): void
    {
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

        $line = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'patrocinio',
            'delivery_pace' => 'uniform',
            'status' => 'active',
            'starts_at' => now()->subDays(1),
            'ends_at' => now()->addDays(10),
            'slots_purchased' => 1,
        ]);

        $content = Content::factory()->create([
            'tenant_id' => $tenant->id,
            'checksum_sha256' => 'abc123def456',
        ]);

        $target = OrderLineTarget::factory()->create([
            'order_line_id' => $line->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);

        $creative = Creative::factory()->create([
            'order_line_target_id' => $target->id,
            'content_id' => $content->id,
        ]);

        $manifest = $this->generator->generate($screen);
        $slots = $manifest->items['slots'];

        // First ad slot should have this line's creative
        $firstAdSlot = $slots[0];
        $this->assertEquals('ad', $firstAdSlot['type']);
        $this->assertEquals('fixed', $firstAdSlot['strategy']);
        $this->assertCount(1, $firstAdSlot['candidates']);

        $candidate = $firstAdSlot['candidates'][0];
        $this->assertEquals($line->id, $candidate['order_line_id']);
        $this->assertEquals($creative->id, $candidate['creative_id']);
        $this->assertStringContainsString("/api/device/content/{$content->id}/file", $candidate['asset_url']);
        $this->assertEquals('abc123def456', $candidate['checksum_sha256']);
    }

    // ─── Sequential mode: strategy is 'sequential' in manifest ──────────────

    public function test_generate_sequential_mode_sets_strategy_to_sequential(): void
    {
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

        $line = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'patrocinio',
            'delivery_pace' => 'uniform',
            'status' => 'active',
            'starts_at' => now()->subDays(1),
            'ends_at' => now()->addDays(10),
            'slots_purchased' => 1,
            'playback_mode' => 'sequential',
        ]);

        $content = Content::factory()->create(['tenant_id' => $tenant->id]);

        $target = OrderLineTarget::factory()->create([
            'order_line_id' => $line->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);

        Creative::factory()->create([
            'order_line_target_id' => $target->id,
            'content_id' => $content->id,
            'position' => 0,
        ]);

        $manifest = $this->generator->generate($screen);
        $slots = $manifest->items['slots'];

        $firstAdSlot = $slots[0];
        $this->assertEquals('ad', $firstAdSlot['type']);
        $this->assertEquals('sequential', $firstAdSlot['strategy']);
    }

    // ─── Sequential mode: all creatives ordered by position ASC ─────────────

    public function test_generate_sequential_mode_orders_candidates_by_position_asc(): void
    {
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

        $line = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'patrocinio',
            'delivery_pace' => 'uniform',
            'status' => 'active',
            'starts_at' => now()->subDays(1),
            'ends_at' => now()->addDays(10),
            'slots_purchased' => 1,
            'playback_mode' => 'sequential',
        ]);

        $content1 = Content::factory()->create(['tenant_id' => $tenant->id]);
        $content2 = Content::factory()->create(['tenant_id' => $tenant->id]);
        $content3 = Content::factory()->create(['tenant_id' => $tenant->id]);

        $target = OrderLineTarget::factory()->create([
            'order_line_id' => $line->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);

        // Create creatives out of order to ensure position sorting works
        $creative3 = Creative::factory()->create([
            'order_line_target_id' => $target->id,
            'content_id' => $content3->id,
            'position' => 2,
        ]);
        $creative1 = Creative::factory()->create([
            'order_line_target_id' => $target->id,
            'content_id' => $content1->id,
            'position' => 0,
        ]);
        $creative2 = Creative::factory()->create([
            'order_line_target_id' => $target->id,
            'content_id' => $content2->id,
            'position' => 1,
        ]);

        $manifest = $this->generator->generate($screen);
        $slots = $manifest->items['slots'];

        $firstAdSlot = $slots[0];
        $this->assertEquals('sequential', $firstAdSlot['strategy']);
        $this->assertCount(3, $firstAdSlot['candidates']);

        // Verify order: position 0, 1, 2
        $this->assertEquals($creative1->id, $firstAdSlot['candidates'][0]['creative_id']);
        $this->assertEquals($creative2->id, $firstAdSlot['candidates'][1]['creative_id']);
        $this->assertEquals($creative3->id, $firstAdSlot['candidates'][2]['creative_id']);
    }

    // ─── Sequential mode: nulls last in ordering ────────────────────────────

    public function test_generate_sequential_mode_puts_null_positions_last(): void
    {
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

        $line = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'patrocinio',
            'delivery_pace' => 'uniform',
            'status' => 'active',
            'starts_at' => now()->subDays(1),
            'ends_at' => now()->addDays(10),
            'slots_purchased' => 1,
            'playback_mode' => 'sequential',
        ]);

        $content1 = Content::factory()->create(['tenant_id' => $tenant->id]);
        $content2 = Content::factory()->create(['tenant_id' => $tenant->id]);
        $content3 = Content::factory()->create(['tenant_id' => $tenant->id]);

        $target = OrderLineTarget::factory()->create([
            'order_line_id' => $line->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);

        $creative1 = Creative::factory()->create([
            'order_line_target_id' => $target->id,
            'content_id' => $content1->id,
            'position' => 0,
        ]);
        $creative2 = Creative::factory()->create([
            'order_line_target_id' => $target->id,
            'content_id' => $content2->id,
            'position' => null, // No position — should appear last
        ]);
        $creative3 = Creative::factory()->create([
            'order_line_target_id' => $target->id,
            'content_id' => $content3->id,
            'position' => 1,
        ]);

        $manifest = $this->generator->generate($screen);
        $slots = $manifest->items['slots'];

        $firstAdSlot = $slots[0];
        $this->assertEquals('sequential', $firstAdSlot['strategy']);
        $this->assertCount(3, $firstAdSlot['candidates']);

        // Position 0 first, then position 1, then null last
        $this->assertEquals($creative1->id, $firstAdSlot['candidates'][0]['creative_id']);
        $this->assertEquals($creative3->id, $firstAdSlot['candidates'][1]['creative_id']);
        $this->assertEquals($creative2->id, $firstAdSlot['candidates'][2]['creative_id']);
    }

    // ─── Sequential mode with target override ───────────────────────────────

    public function test_generate_sequential_mode_respects_target_override(): void
    {
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

        // Order line is round_robin, but target overrides to sequential
        $line = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'patrocinio',
            'delivery_pace' => 'uniform',
            'status' => 'active',
            'starts_at' => now()->subDays(1),
            'ends_at' => now()->addDays(10),
            'slots_purchased' => 1,
            'playback_mode' => 'round_robin',
        ]);

        $content = Content::factory()->create(['tenant_id' => $tenant->id]);

        $target = OrderLineTarget::factory()->create([
            'order_line_id' => $line->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
            'playback_mode_override' => 'sequential',
        ]);

        Creative::factory()->create([
            'order_line_target_id' => $target->id,
            'content_id' => $content->id,
            'position' => 0,
        ]);

        $manifest = $this->generator->generate($screen);
        $slots = $manifest->items['slots'];

        $firstAdSlot = $slots[0];
        $this->assertEquals('sequential', $firstAdSlot['strategy']);
    }

    // ─── Round robin behavior unchanged ─────────────────────────────────────

    public function test_generate_round_robin_mode_unchanged(): void
    {
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

        $line = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'patrocinio',
            'delivery_pace' => 'uniform',
            'status' => 'active',
            'starts_at' => now()->subDays(1),
            'ends_at' => now()->addDays(10),
            'slots_purchased' => 1,
            'playback_mode' => 'round_robin',
        ]);

        $content = Content::factory()->create([
            'tenant_id' => $tenant->id,
            'checksum_sha256' => 'hash123',
        ]);

        $target = OrderLineTarget::factory()->create([
            'order_line_id' => $line->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
            'playback_mode_override' => null,
        ]);

        $creative = Creative::factory()->create([
            'order_line_target_id' => $target->id,
            'content_id' => $content->id,
        ]);

        $manifest = $this->generator->generate($screen);
        $slots = $manifest->items['slots'];

        $firstAdSlot = $slots[0];
        $this->assertEquals('ad', $firstAdSlot['type']);
        // round_robin with single patrocinio → fixed strategy from allocator
        $this->assertNotEquals('sequential', $firstAdSlot['strategy']);
        $this->assertCount(1, $firstAdSlot['candidates']);
        $this->assertEquals($creative->id, $firstAdSlot['candidates'][0]['creative_id']);
    }
}
