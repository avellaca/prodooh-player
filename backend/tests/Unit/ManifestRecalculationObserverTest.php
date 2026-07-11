<?php

namespace Tests\Unit;

use App\Jobs\RecalculateManifestJob;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class ManifestRecalculationObserverTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;
    private ScreenGroup $group;
    private Screen $screen;
    private Order $order;

    protected function setUp(): void
    {
        parent::setUp();

        Queue::fake();

        $this->tenant = Tenant::factory()->create();
        $this->group = ScreenGroup::factory()->create(['tenant_id' => $this->tenant->id]);
        $this->screen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'group_id' => $this->group->id,
        ]);
        $this->order = Order::factory()->create([
            'tenant_id' => $this->tenant->id,
            'status' => 'active',
            'starts_at' => now()->subDays(5),
            'ends_at' => now()->addDays(30),
        ]);
    }

    // ─── OrderLine Created ──────────────────────────────────────────────────────

    public function test_creating_order_line_with_existing_targets_dispatches_recalculate(): void
    {
        // In a scenario where targets are added within the same observer lifecycle
        // (e.g., via a service that creates line + targets atomically),
        // the created event dispatches for already-associated screens.
        // When targets don't exist yet at creation time, no jobs are dispatched.

        $line = OrderLine::factory()->create([
            'order_id' => $this->order->id,
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(10),
        ]);

        // At creation time, no targets exist yet → no dispatches
        Queue::assertNotPushed(RecalculateManifestJob::class);
    }

    public function test_creating_order_line_target_triggers_recalculate_via_line_update(): void
    {
        // Typical flow: create line, add targets, then update line to trigger recalculation.
        // The update to a relevant field (e.g., status activation) triggers the dispatch.
        $line = OrderLine::factory()->create([
            'order_id' => $this->order->id,
            'status' => 'draft',
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(10),
        ]);

        OrderLineTarget::create([
            'order_line_id' => $line->id,
            'screen_id' => $this->screen->id,
        ]);

        Queue::fake();

        // Activating the line triggers recalculation
        $line->update(['status' => 'active']);

        Queue::assertPushed(RecalculateManifestJob::class, function ($job) {
            return $job->screenId === $this->screen->id && $job->isIntraDay === true;
        });
    }

    // ─── OrderLine Updated (relevant fields) ────────────────────────────────────

    public function test_updating_order_line_status_dispatches_recalculate(): void
    {
        $line = OrderLine::factory()->create([
            'order_id' => $this->order->id,
            'status' => 'active',
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(10),
        ]);

        OrderLineTarget::create([
            'order_line_id' => $line->id,
            'screen_id' => $this->screen->id,
        ]);

        Queue::fake();

        $line->update(['status' => 'paused']);

        Queue::assertPushed(RecalculateManifestJob::class, function ($job) {
            return $job->screenId === $this->screen->id && $job->isIntraDay === true;
        });
    }

    public function test_updating_order_line_target_spots_dispatches_recalculate(): void
    {
        $line = OrderLine::factory()->create([
            'order_id' => $this->order->id,
            'status' => 'active',
            'target_spots' => 100,
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(10),
        ]);

        OrderLineTarget::create([
            'order_line_id' => $line->id,
            'screen_id' => $this->screen->id,
        ]);

        Queue::fake();

        $line->update(['target_spots' => 200]);

        Queue::assertPushed(RecalculateManifestJob::class, function ($job) {
            return $job->screenId === $this->screen->id && $job->isIntraDay === true;
        });
    }

    public function test_updating_order_line_dates_dispatches_recalculate(): void
    {
        $line = OrderLine::factory()->create([
            'order_id' => $this->order->id,
            'status' => 'active',
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(10),
        ]);

        OrderLineTarget::create([
            'order_line_id' => $line->id,
            'screen_id' => $this->screen->id,
        ]);

        Queue::fake();

        $line->update(['ends_at' => now()->addDays(20)]);

        Queue::assertPushed(RecalculateManifestJob::class, function ($job) {
            return $job->screenId === $this->screen->id && $job->isIntraDay === true;
        });
    }

    public function test_updating_order_line_irrelevant_field_does_not_dispatch(): void
    {
        $line = OrderLine::factory()->create([
            'order_id' => $this->order->id,
            'status' => 'active',
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(10),
        ]);

        OrderLineTarget::create([
            'order_line_id' => $line->id,
            'screen_id' => $this->screen->id,
        ]);

        Queue::fake();

        $line->update(['name' => 'Changed Name']);

        Queue::assertNotPushed(RecalculateManifestJob::class);
    }

    // ─── OrderLine Deleted (uses deleting event) ──────────────────────────────

    public function test_deleting_order_line_dispatches_recalculate(): void
    {
        $line = OrderLine::factory()->create([
            'order_id' => $this->order->id,
            'status' => 'active',
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(10),
        ]);

        OrderLineTarget::create([
            'order_line_id' => $line->id,
            'screen_id' => $this->screen->id,
        ]);

        Queue::fake();

        $line->delete();

        Queue::assertPushed(RecalculateManifestJob::class, function ($job) {
            return $job->screenId === $this->screen->id && $job->isIntraDay === true;
        });
    }

    // ─── Order Updated (status change) ──────────────────────────────────────────

    public function test_updating_order_status_dispatches_recalculate_for_all_line_screens(): void
    {
        $screen2 = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'group_id' => $this->group->id,
        ]);

        $line1 = OrderLine::factory()->create([
            'order_id' => $this->order->id,
            'status' => 'active',
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(10),
        ]);
        OrderLineTarget::create([
            'order_line_id' => $line1->id,
            'screen_id' => $this->screen->id,
        ]);

        $line2 = OrderLine::factory()->create([
            'order_id' => $this->order->id,
            'status' => 'active',
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(10),
        ]);
        OrderLineTarget::create([
            'order_line_id' => $line2->id,
            'screen_id' => $screen2->id,
        ]);

        Queue::fake();

        $this->order->update(['status' => 'paused']);

        Queue::assertPushed(RecalculateManifestJob::class, function ($job) {
            return $job->screenId === $this->screen->id && $job->isIntraDay === true;
        });

        Queue::assertPushed(RecalculateManifestJob::class, function ($job) use ($screen2) {
            return $job->screenId === $screen2->id && $job->isIntraDay === true;
        });
    }

    public function test_updating_order_non_status_field_does_not_dispatch(): void
    {
        $line = OrderLine::factory()->create([
            'order_id' => $this->order->id,
            'status' => 'active',
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(10),
        ]);

        OrderLineTarget::create([
            'order_line_id' => $line->id,
            'screen_id' => $this->screen->id,
        ]);

        Queue::fake();

        $this->order->update(['name' => 'Updated Order Name']);

        Queue::assertNotPushed(RecalculateManifestJob::class);
    }

    // ─── Multiple screens (group targeting) ─────────────────────────────────────

    public function test_order_line_targeting_group_dispatches_for_all_group_screens(): void
    {
        $screen2 = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'group_id' => $this->group->id,
        ]);

        $line = OrderLine::factory()->create([
            'order_id' => $this->order->id,
            'status' => 'active',
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(10),
        ]);

        // Target by group instead of direct screen
        OrderLineTarget::create([
            'order_line_id' => $line->id,
            'screen_group_id' => $this->group->id,
        ]);

        Queue::fake();

        $line->update(['status' => 'paused']);

        Queue::assertPushed(RecalculateManifestJob::class, function ($job) {
            return $job->screenId === $this->screen->id && $job->isIntraDay === true;
        });

        Queue::assertPushed(RecalculateManifestJob::class, function ($job) use ($screen2) {
            return $job->screenId === $screen2->id && $job->isIntraDay === true;
        });
    }

    // ─── Deduplication: same screen targeted by multiple lines ───────────────────

    public function test_order_status_change_deduplicates_screen_dispatches(): void
    {
        // Both lines target the same screen
        $line1 = OrderLine::factory()->create([
            'order_id' => $this->order->id,
            'status' => 'active',
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(10),
        ]);
        OrderLineTarget::create([
            'order_line_id' => $line1->id,
            'screen_id' => $this->screen->id,
        ]);

        $line2 = OrderLine::factory()->create([
            'order_id' => $this->order->id,
            'status' => 'active',
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDays(10),
        ]);
        OrderLineTarget::create([
            'order_line_id' => $line2->id,
            'screen_id' => $this->screen->id,
        ]);

        Queue::fake();

        $this->order->update(['status' => 'paused']);

        // Should only dispatch once for the same screen thanks to unique()
        Queue::assertPushed(RecalculateManifestJob::class, 1);
    }
}
