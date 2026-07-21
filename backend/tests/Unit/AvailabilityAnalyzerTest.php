<?php

namespace Tests\Unit;

use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use App\Services\AvailabilityAnalyzer;
use App\Services\AvailabilityResult;
use App\Services\LoopTemplateGenerator;
use App\Services\RotationScheduler;
use App\Services\SlotAllocator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AvailabilityAnalyzerTest extends TestCase
{
    use RefreshDatabase;

    private AvailabilityAnalyzer $analyzer;

    protected function setUp(): void
    {
        parent::setUp();

        $loopTemplateGenerator = new LoopTemplateGenerator(
            new SlotAllocator(),
            new RotationScheduler(),
        );

        $this->analyzer = new AvailabilityAnalyzer($loopTemplateGenerator);
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    private function createTenantWithConfig(array $overrides = []): Tenant
    {
        return Tenant::factory()->create(array_merge([
            'num_slots' => 10,
            'ssp_slots' => 2,
            'playlist_slots' => 1,
            'default_duration_seconds' => 10,
            'default_schedule' => null, // 57600s default operating window
        ], $overrides));
    }

    private function createScreenForTenant(Tenant $tenant, ?ScreenGroup $group = null): Screen
    {
        return Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'group_id' => $group?->id,
            'num_slots' => null,
        ]);
    }

    private function createActiveOrderLineTargetingScreen(
        Tenant $tenant,
        Screen $screen,
        array $lineOverrides = [],
    ): OrderLine {
        $order = Order::factory()->create(['tenant_id' => $tenant->id]);

        $line = OrderLine::factory()->create(array_merge([
            'order_id' => $order->id,
            'priority_tier' => 'estandar',
            'delivery_pace' => 'uniform',
            'status' => 'active',
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(30),
            'target_spots' => 1000,
        ], $lineOverrides));

        OrderLineTarget::factory()->create([
            'order_line_id' => $line->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);

        return $line;
    }

    // ─── Basic availability: sufficient capacity ────────────────────────────

    public function test_returns_sufficient_when_no_other_active_lines(): void
    {
        // Tenant: 10 slots, ssp=2, playlist=1 → ad_slots=7
        // loops_per_day = 57600 / (10 * 10) = 576
        // Available capacity = 576 * 7 = 4032
        $tenant = $this->createTenantWithConfig();
        $screen = $this->createScreenForTenant($tenant);
        $order = Order::factory()->create(['tenant_id' => $tenant->id]);

        $line = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'estandar',
            'delivery_pace' => 'uniform',
            'status' => 'draft',
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(30),
            'target_spots' => 2000,
        ]);

        OrderLineTarget::factory()->create([
            'order_line_id' => $line->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);

        $result = $this->analyzer->analyze($line);

        $this->assertInstanceOf(AvailabilityResult::class, $result);
        $this->assertTrue($result->isSufficient);
        $this->assertEquals(2000, $result->targetSpots);
        $this->assertEquals(4032, $result->availableCapacity);
        $this->assertNull($result->warningMessage);
    }

    // ─── Insufficient capacity ──────────────────────────────────────────────

    public function test_returns_insufficient_when_target_exceeds_capacity(): void
    {
        $tenant = $this->createTenantWithConfig();
        $screen = $this->createScreenForTenant($tenant);
        $order = Order::factory()->create(['tenant_id' => $tenant->id]);

        $line = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'estandar',
            'delivery_pace' => 'uniform',
            'status' => 'draft',
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(30),
            'target_spots' => 5000, // exceeds 4032 capacity
        ]);

        OrderLineTarget::factory()->create([
            'order_line_id' => $line->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);

        $result = $this->analyzer->analyze($line);

        $this->assertFalse($result->isSufficient);
        $this->assertEquals(5000, $result->targetSpots);
        $this->assertEquals(4032, $result->availableCapacity);
        $this->assertNotNull($result->warningMessage);
        $this->assertStringContainsString('5000', $result->warningMessage);
        $this->assertStringContainsString('4032', $result->warningMessage);
    }

    // ─── Considers other active lines ───────────────────────────────────────

    public function test_reduces_capacity_by_other_active_estandar_lines(): void
    {
        // ad_slots=7, loops_per_day=576
        // Another active estandar line consumes 1 slot → available = 576 * 6 = 3456
        $tenant = $this->createTenantWithConfig();
        $screen = $this->createScreenForTenant($tenant);

        // Create another active line on the same screen
        $this->createActiveOrderLineTargetingScreen($tenant, $screen, [
            'priority_tier' => 'estandar',
            'target_spots' => 500,
        ]);

        // Now create our line to analyze
        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $line = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'estandar',
            'delivery_pace' => 'uniform',
            'status' => 'draft',
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(30),
            'target_spots' => 3456,
        ]);

        OrderLineTarget::factory()->create([
            'order_line_id' => $line->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);

        $result = $this->analyzer->analyze($line);

        $this->assertTrue($result->isSufficient);
        $this->assertEquals(3456, $result->targetSpots);
        $this->assertEquals(3456, $result->availableCapacity);
    }

    public function test_reduces_capacity_by_patrocinio_slots_purchased(): void
    {
        // ad_slots=7, loops_per_day=576
        // Patrocinio line with slots_purchased=3 consumes 3 slots → available = 576 * 4 = 2304
        $tenant = $this->createTenantWithConfig();
        $screen = $this->createScreenForTenant($tenant);

        // Create patrocinio line consuming 3 slots
        $this->createActiveOrderLineTargetingScreen($tenant, $screen, [
            'priority_tier' => 'patrocinio',
            'delivery_pace' => 'uniform',
            'slots_purchased' => 3,
            'by_slot' => true,
            'target_spots' => 1728, // 3 * 576
        ]);

        // Now analyze our line
        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $line = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'estandar',
            'delivery_pace' => 'uniform',
            'status' => 'draft',
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(30),
            'target_spots' => 2304,
        ]);

        OrderLineTarget::factory()->create([
            'order_line_id' => $line->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);

        $result = $this->analyzer->analyze($line);

        $this->assertTrue($result->isSufficient);
        $this->assertEquals(2304, $result->targetSpots);
        $this->assertEquals(2304, $result->availableCapacity);
    }

    // ─── Multiple screens aggregate capacity ────────────────────────────────

    public function test_aggregates_capacity_across_multiple_targeted_screens(): void
    {
        // 2 screens, each with ad_slots=7, loops_per_day=576
        // Total capacity = 2 * (576 * 7) = 8064
        $tenant = $this->createTenantWithConfig();
        $screen1 = $this->createScreenForTenant($tenant);
        $screen2 = $this->createScreenForTenant($tenant);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $line = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'estandar',
            'delivery_pace' => 'uniform',
            'status' => 'draft',
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(30),
            'target_spots' => 7000,
        ]);

        // Target both screens
        OrderLineTarget::factory()->create([
            'order_line_id' => $line->id,
            'screen_id' => $screen1->id,
            'screen_group_id' => null,
        ]);
        OrderLineTarget::factory()->create([
            'order_line_id' => $line->id,
            'screen_id' => $screen2->id,
            'screen_group_id' => null,
        ]);

        $result = $this->analyzer->analyze($line);

        $this->assertTrue($result->isSufficient);
        $this->assertEquals(7000, $result->targetSpots);
        $this->assertEquals(8064, $result->availableCapacity);
    }

    // ─── No screens targeted ────────────────────────────────────────────────

    public function test_returns_zero_capacity_when_no_screens_targeted(): void
    {
        $tenant = $this->createTenantWithConfig();
        $order = Order::factory()->create(['tenant_id' => $tenant->id]);

        $line = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'estandar',
            'delivery_pace' => 'uniform',
            'status' => 'draft',
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(30),
            'target_spots' => 1000,
        ]);

        $result = $this->analyzer->analyze($line);

        $this->assertFalse($result->isSufficient);
        $this->assertEquals(1000, $result->targetSpots);
        $this->assertEquals(0, $result->availableCapacity);
        $this->assertNotNull($result->warningMessage);
    }

    // ─── Saturation percent calculation ─────────────────────────────────────

    public function test_calculates_saturation_percent_correctly(): void
    {
        $tenant = $this->createTenantWithConfig();
        $screen = $this->createScreenForTenant($tenant);
        $order = Order::factory()->create(['tenant_id' => $tenant->id]);

        // target = 2016 out of 4032 capacity → 50%
        $line = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'estandar',
            'delivery_pace' => 'uniform',
            'status' => 'draft',
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(30),
            'target_spots' => 2016,
        ]);

        OrderLineTarget::factory()->create([
            'order_line_id' => $line->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);

        $result = $this->analyzer->analyze($line);

        $this->assertTrue($result->isSufficient);
        $this->assertEquals(50.0, $result->saturationPercent);
    }

    // ─── Screen group targeting ─────────────────────────────────────────────

    public function test_resolves_screens_via_screen_group_target(): void
    {
        $tenant = $this->createTenantWithConfig();
        $group = ScreenGroup::factory()->create([
            'tenant_id' => $tenant->id,
            'duration_seconds' => 10,
            'num_slots' => null,
        ]);
        $screen1 = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'group_id' => $group->id,
            'num_slots' => null,
        ]);
        $screen2 = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'group_id' => $group->id,
            'num_slots' => null,
        ]);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $line = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'estandar',
            'delivery_pace' => 'uniform',
            'status' => 'draft',
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(30),
            'target_spots' => 5000,
        ]);

        // Target via screen group
        OrderLineTarget::factory()->create([
            'order_line_id' => $line->id,
            'screen_id' => null,
            'screen_group_id' => $group->id,
        ]);

        $result = $this->analyzer->analyze($line);

        // 2 screens × (576 loops × 7 ad_slots) = 8064
        $this->assertTrue($result->isSufficient);
        $this->assertEquals(5000, $result->targetSpots);
        $this->assertEquals(8064, $result->availableCapacity);
    }

    // ─── Does not count the line itself as consuming capacity ────────────────

    public function test_does_not_count_current_line_as_consuming_capacity(): void
    {
        // If the line is already active, it should not reduce its own capacity
        $tenant = $this->createTenantWithConfig();
        $screen = $this->createScreenForTenant($tenant);
        $order = Order::factory()->create(['tenant_id' => $tenant->id]);

        $line = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'estandar',
            'delivery_pace' => 'uniform',
            'status' => 'active', // already active
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(30),
            'target_spots' => 4032,
        ]);

        OrderLineTarget::factory()->create([
            'order_line_id' => $line->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);

        $result = $this->analyzer->analyze($line);

        // Should not subtract itself, capacity remains 4032
        $this->assertTrue($result->isSufficient);
        $this->assertEquals(4032, $result->targetSpots);
        $this->assertEquals(4032, $result->availableCapacity);
    }

    // ─── Custom num_slots inheritance ───────────────────────────────────────

    public function test_uses_screen_num_slots_override(): void
    {
        // Screen with num_slots=20, tenant ssp=2, playlist=1 → ad_slots=17
        // loops_per_day = 57600 / (20 * 10) = 288
        // capacity = 288 * 17 = 4896
        $tenant = $this->createTenantWithConfig(['num_slots' => 10]);
        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'group_id' => null,
            'num_slots' => 20,
        ]);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $line = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'estandar',
            'delivery_pace' => 'uniform',
            'status' => 'draft',
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(30),
            'target_spots' => 4000,
        ]);

        OrderLineTarget::factory()->create([
            'order_line_id' => $line->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);

        $result = $this->analyzer->analyze($line);

        $this->assertTrue($result->isSufficient);
        $this->assertEquals(4000, $result->targetSpots);
        $this->assertEquals(4896, $result->availableCapacity);
    }

    // ─── isSufficient: true activates directly without alert (6.6) ──────────

    public function test_sufficient_result_has_no_warning_message(): void
    {
        $tenant = $this->createTenantWithConfig();
        $screen = $this->createScreenForTenant($tenant);
        $order = Order::factory()->create(['tenant_id' => $tenant->id]);

        $line = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'estandar',
            'delivery_pace' => 'uniform',
            'status' => 'draft',
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(30),
            'target_spots' => 100,
        ]);

        OrderLineTarget::factory()->create([
            'order_line_id' => $line->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);

        $result = $this->analyzer->analyze($line);

        $this->assertTrue($result->isSufficient);
        $this->assertNull($result->warningMessage);
    }
}
