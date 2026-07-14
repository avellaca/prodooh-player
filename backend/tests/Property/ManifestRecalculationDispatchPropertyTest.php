<?php

namespace Tests\Property;

use App\Jobs\RecalculateManifestJob;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use Eris\Generators;
use Eris\TestTrait;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * Property 3: Manifest recalculation dispatch on active_dates change
 *
 * For any OrderLine update where `active_dates` is dirty, the system SHALL dispatch
 * exactly one RecalculateManifestJob per screen targeted by that OrderLine
 * (via direct screen targets and screen group targets).
 *
 * **Validates: Requirements 2.4**
 */
class ManifestRecalculationDispatchPropertyTest extends TestCase
{
    use RefreshDatabase, TestTrait;

    /**
     * Prevent seeding — Eris TestTrait's $seed property (random seed integer)
     * conflicts with Laravel's shouldSeed() which checks property_exists($this, 'seed').
     */
    protected function shouldSeed(): bool
    {
        return false;
    }

    /**
     * Property 3: Updating active_dates dispatches exactly one RecalculateManifestJob per targeted screen.
     *
     * Strategy:
     * - Generate arbitrary number of screens (1-3) targeted by the OrderLine
     * - Generate an initial active_dates array and a new (different) active_dates array
     * - Targets include both direct screen targets and screen group targets
     * - Verify exactly one job dispatched per unique screen
     *
     * **Validates: Requirements 2.4**
     */
    public function test_active_dates_change_dispatches_one_job_per_targeted_screen(): void
    {
        $this->limitTo(5)->forAll(
            Generators::choose(1, 3),   // number of direct screen targets
            Generators::choose(0, 2),   // number of screens in a group target (0 = no group target)
            Generators::choose(1, 5),   // number of initial active_dates
            Generators::choose(1, 5)    // number of new active_dates
        )->then(function (int $directScreenCount, int $groupScreenCount, int $initialDateCount, int $newDateCount): void {
            Queue::fake();

            // Setup entities without events to avoid observer dispatches during creation
            $tenant = Tenant::factory()->create();
            $group = ScreenGroup::factory()->create(['tenant_id' => $tenant->id]);

            // Create direct target screens
            $directScreens = [];
            for ($i = 0; $i < $directScreenCount; $i++) {
                $directScreens[] = Screen::factory()->create([
                    'tenant_id' => $tenant->id,
                    'group_id' => $group->id,
                ]);
            }

            // Create group screens (in a separate group for targeting via screen_group_id)
            $targetGroup = ScreenGroup::factory()->create(['tenant_id' => $tenant->id]);
            $groupScreens = [];
            for ($i = 0; $i < $groupScreenCount; $i++) {
                $groupScreens[] = Screen::factory()->create([
                    'tenant_id' => $tenant->id,
                    'group_id' => $targetGroup->id,
                ]);
            }

            $order = Order::factory()->create([
                'tenant_id' => $tenant->id,
                'status' => 'active',
                'starts_at' => '2025-01-01',
                'ends_at' => '2025-12-31',
            ]);

            // Generate initial active_dates within the order range
            $initialDates = [];
            for ($i = 0; $i < $initialDateCount; $i++) {
                $initialDates[] = '2025-03-' . str_pad($i + 1, 2, '0', STR_PAD_LEFT);
            }

            // Create OrderLine without events to avoid dispatching during creation
            $orderLine = OrderLine::withoutEvents(function () use ($order, $initialDates) {
                return OrderLine::factory()->create([
                    'order_id' => $order->id,
                    'starts_at' => '2025-01-01',
                    'ends_at' => '2025-12-31',
                    'active_dates' => $initialDates,
                    'status' => 'active',
                ]);
            });

            // Create direct screen targets without events
            OrderLineTarget::withoutEvents(function () use ($orderLine, $directScreens) {
                foreach ($directScreens as $screen) {
                    OrderLineTarget::factory()->create([
                        'order_line_id' => $orderLine->id,
                        'screen_id' => $screen->id,
                        'screen_group_id' => null,
                    ]);
                }
            });

            // Create group target without events (if there are group screens)
            if ($groupScreenCount > 0) {
                OrderLineTarget::withoutEvents(function () use ($orderLine, $targetGroup) {
                    OrderLineTarget::factory()->create([
                        'order_line_id' => $orderLine->id,
                        'screen_id' => null,
                        'screen_group_id' => $targetGroup->id,
                    ]);
                });
            }

            // Calculate expected unique screen count
            $allScreenIds = collect($directScreens)->pluck('id')
                ->merge(collect($groupScreens)->pluck('id'))
                ->unique();
            $expectedJobCount = $allScreenIds->count();

            // Generate new active_dates (different from initial to make the field dirty)
            $newDates = [];
            for ($i = 0; $i < $newDateCount; $i++) {
                $newDates[] = '2025-06-' . str_pad($i + 1, 2, '0', STR_PAD_LEFT);
            }

            // Re-fake the queue to clear any jobs that might have leaked through
            Queue::fake();

            // Act: Update active_dates (this makes the field dirty and triggers observer)
            $orderLine->update(['active_dates' => $newDates]);

            // Assert: Exactly one RecalculateManifestJob per unique targeted screen
            Queue::assertPushed(RecalculateManifestJob::class, $expectedJobCount);

            // Verify each screen got exactly one job
            foreach ($allScreenIds as $screenId) {
                Queue::assertPushed(RecalculateManifestJob::class, function ($job) use ($screenId) {
                    return $job->screenId === $screenId && $job->isIntraDay === true;
                });
            }

            // Cleanup
            OrderLineTarget::query()->delete();
            Screen::withoutGlobalScopes()->delete();
            ScreenGroup::query()->delete();
            OrderLine::query()->delete();
            Order::query()->delete();
            Tenant::query()->delete();
        });
    }
}
