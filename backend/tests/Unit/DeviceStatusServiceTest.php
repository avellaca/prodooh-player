<?php

namespace Tests\Unit;

use App\Models\Screen;
use App\Models\Tenant;
use App\Services\DeviceStatusService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DeviceStatusServiceTest extends TestCase
{
    use RefreshDatabase;

    private DeviceStatusService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new DeviceStatusService();
    }

    public function test_screen_with_recent_heartbeat_remains_online(): void
    {
        $screen = Screen::factory()->create([
            'status' => 'online',
            'last_heartbeat' => Carbon::now()->subSeconds(30), // 30s ago, well within threshold
        ]);

        $result = $this->service->checkStatus($screen);

        $this->assertEquals('online', $result->status);
    }

    public function test_screen_past_threshold_but_within_grace_remains_online(): void
    {
        // Past the 60s threshold but within the additional 60s grace period
        // Total allowed = 120s, we set heartbeat at 90s ago
        $screen = Screen::factory()->create([
            'status' => 'online',
            'last_heartbeat' => Carbon::now()->subSeconds(90),
        ]);

        $result = $this->service->checkStatus($screen);

        $this->assertEquals('online', $result->status);
    }

    public function test_screen_past_threshold_plus_grace_is_marked_unresponsive(): void
    {
        // Past threshold (60s) + grace period (60s) = 120s
        $screen = Screen::factory()->create([
            'status' => 'online',
            'last_heartbeat' => Carbon::now()->subSeconds(150), // 150s ago
        ]);

        $result = $this->service->checkStatus($screen);

        $this->assertEquals('unresponsive', $result->status);
        $this->assertDatabaseHas('screens', [
            'id' => $screen->id,
            'status' => 'unresponsive',
        ]);
    }

    public function test_screen_with_null_last_heartbeat_remains_current_status(): void
    {
        $screen = Screen::factory()->create([
            'status' => 'offline',
            'last_heartbeat' => null,
        ]);

        $result = $this->service->checkStatus($screen);

        $this->assertEquals('offline', $result->status);
    }

    public function test_evaluate_all_screens_marks_stale_online_screens_as_unresponsive(): void
    {
        $tenant = Tenant::factory()->create();

        // This screen is stale and should be marked unresponsive
        $staleScreen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'status' => 'online',
            'last_heartbeat' => Carbon::now()->subSeconds(200),
        ]);

        // This screen is recent and should stay online
        $recentScreen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'status' => 'online',
            'last_heartbeat' => Carbon::now()->subSeconds(30),
        ]);

        // This screen is offline — should not be touched
        $offlineScreen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'status' => 'offline',
            'last_heartbeat' => Carbon::now()->subSeconds(300),
        ]);

        $count = $this->service->evaluateAllScreens();

        $this->assertEquals(1, $count);

        $this->assertDatabaseHas('screens', [
            'id' => $staleScreen->id,
            'status' => 'unresponsive',
        ]);
        $this->assertDatabaseHas('screens', [
            'id' => $recentScreen->id,
            'status' => 'online',
        ]);
        $this->assertDatabaseHas('screens', [
            'id' => $offlineScreen->id,
            'status' => 'offline',
        ]);
    }

    public function test_screen_exactly_at_threshold_plus_grace_boundary_remains_online(): void
    {
        // Exactly at the boundary (120s). Since we check `<` not `<=`, exactly at boundary stays online.
        Carbon::setTestNow(Carbon::create(2024, 6, 15, 12, 0, 0));

        $screen = Screen::factory()->create([
            'status' => 'online',
            'last_heartbeat' => Carbon::now()->subSeconds(
                DeviceStatusService::HEARTBEAT_THRESHOLD + DeviceStatusService::GRACE_PERIOD
            ),
        ]);

        $result = $this->service->checkStatus($screen);

        // At the exact boundary, `lt()` returns false so status stays online
        $this->assertEquals('online', $result->status);

        Carbon::setTestNow(); // reset
    }

    public function test_screen_one_second_past_boundary_is_marked_unresponsive(): void
    {
        Carbon::setTestNow(Carbon::create(2024, 6, 15, 12, 0, 0));

        $screen = Screen::factory()->create([
            'status' => 'online',
            'last_heartbeat' => Carbon::now()->subSeconds(
                DeviceStatusService::HEARTBEAT_THRESHOLD + DeviceStatusService::GRACE_PERIOD + 1
            ),
        ]);

        $result = $this->service->checkStatus($screen);

        $this->assertEquals('unresponsive', $result->status);

        Carbon::setTestNow(); // reset
    }
}
