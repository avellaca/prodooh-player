<?php

namespace Tests\Feature;

use App\Models\Content;
use App\Models\Creative;
use App\Models\Impression;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class OrderModelTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;
    private Screen $screen;
    private ScreenGroup $screenGroup;
    private Content $content;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::factory()->create();
        $this->screenGroup = ScreenGroup::factory()->create(['tenant_id' => $this->tenant->id]);
        $this->screen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'group_id' => $this->screenGroup->id,
        ]);
        $this->content = Content::create([
            'tenant_id' => $this->tenant->id,
            'filename' => 'test-video.mp4',
            'mime_type' => 'video/mp4',
            'storage_path' => '/storage/test-video.mp4',
            'file_size_bytes' => 1024000,
            'width' => 1920,
            'height' => 1080,
            'duration_seconds' => 30,
            'orientation' => 'landscape',
            'rotation' => 0,
            'checksum_sha256' => hash('sha256', 'test-content'),
        ]);
    }

    // =========================================================================
    // 15.1 — Full hierarchy creation (Order → OrderLine → Creative → Impression)
    // =========================================================================

    public function test_full_hierarchy_creation(): void
    {
        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Campaign Q3',
            'advertiser_name' => 'Acme Corp',
            'status' => 'active',
        ]);

        $this->assertNotNull($order->id);
        $this->assertEquals('Campaign Q3', $order->name);

        $orderLine = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Line 1 - Patrocinio',
            'priority_tier' => 'patrocinio',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-15',
            'target_spots' => 1000,
            'delivery_pace' => 'uniform',
            'share_weight' => 100,
            'status' => 'active',
        ]);

        $this->assertNotNull($orderLine->id);
        $this->assertEquals($order->id, $orderLine->order_id);

        $target = OrderLineTarget::create([
            'order_line_id' => $orderLine->id,
            'screen_id' => $this->screen->id,
            'screen_group_id' => null,
        ]);

        $creative = Creative::create([
            'order_line_target_id' => $target->id,
            'order_line_id' => $orderLine->id,
            'content_id' => $this->content->id,
            'weight' => 80,
        ]);

        $this->assertNotNull($creative->id);
        $this->assertEquals($orderLine->id, $creative->order_line_id);
        $this->assertEquals($this->content->id, $creative->content_id);

        $impression = Impression::create([
            'screen_id' => $this->screen->id,
            'creative_id' => $creative->id,
            'order_line_id' => $orderLine->id,
            'source' => 'order_line',
            'started_at' => '2026-08-01 10:00:00',
            'ended_at' => '2026-08-01 10:00:30',
            'duration_seconds' => 30.00,
            'result' => 'success',
        ]);

        $this->assertNotNull($impression->id);
        $this->assertEquals($this->screen->id, $impression->screen_id);
        $this->assertEquals($creative->id, $impression->creative_id);

        // Verify relationships
        $this->assertEquals(1, $order->orderLines()->count());
        $this->assertEquals(1, $orderLine->creatives()->count());
        $this->assertEquals(1, $creative->impressions()->count());
        $this->assertEquals($order->id, $orderLine->order->id);
        $this->assertEquals($orderLine->id, $creative->orderLine->id);
        $this->assertEquals($creative->id, $impression->creative->id);
    }

    // =========================================================================
    // 15.2 — Cascade delete: deleting Order cascades through all children
    // =========================================================================

    public function test_cascade_delete_order_removes_all_children(): void
    {
        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Cascade Test Order',
            'status' => 'draft',
        ]);

        $orderLine = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Cascade Line',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-15',
            'status' => 'draft',
        ]);

        $creative = Creative::create([
            'order_line_id' => $orderLine->id,
            'content_id' => $this->content->id,
            'weight' => 100,
        ]);

        $target = OrderLineTarget::create([
            'order_line_id' => $orderLine->id,
            'screen_id' => $this->screen->id,
            'screen_group_id' => null,
        ]);

        // Delete the order
        $order->delete();

        // Verify all children are gone
        $this->assertDatabaseMissing('orders', ['id' => $order->id]);
        $this->assertDatabaseMissing('order_lines', ['id' => $orderLine->id]);
        $this->assertDatabaseMissing('creatives', ['id' => $creative->id]);
        $this->assertDatabaseMissing('order_line_targets', ['id' => $target->id]);
    }

    // =========================================================================
    // 15.3 — Set-null on delete: deleting Creative sets creative_id to null in Impressions
    // =========================================================================

    public function test_set_null_on_creative_delete(): void
    {
        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Set Null Test',
            'status' => 'draft',
        ]);

        $orderLine = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Line for set null',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-15',
            'status' => 'draft',
        ]);

        $creative = Creative::create([
            'order_line_id' => $orderLine->id,
            'content_id' => $this->content->id,
            'weight' => 100,
        ]);

        $impression = Impression::create([
            'screen_id' => $this->screen->id,
            'creative_id' => $creative->id,
            'order_line_id' => $orderLine->id,
            'source' => 'order_line',
            'started_at' => '2026-08-01 10:00:00',
            'result' => 'success',
        ]);

        // Delete the creative
        $creative->delete();

        // Impression still exists but creative_id is null
        $this->assertDatabaseHas('impressions', ['id' => $impression->id]);
        $impression->refresh();
        $this->assertNull($impression->creative_id);
        // order_line_id is preserved
        $this->assertEquals($orderLine->id, $impression->order_line_id);
    }

    // =========================================================================
    // 15.4 — RESTRICT: cannot delete Content that is referenced by a Creative
    // =========================================================================

    public function test_restrict_delete_content_referenced_by_creative(): void
    {
        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Restrict Test',
            'status' => 'draft',
        ]);

        $orderLine = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Line for restrict',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-15',
            'status' => 'draft',
        ]);

        Creative::create([
            'order_line_id' => $orderLine->id,
            'content_id' => $this->content->id,
            'weight' => 100,
        ]);

        // Attempt to delete Content should fail with a DB constraint violation
        $this->expectException(\Illuminate\Database\QueryException::class);
        $this->content->delete();
    }

    // =========================================================================
    // 15.5 — Computed dates: Order starts_at/ends_at derived from order lines
    // =========================================================================

    public function test_order_dates_computed_from_order_lines(): void
    {
        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Computed Dates Order',
            'status' => 'draft',
        ]);

        // No lines → null dates
        $this->assertNull($order->starts_at);
        $this->assertNull($order->ends_at);

        // Add first line
        OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Line 1',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-05',
            'ends_at' => '2026-08-20',
            'status' => 'draft',
        ]);

        $order->refresh();
        $this->assertEquals('2026-08-05', $order->starts_at->toDateString());
        $this->assertEquals('2026-08-20', $order->ends_at->toDateString());

        // Add second line with wider range
        OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Line 2',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-31',
            'status' => 'draft',
        ]);

        $order->refresh();
        $this->assertEquals('2026-08-01', $order->starts_at->toDateString());
        $this->assertEquals('2026-08-31', $order->ends_at->toDateString());
    }

    public function test_order_default_status_is_draft(): void
    {
        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Default Status Order',
        ]);

        $this->assertEquals('draft', $order->status);
    }

    // =========================================================================
    // 15.7 — (Removed) Order date shrink tests are obsolete since dates are computed
    // =========================================================================

    // =========================================================================
    // 15.8 — XOR validation: OrderLineTarget rejects invalid combinations
    // =========================================================================

    public function test_order_line_target_rejects_both_null(): void
    {
        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'XOR Test Order',
            'status' => 'draft',
        ]);

        $orderLine = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'XOR Line',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-15',
            'status' => 'draft',
        ]);

        $this->expectException(ValidationException::class);
        OrderLineTarget::create([
            'order_line_id' => $orderLine->id,
            'screen_id' => null,
            'screen_group_id' => null,
        ]);
    }

    public function test_order_line_target_rejects_both_present(): void
    {
        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'XOR Test Order 2',
            'status' => 'draft',
        ]);

        $orderLine = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'XOR Line 2',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-15',
            'status' => 'draft',
        ]);

        $this->expectException(ValidationException::class);
        OrderLineTarget::create([
            'order_line_id' => $orderLine->id,
            'screen_id' => $this->screen->id,
            'screen_group_id' => $this->screenGroup->id,
        ]);
    }

    public function test_order_line_target_accepts_only_screen_id(): void
    {
        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'XOR Valid Screen',
            'status' => 'draft',
        ]);

        $orderLine = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Valid Target Line',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-15',
            'status' => 'draft',
        ]);

        $target = OrderLineTarget::create([
            'order_line_id' => $orderLine->id,
            'screen_id' => $this->screen->id,
            'screen_group_id' => null,
        ]);

        $this->assertNotNull($target->id);
        $this->assertEquals($this->screen->id, $target->screen_id);
        $this->assertNull($target->screen_group_id);
    }

    public function test_order_line_target_accepts_only_screen_group_id(): void
    {
        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'XOR Valid Group',
            'status' => 'draft',
        ]);

        $orderLine = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Valid Group Target Line',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-01',
            'ends_at' => '2026-08-15',
            'status' => 'draft',
        ]);

        $target = OrderLineTarget::create([
            'order_line_id' => $orderLine->id,
            'screen_id' => null,
            'screen_group_id' => $this->screenGroup->id,
        ]);

        $this->assertNotNull($target->id);
        $this->assertNull($target->screen_id);
        $this->assertEquals($this->screenGroup->id, $target->screen_group_id);
    }

    // =========================================================================
    // 15.9 — CHECK constraints at DB level: insert with ends_at < starts_at fails
    // (Order-level constraint removed since dates are now computed from order_lines)
    // =========================================================================

    public function test_check_constraint_order_lines_ends_before_starts_fails(): void
    {
        $order = Order::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Check Constraint Parent',
            'status' => 'draft',
        ]);

        $this->expectException(\Illuminate\Database\QueryException::class);

        DB::table('order_lines')->insert([
            'id' => \Illuminate\Support\Str::uuid()->toString(),
            'order_id' => $order->id,
            'name' => 'Invalid Line',
            'priority_tier' => 'estandar',
            'starts_at' => '2026-08-20',
            'ends_at' => '2026-08-10', // ends before starts
            'delivery_pace' => 'uniform',
            'share_weight' => 100,
            'status' => 'draft',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
