<?php

namespace Tests\Unit;

use App\Models\Order;
use App\Models\OrderLine;
use App\Models\Tenant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TargetSpotsCalculationTest extends TestCase
{
    use RefreshDatabase;

    // ─── By-slot target_spots calculation on creation ──

    public function test_patrocinio_by_slot_calculates_target_spots_on_creation(): void
    {
        // Tenant with num_slots=10, duration=10s, no schedule (default 57600s operating window)
        // loops_per_day = 57600 / (10 * 10) = 576
        $tenant = Tenant::factory()->create([
            'num_slots' => 10,
            'default_duration_seconds' => 10,
            'default_schedule' => null,
        ]);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);

        $orderLine = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Patrocinio Line',
            'priority_tier' => 'patrocinio',
            'by_slot' => true,
            'slots_purchased' => 3,
            'starts_at' => '2025-01-01',
            'ends_at' => '2025-12-31',
            'target_spots' => 0, // will be overwritten
            'delivery_pace' => 'uniform',
            'share_weight' => 1,
            'status' => 'draft',
        ]);

        // target_spots = 3 slots × 576 loops_per_day = 1728
        $this->assertEquals(1728, $orderLine->fresh()->target_spots);
    }

    public function test_patrocinio_by_slot_with_custom_schedule(): void
    {
        // Tenant with 12h operating window (06:00-18:00 = 43200s)
        // loops_per_day = 43200 / (10 * 10) = 432
        $tenant = Tenant::factory()->create([
            'num_slots' => 10,
            'default_duration_seconds' => 10,
            'default_schedule' => [
                ['days' => [1, 2, 3, 4, 5, 6, 7], 'start' => '06:00', 'end' => '18:00'],
            ],
        ]);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);

        $orderLine = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Patrocinio Line',
            'priority_tier' => 'patrocinio',
            'by_slot' => true,
            'slots_purchased' => 2,
            'starts_at' => '2025-01-01',
            'ends_at' => '2025-12-31',
            'target_spots' => 0,
            'delivery_pace' => 'uniform',
            'share_weight' => 1,
            'status' => 'draft',
        ]);

        // target_spots = 2 × 432 = 864
        $this->assertEquals(864, $orderLine->fresh()->target_spots);
    }

    public function test_patrocinio_by_slot_with_custom_num_slots_and_duration(): void
    {
        // num_slots=20, duration=15s, no schedule (57600s default)
        // loops_per_day = 57600 / (20 * 15) = 192
        $tenant = Tenant::factory()->create([
            'num_slots' => 20,
            'default_duration_seconds' => 15,
            'default_schedule' => null,
        ]);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);

        $orderLine = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Patrocinio Line',
            'priority_tier' => 'patrocinio',
            'by_slot' => true,
            'slots_purchased' => 5,
            'starts_at' => '2025-01-01',
            'ends_at' => '2025-12-31',
            'target_spots' => 0,
            'delivery_pace' => 'uniform',
            'share_weight' => 1,
            'status' => 'draft',
        ]);

        // target_spots = 5 × 192 = 960
        $this->assertEquals(960, $orderLine->fresh()->target_spots);
    }

    // ─── By-slot disabled: does not overwrite target_spots ──

    public function test_patrocinio_without_by_slot_does_not_overwrite_target_spots(): void
    {
        $tenant = Tenant::factory()->create([
            'num_slots' => 10,
            'default_duration_seconds' => 10,
            'default_schedule' => null,
        ]);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);

        $orderLine = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Patrocinio Line Manual',
            'priority_tier' => 'patrocinio',
            'by_slot' => false,
            'slots_purchased' => null,
            'starts_at' => '2025-01-01',
            'ends_at' => '2025-12-31',
            'target_spots' => 5000,
            'delivery_pace' => 'uniform',
            'share_weight' => 1,
            'status' => 'draft',
        ]);

        // target_spots should remain as manually set
        $this->assertEquals(5000, $orderLine->fresh()->target_spots);
    }

    // ─── Non-patrocinio tier: never calculates ──

    public function test_estandar_with_by_slot_does_not_calculate_target_spots(): void
    {
        $tenant = Tenant::factory()->create([
            'num_slots' => 10,
            'default_duration_seconds' => 10,
            'default_schedule' => null,
        ]);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);

        $orderLine = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Estandar Line',
            'priority_tier' => 'estandar',
            'by_slot' => true,
            'slots_purchased' => 3,
            'starts_at' => '2025-01-01',
            'ends_at' => '2025-12-31',
            'target_spots' => 2000,
            'delivery_pace' => 'asap',
            'share_weight' => 1,
            'status' => 'draft',
        ]);

        // target_spots should NOT be recalculated for non-patrocinio
        $this->assertEquals(2000, $orderLine->fresh()->target_spots);
    }

    // ─── target_spots remains fixed after creation ──

    public function test_target_spots_does_not_recalculate_when_num_slots_changes(): void
    {
        $tenant = Tenant::factory()->create([
            'num_slots' => 10,
            'default_duration_seconds' => 10,
            'default_schedule' => null,
        ]);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);

        $orderLine = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Patrocinio Fixed',
            'priority_tier' => 'patrocinio',
            'by_slot' => true,
            'slots_purchased' => 2,
            'starts_at' => '2025-01-01',
            'ends_at' => '2025-12-31',
            'target_spots' => 0,
            'delivery_pace' => 'uniform',
            'share_weight' => 1,
            'status' => 'draft',
        ]);

        // Initial: target_spots = 2 × 576 = 1152
        $this->assertEquals(1152, $orderLine->fresh()->target_spots);

        // Now change num_slots on the tenant
        $tenant->update(['num_slots' => 20]);

        // Update the order line with an unrelated field change
        $orderLine->refresh();
        $orderLine->update(['name' => 'Patrocinio Fixed Updated']);

        // target_spots should remain 1152 (not recalculated)
        $this->assertEquals(1152, $orderLine->fresh()->target_spots);
    }

    // ─── Recalculate when slots_purchased changes ──

    public function test_target_spots_recalculates_when_slots_purchased_changes(): void
    {
        $tenant = Tenant::factory()->create([
            'num_slots' => 10,
            'default_duration_seconds' => 10,
            'default_schedule' => null,
        ]);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);

        $orderLine = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Patrocinio Recalc',
            'priority_tier' => 'patrocinio',
            'by_slot' => true,
            'slots_purchased' => 2,
            'starts_at' => '2025-01-01',
            'ends_at' => '2025-12-31',
            'target_spots' => 0,
            'delivery_pace' => 'uniform',
            'share_weight' => 1,
            'status' => 'draft',
        ]);

        // Initial: target_spots = 2 × 576 = 1152
        $this->assertEquals(1152, $orderLine->fresh()->target_spots);

        // Change slots_purchased to 4
        $orderLine->refresh();
        $orderLine->update(['slots_purchased' => 4]);

        // target_spots = 4 × 576 = 2304
        $this->assertEquals(2304, $orderLine->fresh()->target_spots);
    }

    // ─── Stores both slots_purchased and target_spots ──

    public function test_stores_both_slots_purchased_and_target_spots(): void
    {
        $tenant = Tenant::factory()->create([
            'num_slots' => 10,
            'default_duration_seconds' => 10,
            'default_schedule' => null,
        ]);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);

        $orderLine = OrderLine::create([
            'order_id' => $order->id,
            'name' => 'Patrocinio Both Fields',
            'priority_tier' => 'patrocinio',
            'by_slot' => true,
            'slots_purchased' => 3,
            'starts_at' => '2025-01-01',
            'ends_at' => '2025-12-31',
            'target_spots' => 0,
            'delivery_pace' => 'uniform',
            'share_weight' => 1,
            'status' => 'draft',
        ]);

        $fresh = $orderLine->fresh();
        $this->assertEquals(3, $fresh->slots_purchased);
        $this->assertEquals(1728, $fresh->target_spots);
        $this->assertTrue($fresh->by_slot);
    }
}
