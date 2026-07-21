<?php

namespace Tests\Unit;

use App\Models\Content;
use App\Models\Creative;
use App\Models\Impression;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use App\Services\BresenhamInterleaver;
use App\Services\PriorityEngine;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PriorityEngineWaterfallTest extends TestCase
{
    use RefreshDatabase;

    private PriorityEngine $engine;
    private Tenant $tenant;
    private ScreenGroup $group;
    private Screen $screen;
    private Content $content;

    protected function setUp(): void
    {
        parent::setUp();
        $this->engine = new PriorityEngine(new BresenhamInterleaver());
    }

    private function createBaseData(): void
    {
        $this->tenant = Tenant::factory()->create([
            'default_duration_seconds' => 10,
            'default_schedule' => null,
        ]);

        $this->group = ScreenGroup::factory()->create([
            'tenant_id' => $this->tenant->id,
            'duration_seconds' => 10,
            'schedule' => null,
        ]);

        $this->screen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'group_id' => $this->group->id,
            'schedule' => null,
        ]);

        $this->content = Content::create([
            'tenant_id' => $this->tenant->id,
            'filename' => 'test.mp4',
            'mime_type' => 'video/mp4',
            'storage_path' => '/storage/test.mp4',
            'file_size_bytes' => 1024,
            'width' => 1920,
            'height' => 1080,
            'duration_seconds' => 10,
            'orientation' => 'landscape',
            'rotation' => 0,
            'checksum_sha256' => hash('sha256', 'test'),
        ]);
    }

    private function createOrderLine(array $attrs = []): OrderLine
    {
        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Test Order',            'status' => 'active',
        ]);

        $defaults = [
            'order_id' => $order->id,
            'name' => 'Test Line',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-31',
            'target_spots' => 100,
            'delivery_pace' => 'uniform',
            'status' => 'active',
        ];

        return OrderLine::create(array_merge($defaults, $attrs));
    }

    // =========================================================================
    // allocateRemainder tests
    // =========================================================================

    public function test_allocate_remainder_even_split(): void
    {
        $result = $this->engine->allocateRemainder(10);

        $this->assertEquals(5, $result['ssp_slots']);
        $this->assertEquals(5, $result['playlist_slots']);
    }

    public function test_allocate_remainder_odd_favors_playlist(): void
    {
        $result = $this->engine->allocateRemainder(7);

        // floor(7/2) = 3 for SSP, 7 - 3 = 4 for playlist
        $this->assertEquals(3, $result['ssp_slots']);
        $this->assertEquals(4, $result['playlist_slots']);
    }

    public function test_allocate_remainder_zero(): void
    {
        $result = $this->engine->allocateRemainder(0);

        $this->assertEquals(0, $result['ssp_slots']);
        $this->assertEquals(0, $result['playlist_slots']);
    }

    public function test_allocate_remainder_one_spot(): void
    {
        $result = $this->engine->allocateRemainder(1);

        // floor(1/2) = 0, 1 - 0 = 1
        $this->assertEquals(0, $result['ssp_slots']);
        $this->assertEquals(1, $result['playlist_slots']);
    }

    // =========================================================================
    // allocateLevel tests
    // =========================================================================

    public function test_allocate_level_under_capacity_exact_budget(): void
    {
        $this->createBaseData();
        Carbon::setTestNow(Carbon::parse('2026-08-01'));

        // Two lines with budgets that fit under capacity
        $line1 = $this->createOrderLine([
            'name' => 'Line 1',
            'target_spots' => 310, // ceil(310/31) = 10
        ]);
        $line2 = $this->createOrderLine([
            'name' => 'Line 2',
            'target_spots' => 620, // ceil(620/31) = 20
        ]);

        $lines = collect([$line1, $line2]);
        $result = $this->engine->allocateLevel($lines, 100);

        // Total demand = 10 + 20 = 30, capacity = 100 → under-capacity
        $this->assertCount(2, $result['allocations']);
        $this->assertEquals(10, $result['allocations'][0]['count']);
        $this->assertEquals(20, $result['allocations'][1]['count']);
        $this->assertEquals(70, $result['remaining']); // 100 - 30 = 70

        Carbon::setTestNow();
    }

    public function test_allocate_level_over_capacity_proportional(): void
    {
        $this->createBaseData();
        Carbon::setTestNow(Carbon::parse('2026-08-01'));

        // Lines whose demand exceeds capacity
        $line1 = $this->createOrderLine([
            'name' => 'Line 1',
            'target_spots' => 3100, // ceil(3100/31) = 100
        ]);
        $line2 = $this->createOrderLine([
            'name' => 'Line 2',
            'target_spots' => 3100, // ceil(3100/31) = 100
        ]);

        $lines = collect([$line1, $line2]);
        // Demand = 200, capacity = 40 → over-capacity (all uniform)
        $result = $this->engine->allocateLevel($lines, 40);

        // allocateWithCaps: uniform lines get min(budget, remaining) sequentially
        // line1: min(100, 40) = 40, line2: min(100, 0) = 0
        $this->assertCount(2, $result['allocations']);
        $this->assertEquals(40, $result['allocations'][0]['count']);
        $this->assertEquals(0, $result['allocations'][1]['count']);
        $this->assertEquals(0, $result['remaining']); // 40 - 40 - 0 = 0

        Carbon::setTestNow();
    }

    public function test_allocate_level_with_null_budget_unlimited_lines(): void
    {
        $this->createBaseData();
        Carbon::setTestNow(Carbon::parse('2026-08-01'));

        // One fixed-budget line, one unlimited line
        $line1 = $this->createOrderLine([
            'name' => 'Fixed Line',
            'target_spots' => 310, // ceil(310/31) = 10
        ]);
        $line2 = $this->createOrderLine([
            'name' => 'Unlimited Line',
            'target_spots' => null, // unlimited
        ]);

        $lines = collect([$line1, $line2]);
        $result = $this->engine->allocateLevel($lines, 100);

        // Fixed line gets its 10, unlimited gets proportional share of remaining 90
        // Unlimited: floor(90 * 50/50) = 90
        $this->assertCount(2, $result['allocations']);
        $this->assertEquals(10, $result['allocations'][0]['count']); // fixed line
        $this->assertEquals(90, $result['allocations'][1]['count']); // unlimited line
        $this->assertEquals(0, $result['remaining']);

        Carbon::setTestNow();
    }

    public function test_allocate_level_empty_lines(): void
    {
        $result = $this->engine->allocateLevel(collect(), 100);

        $this->assertEmpty($result['allocations']);
        $this->assertEquals(100, $result['remaining']);
    }

    public function test_allocate_level_zero_capacity(): void
    {
        $this->createBaseData();
        Carbon::setTestNow(Carbon::parse('2026-08-01'));

        $line = $this->createOrderLine(['target_spots' => 310]);
        $result = $this->engine->allocateLevel(collect([$line]), 0);

        $this->assertEmpty($result['allocations']);
        $this->assertEquals(0, $result['remaining']);

        Carbon::setTestNow();
    }

    // =========================================================================
    // runWaterfall tests
    // =========================================================================

    public function test_waterfall_processes_tiers_in_order(): void
    {
        $this->createBaseData();
        Carbon::setTestNow(Carbon::parse('2026-08-01'));

        $patrocinio = $this->createOrderLine([
            'name' => 'Patrocinio Line',
            'priority_tier' => 'patrocinio',
            'target_spots' => 620, // budget = 20
        ]);
        $estandar = $this->createOrderLine([
            'name' => 'Estandar Line',
            'priority_tier' => 'estandar',
            'target_spots' => 930, // budget = 30
        ]);
        $redInterna = $this->createOrderLine([
            'name' => 'Red Interna Line',
            'priority_tier' => 'red_interna',
            'target_spots' => 310, // budget = 10
        ]);

        $lines = collect([$patrocinio, $estandar, $redInterna]);
        $result = $this->engine->runWaterfall($lines, 100);

        // Patrocinio gets 20, estandar gets 30, red_interna gets 10
        // Remaining: 100 - 20 - 30 - 10 = 40
        // Remainder: ssp = 20, playlist = 20
        $this->assertCount(3, $result['allocations']);
        $this->assertEquals($patrocinio->id, $result['allocations'][0]['order_line_id']);
        $this->assertEquals(20, $result['allocations'][0]['count']);
        $this->assertEquals($estandar->id, $result['allocations'][1]['order_line_id']);
        $this->assertEquals(30, $result['allocations'][1]['count']);
        $this->assertEquals($redInterna->id, $result['allocations'][2]['order_line_id']);
        $this->assertEquals(10, $result['allocations'][2]['count']);

        $this->assertEquals(20, $result['ssp_slots']);
        $this->assertEquals(20, $result['playlist_slots']);

        Carbon::setTestNow();
    }

    public function test_waterfall_patrocinio_consumes_before_estandar(): void
    {
        $this->createBaseData();
        Carbon::setTestNow(Carbon::parse('2026-08-01'));

        // Patrocinio demands more than capacity
        $patrocinio = $this->createOrderLine([
            'name' => 'High Patrocinio',
            'priority_tier' => 'patrocinio',
            'target_spots' => 15500, // budget = 500
        ]);
        $estandar = $this->createOrderLine([
            'name' => 'Estandar Line',
            'priority_tier' => 'estandar',
            'target_spots' => 620, // budget = 20
        ]);

        $lines = collect([$patrocinio, $estandar]);
        // With capacity=50, patrocinio demands 500, so it gets all 50 via proportional (only 1 line → 50)
        $result = $this->engine->runWaterfall($lines, 50);

        // Patrocinio: floor(50 * 100/100) = 50
        // Estandar: remaining = 0, gets nothing
        $this->assertEquals(50, $result['allocations'][0]['count']);
        $this->assertCount(1, $result['allocations']); // estandar level has 0 remaining
        $this->assertEquals(0, $result['ssp_slots']);
        $this->assertEquals(0, $result['playlist_slots']);

        Carbon::setTestNow();
    }

    public function test_waterfall_no_active_lines_100_percent_playlist(): void
    {
        $result = $this->engine->runWaterfall(collect(), 100);

        $this->assertEmpty($result['allocations']);
        $this->assertEquals(0, $result['ssp_slots']);
        $this->assertEquals(100, $result['playlist_slots']);
    }

    public function test_waterfall_remainder_split_odd(): void
    {
        $this->createBaseData();
        Carbon::setTestNow(Carbon::parse('2026-08-01'));

        $line = $this->createOrderLine([
            'name' => 'Line',
            'priority_tier' => 'patrocinio',
            'target_spots' => 310, // budget = 10
        ]);

        $lines = collect([$line]);
        // capacity = 21, line gets 10, remainder = 11
        // ssp = floor(11/2) = 5, playlist = 6
        $result = $this->engine->runWaterfall($lines, 21);

        $this->assertEquals(10, $result['allocations'][0]['count']);
        $this->assertEquals(5, $result['ssp_slots']);
        $this->assertEquals(6, $result['playlist_slots']);

        Carbon::setTestNow();
    }

    public function test_waterfall_over_capacity_proportional_equal_weight(): void
    {
        $this->createBaseData();
        Carbon::setTestNow(Carbon::parse('2026-08-01'));

        // Two patrocinio lines that together exceed capacity
        $line1 = $this->createOrderLine([
            'name' => 'Pat 1',
            'priority_tier' => 'patrocinio',
            'target_spots' => 3100, // budget = 100
        ]);
        $line2 = $this->createOrderLine([
            'name' => 'Pat 2',
            'priority_tier' => 'patrocinio',
            'target_spots' => 3100, // budget = 100
        ]);

        $lines = collect([$line1, $line2]);
        // Total demand = 200, capacity = 50 → over-capacity (all uniform)
        $result = $this->engine->runWaterfall($lines, 50);

        // allocateWithCaps: uniform lines get min(budget, remaining) sequentially
        // line1: min(100, 50) = 50, line2: min(100, 0) = 0
        $this->assertEquals(50, $result['allocations'][0]['count']);
        $this->assertEquals(0, $result['allocations'][1]['count']);
        // Remaining: 50 - 50 - 0 = 0
        $this->assertEquals(0, $result['ssp_slots']);
        $this->assertEquals(0, $result['playlist_slots']);

        Carbon::setTestNow();
    }

    // =========================================================================
    // recalculate integration tests
    // =========================================================================

    public function test_recalculate_returns_correct_structure(): void
    {
        $this->createBaseData();
        $today = '2026-08-05';
        Carbon::setTestNow(Carbon::parse($today));

        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Active Order',            'status' => 'active',
        ]);

        $line = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Active Line',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-31',
            'target_spots' => 100,
            'delivery_pace' => 'uniform',
            'status' => 'active',
        ]);

        Creative::create([
            'order_line_id' => $line->id,
            'content_id' => $this->content->id,
            'weight' => 100,
            'active_dates' => [$today],
        ]);

        OrderLineTarget::create([
            'order_line_id' => $line->id,
            'screen_id' => $this->screen->id,
            'screen_group_id' => null,
        ]);

        $result = $this->engine->recalculate($this->screen->id, false);

        $this->assertArrayHasKey('screen_id', $result);
        $this->assertArrayHasKey('total_daily_spots', $result);
        $this->assertArrayHasKey('capacity', $result);
        $this->assertArrayHasKey('allocations', $result);
        $this->assertArrayHasKey('ssp_slots', $result);
        $this->assertArrayHasKey('playlist_slots', $result);
        $this->assertArrayHasKey('sequence', $result);
        $this->assertEquals($this->screen->id, $result['screen_id']);

        Carbon::setTestNow();
    }

    public function test_recalculate_intra_day_uses_remaining_capacity(): void
    {
        $this->createBaseData();
        $today = '2026-08-05';
        Carbon::setTestNow(Carbon::parse($today));

        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Active Order',            'status' => 'active',
        ]);

        $line = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Active Line',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-31',
            'target_spots' => 100,
            'delivery_pace' => 'uniform',
            'status' => 'active',
        ]);

        $creative = Creative::create([
            'order_line_id' => $line->id,
            'content_id' => $this->content->id,
            'weight' => 100,
            'active_dates' => [$today],
        ]);

        OrderLineTarget::create([
            'order_line_id' => $line->id,
            'screen_id' => $this->screen->id,
            'screen_group_id' => null,
        ]);

        // Create some impressions today
        for ($i = 0; $i < 100; $i++) {
            Impression::create([
                'screen_id' => $this->screen->id,
                'creative_id' => $creative->id,
                'order_line_id' => $line->id,
                'source' => 'order_line',
                'started_at' => Carbon::today()->addHours(10)->toDateTimeString(),
                'result' => 'success',
            ]);
        }

        // total_daily_spots = 86400/10 = 8640
        // intra-day capacity = 8640 - 100 = 8540
        $result = $this->engine->recalculate($this->screen->id, true);

        $this->assertEquals(8640, $result['total_daily_spots']);
        $this->assertEquals(8540, $result['capacity']);

        Carbon::setTestNow();
    }

    public function test_recalculate_no_active_lines_all_playlist(): void
    {
        $this->createBaseData();
        Carbon::setTestNow(Carbon::parse('2026-08-05'));

        // No order lines at all
        $result = $this->engine->recalculate($this->screen->id, false);

        $this->assertEmpty($result['allocations']);
        $this->assertEquals(0, $result['ssp_slots']);
        $this->assertEquals(8640, $result['playlist_slots']); // All capacity goes to playlist
        $this->assertEmpty($result['sequence']);

        Carbon::setTestNow();
    }
}
