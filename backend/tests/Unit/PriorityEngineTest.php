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

class PriorityEngineTest extends TestCase
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
            'default_duration_seconds' => 15,
            'default_schedule' => null,
        ]);

        $this->group = ScreenGroup::factory()->create([
            'tenant_id' => $this->tenant->id,
            'duration_seconds' => 20,
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

    // =========================================================================
    // calculateTotalDailySpots tests
    // =========================================================================

    public function test_total_daily_spots_uses_group_duration_over_tenant(): void
    {
        $this->createBaseData();
        // group has 20s, tenant has 15s → should use 20s
        // No schedule → 86400s window
        // Expected: floor(86400 / 20) = 4320
        $spots = $this->engine->calculateTotalDailySpots($this->screen);
        $this->assertEquals(4320, $spots);
    }

    public function test_total_daily_spots_falls_back_to_tenant_duration(): void
    {
        $this->createBaseData();
        $this->group->update(['duration_seconds' => null]);
        $this->screen->load('screenGroup');

        // tenant has 15s, no group duration
        // Expected: floor(86400 / 15) = 5760
        $spots = $this->engine->calculateTotalDailySpots($this->screen);
        $this->assertEquals(5760, $spots);
    }

    public function test_total_daily_spots_falls_back_to_global_default(): void
    {
        // Create tenant with 0 duration (treated as falsy → falls through to default)
        $tenant = Tenant::factory()->create([
            'default_duration_seconds' => 0,
        ]);

        $group = ScreenGroup::factory()->create([
            'tenant_id' => $tenant->id,
            'duration_seconds' => null,
        ]);

        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'group_id' => $group->id,
            'schedule' => null,
        ]);

        // No group duration, tenant duration is 0 (falsy) → 10s global default
        // Expected: floor(86400 / 10) = 8640
        $spots = $this->engine->calculateTotalDailySpots($screen);
        $this->assertEquals(8640, $spots);
    }

    public function test_total_daily_spots_uses_screen_schedule(): void
    {
        $this->createBaseData();

        // Set screen schedule: Monday-Friday 09:00-17:00 (8 hours = 28800s)
        $this->screen->update(['schedule' => [
            ['days' => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
             'start' => '09:00', 'end' => '17:00'],
        ]]);

        // Freeze time to a Wednesday
        Carbon::setTestNow(Carbon::parse('2026-07-08')); // Wednesday

        $spots = $this->engine->calculateTotalDailySpots($this->screen);
        // 28800 / 20 = 1440
        $this->assertEquals(1440, $spots);

        Carbon::setTestNow();
    }

    public function test_total_daily_spots_with_multiple_schedule_rules(): void
    {
        $this->createBaseData();

        // Two time blocks on Wednesday: 08:00-12:00 + 14:00-18:00
        $this->screen->update(['schedule' => [
            ['days' => ['wednesday'], 'start' => '08:00', 'end' => '12:00'],
            ['days' => ['wednesday'], 'start' => '14:00', 'end' => '18:00'],
        ]]);

        Carbon::setTestNow(Carbon::parse('2026-07-08')); // Wednesday

        $spots = $this->engine->calculateTotalDailySpots($this->screen);
        // (4*3600 + 4*3600) / 20 = 28800 / 20 = 1440
        $this->assertEquals(1440, $spots);

        Carbon::setTestNow();
    }

    public function test_total_daily_spots_schedule_hierarchy_group(): void
    {
        $this->createBaseData();

        // No screen schedule, group has schedule
        $this->group->update(['schedule' => [
            ['days' => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
             'start' => '06:00', 'end' => '22:00'],
        ]]);
        $this->screen->load('screenGroup');

        Carbon::setTestNow(Carbon::parse('2026-07-08')); // Wednesday

        $spots = $this->engine->calculateTotalDailySpots($this->screen);
        // 16h = 57600s, 57600 / 20 = 2880
        $this->assertEquals(2880, $spots);

        Carbon::setTestNow();
    }

    public function test_total_daily_spots_schedule_hierarchy_tenant(): void
    {
        $this->createBaseData();

        // No screen or group schedule, tenant has schedule
        $this->tenant->update(['default_schedule' => [
            ['days' => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday',
                        'saturday', 'sunday'],
             'start' => '08:00', 'end' => '20:00'],
        ]]);
        $this->screen->load('screenGroup.tenant');

        Carbon::setTestNow(Carbon::parse('2026-07-08')); // Wednesday

        $spots = $this->engine->calculateTotalDailySpots($this->screen);
        // 12h = 43200s, 43200 / 20 = 2160
        $this->assertEquals(2160, $spots);

        Carbon::setTestNow();
    }

    // =========================================================================
    // calculateDailyBudget tests
    // =========================================================================

    public function test_daily_budget_uniform_pace(): void
    {
        $this->createBaseData();

        Carbon::setTestNow(Carbon::parse('2026-08-01'));

        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Test Order',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-10',
            'status' => 'active',
        ]);

        $line = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Uniform Line',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-10',
            'target_spots' => 100,
            'delivery_pace' => 'uniform',
            'share_weight' => 100,
            'status' => 'active',
        ]);

        // No impressions delivered, 10 days remaining (Aug 1-10 inclusive)
        $budget = $this->engine->calculateDailyBudget($line);
        // ceil(100 / 10) = 10
        $this->assertEquals(10, $budget);

        Carbon::setTestNow();
    }

    public function test_daily_budget_uniform_with_partial_delivery(): void
    {
        $this->createBaseData();

        Carbon::setTestNow(Carbon::parse('2026-08-05'));

        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Test Order',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-10',
            'status' => 'active',
        ]);

        $line = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Uniform Line',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-10',
            'target_spots' => 100,
            'delivery_pace' => 'uniform',
            'share_weight' => 100,
            'status' => 'active',
        ]);

        $creative = Creative::create([
            'order_line_id' => $line->id,
            'content_id' => $this->content->id,
            'weight' => 100,
            'active_dates' => ['2026-08-05'],
        ]);

        // Create 40 successful impressions
        for ($i = 0; $i < 40; $i++) {
            Impression::create([
                'screen_id' => $this->screen->id,
                'creative_id' => $creative->id,
                'order_line_id' => $line->id,
                'source' => 'order_line',
                'started_at' => '2026-08-03 10:00:00',
                'result' => 'success',
            ]);
        }

        // remaining = 100 - 40 = 60, remaining_days = 6 (Aug 5-10)
        // ceil(60 / 6) = 10
        $budget = $this->engine->calculateDailyBudget($line);
        $this->assertEquals(10, $budget);

        Carbon::setTestNow();
    }

    public function test_daily_budget_asap_pace(): void
    {
        $this->createBaseData();

        Carbon::setTestNow(Carbon::parse('2026-08-05'));

        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Test Order',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-10',
            'status' => 'active',
        ]);

        $line = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'ASAP Line',
            'priority_tier' => 'patrocinio',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-10',
            'target_spots' => 100,
            'delivery_pace' => 'asap',
            'share_weight' => 100,
            'status' => 'active',
        ]);

        // asap: target - delivered = 100 - 0 = 100
        $budget = $this->engine->calculateDailyBudget($line);
        $this->assertEquals(100, $budget);

        Carbon::setTestNow();
    }

    public function test_daily_budget_null_target_returns_null(): void
    {
        $this->createBaseData();

        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Test Order',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-10',
            'status' => 'active',
        ]);

        $line = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Unlimited Line',
            'priority_tier' => 'red_interna',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-10',
            'target_spots' => null,
            'delivery_pace' => 'uniform',
            'share_weight' => 50,
            'status' => 'active',
        ]);

        $budget = $this->engine->calculateDailyBudget($line);
        $this->assertNull($budget);
    }

    public function test_daily_budget_exhausted_target_returns_zero(): void
    {
        $this->createBaseData();

        Carbon::setTestNow(Carbon::parse('2026-08-05'));

        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Test Order',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-10',
            'status' => 'active',
        ]);

        $line = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Exhausted Line',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-10',
            'target_spots' => 5,
            'delivery_pace' => 'uniform',
            'share_weight' => 100,
            'status' => 'active',
        ]);

        $creative = Creative::create([
            'order_line_id' => $line->id,
            'content_id' => $this->content->id,
            'weight' => 100,
            'active_dates' => ['2026-08-05'],
        ]);

        // Create 5 successful impressions (target met)
        for ($i = 0; $i < 5; $i++) {
            Impression::create([
                'screen_id' => $this->screen->id,
                'creative_id' => $creative->id,
                'order_line_id' => $line->id,
                'source' => 'order_line',
                'started_at' => '2026-08-03 10:00:00',
                'result' => 'success',
            ]);
        }

        $budget = $this->engine->calculateDailyBudget($line);
        $this->assertEquals(0, $budget);

        Carbon::setTestNow();
    }

    // =========================================================================
    // filterActiveLines tests
    // =========================================================================

    public function test_filter_active_lines_includes_valid_line(): void
    {
        $this->createBaseData();
        $today = '2026-08-05';
        Carbon::setTestNow(Carbon::parse($today));

        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Active Order',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-31',
            'status' => 'active',
        ]);

        $line = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Valid Line',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-15',
            'target_spots' => 100,
            'delivery_pace' => 'uniform',
            'share_weight' => 100,
            'status' => 'active',
        ]);

        Creative::create([
            'order_line_id' => $line->id,
            'content_id' => $this->content->id,
            'weight' => 100,
            'active_dates' => [$today],
        ]);

        // Target directly at the screen
        OrderLineTarget::create([
            'order_line_id' => $line->id,
            'screen_id' => $this->screen->id,
            'screen_group_id' => null,
        ]);

        $activeLines = $this->engine->filterActiveLines($this->screen);
        $this->assertCount(1, $activeLines);
        $this->assertEquals($line->id, $activeLines->first()->id);

        Carbon::setTestNow();
    }

    public function test_filter_active_lines_includes_line_targeting_group(): void
    {
        $this->createBaseData();
        $today = '2026-08-05';
        Carbon::setTestNow(Carbon::parse($today));

        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Group Target Order',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-31',
            'status' => 'active',
        ]);

        $line = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Group Target Line',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-15',
            'target_spots' => 100,
            'delivery_pace' => 'uniform',
            'share_weight' => 100,
            'status' => 'active',
        ]);

        Creative::create([
            'order_line_id' => $line->id,
            'content_id' => $this->content->id,
            'weight' => 100,
            'active_dates' => [$today],
        ]);

        // Target via screen group
        OrderLineTarget::create([
            'order_line_id' => $line->id,
            'screen_id' => null,
            'screen_group_id' => $this->group->id,
        ]);

        $activeLines = $this->engine->filterActiveLines($this->screen);
        $this->assertCount(1, $activeLines);

        Carbon::setTestNow();
    }

    public function test_filter_excludes_inactive_order(): void
    {
        $this->createBaseData();
        $today = '2026-08-05';
        Carbon::setTestNow(Carbon::parse($today));

        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Draft Order',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-31',
            'status' => 'draft',
        ]);

        $line = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Draft Line',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-15',
            'target_spots' => 100,
            'delivery_pace' => 'uniform',
            'share_weight' => 100,
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

        $activeLines = $this->engine->filterActiveLines($this->screen);
        $this->assertCount(0, $activeLines);

        Carbon::setTestNow();
    }

    public function test_filter_excludes_line_with_exhausted_target(): void
    {
        $this->createBaseData();
        $today = '2026-08-05';
        Carbon::setTestNow(Carbon::parse($today));

        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Active Order',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-31',
            'status' => 'active',
        ]);

        $line = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Exhausted Target Line',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-15',
            'target_spots' => 5,
            'delivery_pace' => 'uniform',
            'share_weight' => 100,
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

        // Create 5 impressions = target met
        for ($i = 0; $i < 5; $i++) {
            Impression::create([
                'screen_id' => $this->screen->id,
                'creative_id' => $creative->id,
                'order_line_id' => $line->id,
                'source' => 'order_line',
                'started_at' => '2026-08-03 10:00:00',
                'result' => 'success',
            ]);
        }

        $activeLines = $this->engine->filterActiveLines($this->screen);
        $this->assertCount(0, $activeLines);

        Carbon::setTestNow();
    }

    public function test_filter_excludes_line_without_active_creative_today(): void
    {
        $this->createBaseData();
        $today = '2026-08-05';
        Carbon::setTestNow(Carbon::parse($today));

        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Active Order',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-31',
            'status' => 'active',
        ]);

        $line = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'No Creative Today',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-15',
            'target_spots' => 100,
            'delivery_pace' => 'uniform',
            'share_weight' => 100,
            'status' => 'active',
        ]);

        // Creative only active on different dates
        Creative::create([
            'order_line_id' => $line->id,
            'content_id' => $this->content->id,
            'weight' => 100,
            'active_dates' => ['2026-08-01', '2026-08-10'],
        ]);

        OrderLineTarget::create([
            'order_line_id' => $line->id,
            'screen_id' => $this->screen->id,
            'screen_group_id' => null,
        ]);

        $activeLines = $this->engine->filterActiveLines($this->screen);
        $this->assertCount(0, $activeLines);

        Carbon::setTestNow();
    }

    public function test_filter_excludes_line_outside_date_range(): void
    {
        $this->createBaseData();
        // Today is after both order and line ended
        $today = '2026-09-15';
        Carbon::setTestNow(Carbon::parse($today));

        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Active Order',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-09-30',
            'status' => 'active',
        ]);

        $line = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Expired Line',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-09-10',
            'target_spots' => 100,
            'delivery_pace' => 'uniform',
            'share_weight' => 100,
            'status' => 'active',
        ]);

        // Creative active on a date within the line range
        Creative::create([
            'order_line_id' => $line->id,
            'content_id' => $this->content->id,
            'weight' => 100,
            'active_dates' => ['2026-09-05'],
        ]);

        OrderLineTarget::create([
            'order_line_id' => $line->id,
            'screen_id' => $this->screen->id,
            'screen_group_id' => null,
        ]);

        // Line has ended (ends_at = Sep 10, today = Sep 15) → excluded
        $activeLines = $this->engine->filterActiveLines($this->screen);
        $this->assertCount(0, $activeLines);

        Carbon::setTestNow();
    }

    public function test_filter_excludes_line_not_targeting_screen(): void
    {
        $this->createBaseData();
        $today = '2026-08-05';
        Carbon::setTestNow(Carbon::parse($today));

        // Create a different screen group and screen
        $otherGroup = ScreenGroup::factory()->create([
            'tenant_id' => $this->tenant->id,
        ]);
        $otherScreen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'group_id' => $otherGroup->id,
        ]);

        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Active Order',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-31',
            'status' => 'active',
        ]);

        $line = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Other Screen Line',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-15',
            'target_spots' => 100,
            'delivery_pace' => 'uniform',
            'share_weight' => 100,
            'status' => 'active',
        ]);

        Creative::create([
            'order_line_id' => $line->id,
            'content_id' => $this->content->id,
            'weight' => 100,
            'active_dates' => [$today],
        ]);

        // Target at the OTHER screen, not this one
        OrderLineTarget::create([
            'order_line_id' => $line->id,
            'screen_id' => $otherScreen->id,
            'screen_group_id' => null,
        ]);

        $activeLines = $this->engine->filterActiveLines($this->screen);
        $this->assertCount(0, $activeLines);

        Carbon::setTestNow();
    }

    public function test_filter_includes_null_target_line(): void
    {
        $this->createBaseData();
        $today = '2026-08-05';
        Carbon::setTestNow(Carbon::parse($today));

        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Active Order',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-31',
            'status' => 'active',
        ]);

        $line = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'No Target Line',
            'priority_tier' => 'red_interna',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-15',
            'target_spots' => null,
            'delivery_pace' => 'uniform',
            'share_weight' => 50,
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

        $activeLines = $this->engine->filterActiveLines($this->screen);
        $this->assertCount(1, $activeLines);

        Carbon::setTestNow();
    }
}
