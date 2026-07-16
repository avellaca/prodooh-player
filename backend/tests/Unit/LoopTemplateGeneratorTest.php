<?php

namespace Tests\Unit;

use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use App\Services\LoopTemplateGenerator;
use App\Services\RotationSchedulerInterface;
use App\Services\SlotAllocatorInterface;
use Tests\TestCase;

class LoopTemplateGeneratorTest extends TestCase
{
    private LoopTemplateGenerator $generator;

    protected function setUp(): void
    {
        parent::setUp();
        $slotAllocator = $this->createMock(SlotAllocatorInterface::class);
        $rotationScheduler = $this->createMock(RotationSchedulerInterface::class);
        $this->generator = new LoopTemplateGenerator($slotAllocator, $rotationScheduler);
    }

    // ─── resolveNumSlots: Screen override ────────────────────────────────────

    public function test_resolve_num_slots_returns_screen_value_when_set(): void
    {
        $tenant = new Tenant(['num_slots' => 20]);
        $tenant->id = 'tenant-1';

        $group = new ScreenGroup(['num_slots' => 15, 'tenant_id' => 'tenant-1']);
        $group->id = 'group-1';
        $group->setRelation('tenant', $tenant);

        $screen = new Screen(['num_slots' => 8, 'tenant_id' => 'tenant-1', 'group_id' => 'group-1']);
        $screen->id = 'screen-1';
        $screen->setRelation('screenGroup', $group);
        $screen->setRelation('tenant', $tenant);

        $this->assertEquals(8, $this->generator->resolveNumSlots($screen));
    }

    // ─── resolveNumSlots: ScreenGroup fallback ───────────────────────────────

    public function test_resolve_num_slots_falls_back_to_screen_group(): void
    {
        $tenant = new Tenant(['num_slots' => 20]);
        $tenant->id = 'tenant-1';

        $group = new ScreenGroup(['num_slots' => 15, 'tenant_id' => 'tenant-1']);
        $group->id = 'group-1';
        $group->setRelation('tenant', $tenant);

        $screen = new Screen(['num_slots' => null, 'tenant_id' => 'tenant-1', 'group_id' => 'group-1']);
        $screen->id = 'screen-1';
        $screen->setRelation('screenGroup', $group);
        $screen->setRelation('tenant', $tenant);

        $this->assertEquals(15, $this->generator->resolveNumSlots($screen));
    }

    // ─── resolveNumSlots: Tenant fallback ────────────────────────────────────

    public function test_resolve_num_slots_falls_back_to_tenant(): void
    {
        $tenant = new Tenant(['num_slots' => 20]);
        $tenant->id = 'tenant-1';

        $group = new ScreenGroup(['num_slots' => null, 'tenant_id' => 'tenant-1']);
        $group->id = 'group-1';
        $group->setRelation('tenant', $tenant);

        $screen = new Screen(['num_slots' => null, 'tenant_id' => 'tenant-1', 'group_id' => 'group-1']);
        $screen->id = 'screen-1';
        $screen->setRelation('screenGroup', $group);
        $screen->setRelation('tenant', $tenant);

        $this->assertEquals(20, $this->generator->resolveNumSlots($screen));
    }

    // ─── resolveNumSlots: Global default (10) ────────────────────────────────

    public function test_resolve_num_slots_returns_default_10_when_all_null(): void
    {
        $tenant = new Tenant(['num_slots' => null]);
        $tenant->id = 'tenant-1';

        $group = new ScreenGroup(['num_slots' => null, 'tenant_id' => 'tenant-1']);
        $group->id = 'group-1';
        $group->setRelation('tenant', $tenant);

        $screen = new Screen(['num_slots' => null, 'tenant_id' => 'tenant-1', 'group_id' => 'group-1']);
        $screen->id = 'screen-1';
        $screen->setRelation('screenGroup', $group);
        $screen->setRelation('tenant', $tenant);

        $this->assertEquals(10, $this->generator->resolveNumSlots($screen));
    }

    // ─── resolveNumSlots: Screen without group ───────────────────────────────

    public function test_resolve_num_slots_skips_null_group_and_falls_back_to_tenant(): void
    {
        $tenant = new Tenant(['num_slots' => 25]);
        $tenant->id = 'tenant-1';

        $screen = new Screen(['num_slots' => null, 'tenant_id' => 'tenant-1', 'group_id' => null]);
        $screen->id = 'screen-1';
        $screen->setRelation('screenGroup', null);
        $screen->setRelation('tenant', $tenant);

        $this->assertEquals(25, $this->generator->resolveNumSlots($screen));
    }

    // ─── resolveNumSlots: Screen without group falls back to default ─────────

    public function test_resolve_num_slots_without_group_and_null_tenant_returns_default(): void
    {
        $tenant = new Tenant(['num_slots' => null]);
        $tenant->id = 'tenant-1';

        $screen = new Screen(['num_slots' => null, 'tenant_id' => 'tenant-1', 'group_id' => null]);
        $screen->id = 'screen-1';
        $screen->setRelation('screenGroup', null);
        $screen->setRelation('tenant', $tenant);

        $this->assertEquals(10, $this->generator->resolveNumSlots($screen));
    }
}
