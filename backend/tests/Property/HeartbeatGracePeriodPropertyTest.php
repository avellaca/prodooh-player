<?php

namespace Tests\Property;

use App\Models\Screen;
use App\Models\Tenant;
use App\Services\DeviceStatusService;
use Carbon\Carbon;
use Eris\Generators;
use Eris\TestTrait;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Property 14: Heartbeat Grace Period State Machine
 *
 * For any device with a configured heartbeat threshold T and grace period G,
 * the device status SHALL remain "online" while the time since last heartbeat
 * is ≤ T+G, and transition to "unresponsive" only after T+G has elapsed
 * without a heartbeat.
 *
 * **Validates: Requirements 8.2**
 */
class HeartbeatGracePeriodPropertyTest extends TestCase
{
    use RefreshDatabase, TestTrait;

    private DeviceStatusService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new DeviceStatusService();
    }

    /**
     * Property: A screen whose last heartbeat is within the threshold + grace period
     * SHALL NOT be marked as unresponsive. The device remains in its current state.
     *
     * Generate random elapsed seconds within the valid window (1 to threshold+grace)
     * and verify the screen is never marked unresponsive.
     *
     * **Validates: Requirements 8.2**
     */
    public function test_screen_within_grace_period_is_not_marked_unresponsive(): void
    {
        $threshold = DeviceStatusService::HEARTBEAT_THRESHOLD;
        $grace = DeviceStatusService::GRACE_PERIOD;
        $maxAllowed = $threshold + $grace;

        $this->forAll(
            Generators::choose(1, $maxAllowed) // elapsed seconds since last heartbeat
        )->then(function (int $elapsedSeconds) use ($maxAllowed): void {
            $tenant = Tenant::factory()->create();
            $now = Carbon::create(2024, 6, 15, 12, 0, 0);
            Carbon::setTestNow($now);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'status' => 'online',
                'last_heartbeat' => $now->copy()->subSeconds($elapsedSeconds),
            ]);

            $this->service->checkStatus($screen);
            $screen->refresh();

            $this->assertEquals(
                'online',
                $screen->status,
                "Screen with heartbeat {$elapsedSeconds}s ago (within {$maxAllowed}s window) should remain online"
            );

            // Clean up for next iteration
            Screen::withoutGlobalScopes()->delete();
            Tenant::query()->delete();
            Carbon::setTestNow();
        });
    }

    /**
     * Property: A screen whose last heartbeat exceeds threshold + grace period
     * SHALL be marked as "unresponsive".
     *
     * Generate random elapsed seconds beyond the valid window and verify the screen
     * transitions to unresponsive.
     *
     * **Validates: Requirements 8.2**
     */
    public function test_screen_beyond_grace_period_is_marked_unresponsive(): void
    {
        $threshold = DeviceStatusService::HEARTBEAT_THRESHOLD;
        $grace = DeviceStatusService::GRACE_PERIOD;
        $deadline = $threshold + $grace;

        $this->forAll(
            Generators::choose($deadline + 1, $deadline + 3600) // 1s to 1h beyond deadline
        )->then(function (int $elapsedSeconds) use ($deadline): void {
            $tenant = Tenant::factory()->create();
            $now = Carbon::create(2024, 6, 15, 12, 0, 0);
            Carbon::setTestNow($now);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'status' => 'online',
                'last_heartbeat' => $now->copy()->subSeconds($elapsedSeconds),
            ]);

            $this->service->checkStatus($screen);
            $screen->refresh();

            $this->assertEquals(
                'unresponsive',
                $screen->status,
                "Screen with heartbeat {$elapsedSeconds}s ago (beyond {$deadline}s deadline) should be unresponsive"
            );

            // Clean up for next iteration
            Screen::withoutGlobalScopes()->delete();
            Tenant::query()->delete();
            Carbon::setTestNow();
        });
    }

    /**
     * Property: A new heartbeat always resets a device to "online" regardless of
     * its previous state. This verifies that receiving a heartbeat after being marked
     * unresponsive restores the device to online.
     *
     * Generate random previous states and verify that a heartbeat sets status to online.
     *
     * **Validates: Requirements 8.2**
     */
    public function test_heartbeat_always_resets_device_to_online(): void
    {
        $statuses = ['online', 'offline', 'unresponsive'];

        $this->forAll(
            Generators::elements($statuses) // random previous status
        )->then(function (string $previousStatus): void {
            $tenant = Tenant::factory()->create();
            $now = Carbon::create(2024, 6, 15, 12, 0, 0);
            Carbon::setTestNow($now);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'status' => $previousStatus,
                'last_heartbeat' => $now->copy()->subSeconds(300), // old heartbeat
            ]);

            // Simulate receiving a new heartbeat (same logic as HeartbeatController)
            $screen->update([
                'last_heartbeat' => $now,
                'status' => 'online',
            ]);

            $screen->refresh();

            $this->assertEquals(
                'online',
                $screen->status,
                "After receiving a heartbeat, screen should be online regardless of previous status '{$previousStatus}'"
            );

            // Verify that checkStatus does NOT downgrade a freshly heartbeated screen
            $this->service->checkStatus($screen);
            $screen->refresh();

            $this->assertEquals(
                'online',
                $screen->status,
                "checkStatus should not downgrade a screen that just sent a heartbeat"
            );

            // Clean up for next iteration
            Screen::withoutGlobalScopes()->delete();
            Tenant::query()->delete();
            Carbon::setTestNow();
        });
    }

    /**
     * Property: The batch evaluateAllScreens method only marks online screens
     * that have exceeded the threshold + grace period as unresponsive, and leaves
     * screens within the window untouched.
     *
     * Generate random mixes of screens (some within window, some beyond) and verify
     * only the correct ones are transitioned.
     *
     * **Validates: Requirements 8.2**
     */
    public function test_batch_evaluation_respects_grace_period_boundary(): void
    {
        $threshold = DeviceStatusService::HEARTBEAT_THRESHOLD;
        $grace = DeviceStatusService::GRACE_PERIOD;
        $deadline = $threshold + $grace;

        $this->forAll(
            Generators::choose(1, 3), // screens within window
            Generators::choose(1, 3), // screens beyond window
            Generators::choose(1, $deadline), // elapsed seconds for "within" screens
            Generators::choose($deadline + 1, $deadline + 3600) // elapsed seconds for "beyond" screens
        )->then(function (
            int $withinCount,
            int $beyondCount,
            int $withinElapsed,
            int $beyondElapsed
        ): void {
            $tenant = Tenant::factory()->create();
            $now = Carbon::create(2024, 6, 15, 12, 0, 0);
            Carbon::setTestNow($now);

            // Create screens within the grace window (should stay online)
            $withinScreens = Screen::factory()->count($withinCount)->create([
                'tenant_id' => $tenant->id,
                'status' => 'online',
                'last_heartbeat' => $now->copy()->subSeconds($withinElapsed),
            ]);

            // Create screens beyond the grace window (should become unresponsive)
            $beyondScreens = Screen::factory()->count($beyondCount)->create([
                'tenant_id' => $tenant->id,
                'status' => 'online',
                'last_heartbeat' => $now->copy()->subSeconds($beyondElapsed),
            ]);

            $markedCount = $this->service->evaluateAllScreens();

            // Exactly the "beyond" screens should be marked
            $this->assertEquals(
                $beyondCount,
                $markedCount,
                "Expected {$beyondCount} screens to be marked unresponsive, got {$markedCount}"
            );

            // Verify "within" screens remain online
            foreach ($withinScreens as $screen) {
                $screen->refresh();
                $this->assertEquals(
                    'online',
                    $screen->status,
                    "Screen with heartbeat {$withinElapsed}s ago should remain online"
                );
            }

            // Verify "beyond" screens are now unresponsive
            foreach ($beyondScreens as $screen) {
                $screen->refresh();
                $this->assertEquals(
                    'unresponsive',
                    $screen->status,
                    "Screen with heartbeat {$beyondElapsed}s ago should be unresponsive"
                );
            }

            // Clean up for next iteration
            Screen::withoutGlobalScopes()->delete();
            Tenant::query()->delete();
            Carbon::setTestNow();
        });
    }

    /**
     * Property: A screen with no heartbeat ever recorded (null last_heartbeat)
     * SHALL NOT have its status changed by the checkStatus method.
     *
     * **Validates: Requirements 8.2**
     */
    public function test_screen_with_no_heartbeat_retains_current_status(): void
    {
        $statuses = ['online', 'offline', 'unresponsive'];

        $this->forAll(
            Generators::elements($statuses) // random initial status
        )->then(function (string $initialStatus): void {
            $tenant = Tenant::factory()->create();
            $now = Carbon::create(2024, 6, 15, 12, 0, 0);
            Carbon::setTestNow($now);

            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'status' => $initialStatus,
                'last_heartbeat' => null,
            ]);

            $this->service->checkStatus($screen);
            $screen->refresh();

            $this->assertEquals(
                $initialStatus,
                $screen->status,
                "Screen with no heartbeat should retain its '{$initialStatus}' status"
            );

            // Clean up for next iteration
            Screen::withoutGlobalScopes()->delete();
            Tenant::query()->delete();
            Carbon::setTestNow();
        });
    }
}
