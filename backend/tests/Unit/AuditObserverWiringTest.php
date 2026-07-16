<?php

namespace Tests\Unit;

use App\Models\AuditLog;
use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * Integration test verifying AuditService observers are wired to all auditable models.
 *
 * Ensures that Order, OrderLine, Creative, and OrderLineTarget model changes
 * trigger audit_log creation with correct event types and diff values.
 *
 * **Validates: Requirements 11.1, 11.3, 11.6**
 */
class AuditObserverWiringTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        // Fake the queue to prevent manifest recalculation jobs from running
        Queue::fake();

        $this->admin = User::factory()->superAdmin()->create();
        $this->actingAs($this->admin);
    }

    // ─── Order Observer Tests ──────────────────────────────────────────────

    public function test_creating_order_logs_created_event(): void
    {
        $order = Order::factory()->create([
            'name' => 'Test Campaign',
            'advertiser_name' => 'Acme Corp',
        ]);

        $this->assertDatabaseHas('audit_logs', [
            'auditable_type' => Order::class,
            'auditable_id' => $order->id,
            'event_type' => 'created',
            'user_id' => $this->admin->id,
        ]);
    }

    public function test_updating_order_name_logs_name_changed_event(): void
    {
        $order = Order::withoutEvents(fn () => Order::factory()->create([
            'name' => 'Original Name',
        ]));

        $order->update(['name' => 'Updated Name']);

        $log = AuditLog::where('auditable_id', $order->id)
            ->where('event_type', 'name_changed')
            ->first();

        $this->assertNotNull($log);
        $this->assertEquals('name', $log->diff['field']);
        $this->assertEquals('Original Name', $log->diff['old_value']);
        $this->assertEquals('Updated Name', $log->diff['new_value']);
    }

    public function test_updating_order_status_logs_status_changed_event(): void
    {
        $order = Order::withoutEvents(fn () => Order::factory()->create([
            'status' => 'draft',
        ]));

        $order->update(['status' => 'active']);

        $log = AuditLog::where('auditable_id', $order->id)
            ->where('event_type', 'status_changed')
            ->first();

        $this->assertNotNull($log);
        $this->assertEquals('status', $log->diff['field']);
        $this->assertEquals('draft', $log->diff['old_value']);
        $this->assertEquals('active', $log->diff['new_value']);
    }

    public function test_updating_order_advertiser_logs_field_modified_event(): void
    {
        $order = Order::withoutEvents(fn () => Order::factory()->create([
            'advertiser_name' => 'Old Corp',
        ]));

        $order->update(['advertiser_name' => 'New Corp']);

        $log = AuditLog::where('auditable_id', $order->id)
            ->where('event_type', 'field_modified')
            ->first();

        $this->assertNotNull($log);
        $this->assertEquals('advertiser_name', $log->diff['field']);
        $this->assertEquals('Old Corp', $log->diff['old_value']);
        $this->assertEquals('New Corp', $log->diff['new_value']);
    }

    // ─── OrderLine Observer Tests ──────────────────────────────────────────

    public function test_creating_order_line_logs_created_event(): void
    {
        $orderLine = OrderLine::factory()->create([
            'name' => 'Test Line',
            'priority_tier' => 'estandar',
        ]);

        $this->assertDatabaseHas('audit_logs', [
            'auditable_type' => OrderLine::class,
            'auditable_id' => $orderLine->id,
            'event_type' => 'created',
            'user_id' => $this->admin->id,
        ]);
    }

    public function test_updating_order_line_status_logs_status_changed_event(): void
    {
        $orderLine = OrderLine::withoutEvents(fn () => OrderLine::factory()->create([
            'status' => 'draft',
            'priority_tier' => 'estandar',
        ]));

        $orderLine->update(['status' => 'active']);

        $log = AuditLog::where('auditable_id', $orderLine->id)
            ->where('auditable_type', OrderLine::class)
            ->where('event_type', 'status_changed')
            ->first();

        $this->assertNotNull($log);
        $this->assertEquals('status', $log->diff['field']);
        $this->assertEquals('draft', $log->diff['old_value']);
        $this->assertEquals('active', $log->diff['new_value']);
    }

    public function test_updating_order_line_name_logs_name_changed_event(): void
    {
        $orderLine = OrderLine::withoutEvents(fn () => OrderLine::factory()->create([
            'name' => 'Original Line',
            'priority_tier' => 'estandar',
        ]));

        $orderLine->update(['name' => 'Renamed Line']);

        $log = AuditLog::where('auditable_id', $orderLine->id)
            ->where('auditable_type', OrderLine::class)
            ->where('event_type', 'name_changed')
            ->first();

        $this->assertNotNull($log);
        $this->assertEquals('name', $log->diff['field']);
        $this->assertEquals('Original Line', $log->diff['old_value']);
        $this->assertEquals('Renamed Line', $log->diff['new_value']);
    }

    public function test_updating_order_line_target_spots_logs_spots_modified_event(): void
    {
        $orderLine = OrderLine::withoutEvents(fn () => OrderLine::factory()->create([
            'target_spots' => 100,
            'priority_tier' => 'estandar',
        ]));

        $orderLine->update(['target_spots' => 200]);

        $log = AuditLog::where('auditable_id', $orderLine->id)
            ->where('auditable_type', OrderLine::class)
            ->where('event_type', 'spots_modified')
            ->first();

        $this->assertNotNull($log);
        $this->assertEquals('target_spots', $log->diff['field']);
        $this->assertEquals(100, $log->diff['old_value']);
        $this->assertEquals(200, $log->diff['new_value']);
    }

    // ─── Creative Observer Tests ──────────────────────────────────────────

    public function test_creating_creative_logs_creative_added_on_parent_order_line(): void
    {
        $orderLine = OrderLine::withoutEvents(fn () => OrderLine::factory()->create([
            'priority_tier' => 'estandar',
        ]));

        $target = OrderLineTarget::withoutEvents(fn () => OrderLineTarget::factory()->create([
            'order_line_id' => $orderLine->id,
        ]));

        $creative = Creative::factory()->create([
            'order_line_target_id' => $target->id,
        ]);

        $log = AuditLog::where('auditable_id', $orderLine->id)
            ->where('auditable_type', OrderLine::class)
            ->where('event_type', 'creative_added')
            ->first();

        $this->assertNotNull($log);
        $this->assertEquals('creative_id', $log->diff['field']);
        $this->assertNull($log->diff['old_value']);
        $this->assertEquals($creative->id, $log->diff['new_value']);
    }

    public function test_deleting_creative_logs_creative_removed_on_parent_order_line(): void
    {
        $orderLine = OrderLine::withoutEvents(fn () => OrderLine::factory()->create([
            'priority_tier' => 'estandar',
        ]));

        $target = OrderLineTarget::withoutEvents(fn () => OrderLineTarget::factory()->create([
            'order_line_id' => $orderLine->id,
        ]));

        $creative = Creative::withoutEvents(fn () => Creative::factory()->create([
            'order_line_target_id' => $target->id,
        ]));

        $creative->delete();

        $log = AuditLog::where('auditable_id', $orderLine->id)
            ->where('auditable_type', OrderLine::class)
            ->where('event_type', 'creative_removed')
            ->first();

        $this->assertNotNull($log);
        $this->assertEquals('creative_id', $log->diff['field']);
        $this->assertEquals($creative->id, $log->diff['old_value']);
        $this->assertNull($log->diff['new_value']);
    }

    public function test_updating_creative_weight_logs_field_modified(): void
    {
        $creative = Creative::withoutEvents(fn () => Creative::factory()->create([
            'weight' => 1,
        ]));

        $creative->update(['weight' => 5]);

        $log = AuditLog::where('auditable_id', $creative->id)
            ->where('auditable_type', Creative::class)
            ->where('event_type', 'field_modified')
            ->first();

        $this->assertNotNull($log);
        $this->assertEquals('weight', $log->diff['field']);
        $this->assertEquals(1, $log->diff['old_value']);
        $this->assertEquals(5, $log->diff['new_value']);
    }

    // ─── OrderLineTarget Observer Tests ──────────────────────────────────

    public function test_creating_target_logs_target_added_on_parent_order_line(): void
    {
        $orderLine = OrderLine::withoutEvents(fn () => OrderLine::factory()->create([
            'priority_tier' => 'estandar',
        ]));

        $screen = Screen::factory()->create();

        $target = OrderLineTarget::create([
            'order_line_id' => $orderLine->id,
            'screen_id' => $screen->id,
        ]);

        $log = AuditLog::where('auditable_id', $orderLine->id)
            ->where('auditable_type', OrderLine::class)
            ->where('event_type', 'target_added')
            ->first();

        $this->assertNotNull($log);
        $this->assertEquals('target', $log->diff['field']);
        $this->assertNull($log->diff['old_value']);
        $this->assertStringContains('screen:', $log->diff['new_value']);
    }

    public function test_deleting_target_logs_target_removed_on_parent_order_line(): void
    {
        $orderLine = OrderLine::withoutEvents(fn () => OrderLine::factory()->create([
            'priority_tier' => 'estandar',
        ]));

        $screen = Screen::factory()->create();

        $target = OrderLineTarget::withoutEvents(fn () => OrderLineTarget::create([
            'order_line_id' => $orderLine->id,
            'screen_id' => $screen->id,
        ]));

        $target->delete();

        $log = AuditLog::where('auditable_id', $orderLine->id)
            ->where('auditable_type', OrderLine::class)
            ->where('event_type', 'target_removed')
            ->first();

        $this->assertNotNull($log);
        $this->assertEquals('target', $log->diff['field']);
        $this->assertStringContains("screen:{$screen->id}", $log->diff['old_value']);
        $this->assertNull($log->diff['new_value']);
    }

    // ─── User ID Tracking ──────────────────────────────────────────────────

    public function test_audit_log_records_authenticated_user_id(): void
    {
        $order = Order::factory()->create();

        $log = AuditLog::where('auditable_id', $order->id)
            ->where('event_type', 'created')
            ->first();

        $this->assertNotNull($log);
        $this->assertEquals($this->admin->id, $log->user_id);
    }

    // ─── Helper ─────────────────────────────────────────────────────────────

    /**
     * Custom assertion for string contains (works with PHPUnit 10+).
     */
    private function assertStringContains(string $needle, string $haystack): void
    {
        $this->assertTrue(
            str_contains($haystack, $needle),
            "Expected string to contain '{$needle}', got '{$haystack}'"
        );
    }
}
