<?php

namespace Tests\Unit;

use App\Jobs\RegenerateLoopTemplateJob;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use App\Services\LoopTemplateGenerator;
use App\Services\RotationSchedulerInterface;
use App\Services\SlotAllocatorInterface;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Tests\TestCase;

class RegenerateAffectedTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;
    private ScreenGroup $group;
    private LoopTemplateGenerator $generator;

    protected function setUp(): void
    {
        parent::setUp();

        Bus::fake();

        $this->tenant = Tenant::factory()->create();
        $this->group = ScreenGroup::factory()->create(['tenant_id' => $this->tenant->id]);

        $this->generator = new LoopTemplateGenerator(
            app(SlotAllocatorInterface::class),
            app(RotationSchedulerInterface::class),
        );
    }

    public function test_regenerate_affected_dispatches_batch_for_given_screens(): void
    {
        $screen1 = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'group_id' => $this->group->id,
        ]);
        $screen2 = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'group_id' => $this->group->id,
        ]);

        $this->generator->regenerateAffected([$screen1->id, $screen2->id]);

        Bus::assertBatched(function ($batch) {
            return $batch->jobs->count() === 2
                && $batch->name === 'regenerate-loop-templates';
        });
    }

    public function test_regenerate_affected_deduplicates_screen_ids(): void
    {
        $screen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'group_id' => $this->group->id,
        ]);

        $this->generator->regenerateAffected([$screen->id, $screen->id, $screen->id]);

        Bus::assertBatched(function ($batch) {
            return $batch->jobs->count() === 1;
        });
    }

    public function test_regenerate_affected_skips_nonexistent_screens(): void
    {
        $screen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'group_id' => $this->group->id,
        ]);

        $fakeId = '00000000-0000-0000-0000-000000000000';

        $this->generator->regenerateAffected([$screen->id, $fakeId]);

        Bus::assertBatched(function ($batch) {
            return $batch->jobs->count() === 1;
        });
    }

    public function test_regenerate_affected_does_nothing_with_empty_array(): void
    {
        $this->generator->regenerateAffected([]);

        Bus::assertNothingBatched();
    }

    public function test_regenerate_affected_does_nothing_when_all_screens_nonexistent(): void
    {
        $fakeId1 = '00000000-0000-0000-0000-000000000001';
        $fakeId2 = '00000000-0000-0000-0000-000000000002';

        $this->generator->regenerateAffected([$fakeId1, $fakeId2]);

        Bus::assertNothingBatched();
    }
}
