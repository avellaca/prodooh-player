<?php

namespace Tests\Property;

use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use App\Services\LoopTemplateGenerator;
use App\Services\RotationSchedulerInterface;
use App\Services\SlotAllocatorInterface;
use Eris\Generators;
use Eris\TestTrait;
use PHPUnit\Framework\TestCase;

class LoopTemplateGeneratorPropertyTest extends TestCase
{
    use TestTrait;

    private LoopTemplateGenerator $generator;

    protected function setUp(): void
    {
        parent::setUp();
        $slotAllocator = $this->createMock(SlotAllocatorInterface::class);
        $rotationScheduler = $this->createMock(RotationSchedulerInterface::class);
        $this->generator = new LoopTemplateGenerator($slotAllocator, $rotationScheduler);
    }

    /**
     * Property 3: Herencia de num_slots por jerarquía
     *
     * For any pantalla en el sistema, el num_slots efectivo debe resolverse siguiendo la cadena:
     * valor explícito de Screen (si no es null) → valor explícito de ScreenGroup padre (si no es null)
     * → valor del Tenant → 10 (default global).
     *
     * **Validates: Requirements 1.6**
     */
    public function test_num_slots_inheritance_hierarchy(): void
    {
        $this->forAll(
            Generators::oneOf(
                Generators::constant(null),
                Generators::choose(1, 100)
            ),
            Generators::oneOf(
                Generators::constant(null),
                Generators::choose(1, 100)
            ),
            Generators::oneOf(
                Generators::constant(null),
                Generators::choose(1, 100)
            )
        )->then(function ($screenNumSlots, $groupNumSlots, $tenantNumSlots): void {
            // Build in-memory hierarchy
            $tenant = new Tenant(['num_slots' => $tenantNumSlots]);
            $tenant->id = 'tenant-1';

            $group = new ScreenGroup(['num_slots' => $groupNumSlots, 'tenant_id' => 'tenant-1']);
            $group->id = 'group-1';
            $group->setRelation('tenant', $tenant);

            $screen = new Screen(['num_slots' => $screenNumSlots, 'tenant_id' => 'tenant-1', 'group_id' => 'group-1']);
            $screen->id = 'screen-1';
            $screen->setRelation('screenGroup', $group);
            $screen->setRelation('tenant', $tenant);

            $result = $this->generator->resolveNumSlots($screen);

            // Verify hierarchy resolution
            if ($screenNumSlots !== null) {
                // Rule 1: Screen.num_slots is not null → result = Screen.num_slots
                $this->assertSame(
                    (int) $screenNumSlots,
                    $result,
                    "When Screen.num_slots={$screenNumSlots}, result should be {$screenNumSlots} but got {$result}"
                );
            } elseif ($groupNumSlots !== null) {
                // Rule 2: Screen.num_slots is null, ScreenGroup.num_slots is not null → result = ScreenGroup.num_slots
                $this->assertSame(
                    (int) $groupNumSlots,
                    $result,
                    "When Screen.num_slots=null, ScreenGroup.num_slots={$groupNumSlots}, result should be {$groupNumSlots} but got {$result}"
                );
            } elseif ($tenantNumSlots !== null) {
                // Rule 3: Both null, Tenant.num_slots is not null → result = Tenant.num_slots
                $this->assertSame(
                    (int) $tenantNumSlots,
                    $result,
                    "When Screen and Group null, Tenant.num_slots={$tenantNumSlots}, result should be {$tenantNumSlots} but got {$result}"
                );
            } else {
                // Rule 4: All null → result = 10 (global default)
                $this->assertSame(
                    10,
                    $result,
                    "When all num_slots are null, result should be 10 but got {$result}"
                );
            }
        });
    }

    /**
     * Property 3 (variant): Herencia sin ScreenGroup (Screen directamente bajo Tenant)
     *
     * For any pantalla sin ScreenGroup asignado, el num_slots efectivo debe resolverse:
     * Screen.num_slots → Tenant.num_slots → 10 (default global).
     *
     * **Validates: Requirements 1.6**
     */
    public function test_num_slots_inheritance_without_screen_group(): void
    {
        $this->forAll(
            Generators::oneOf(
                Generators::constant(null),
                Generators::choose(1, 100)
            ),
            Generators::oneOf(
                Generators::constant(null),
                Generators::choose(1, 100)
            )
        )->then(function ($screenNumSlots, $tenantNumSlots): void {
            // Build in-memory hierarchy WITHOUT a ScreenGroup
            $tenant = new Tenant(['num_slots' => $tenantNumSlots]);
            $tenant->id = 'tenant-1';

            $screen = new Screen(['num_slots' => $screenNumSlots, 'tenant_id' => 'tenant-1', 'group_id' => null]);
            $screen->id = 'screen-1';
            $screen->setRelation('screenGroup', null);
            $screen->setRelation('tenant', $tenant);

            $result = $this->generator->resolveNumSlots($screen);

            // Verify hierarchy resolution (skipping ScreenGroup)
            if ($screenNumSlots !== null) {
                $this->assertSame(
                    (int) $screenNumSlots,
                    $result,
                    "Without group: Screen.num_slots={$screenNumSlots}, result should be {$screenNumSlots} but got {$result}"
                );
            } elseif ($tenantNumSlots !== null) {
                $this->assertSame(
                    (int) $tenantNumSlots,
                    $result,
                    "Without group: Screen null, Tenant.num_slots={$tenantNumSlots}, result should be {$tenantNumSlots} but got {$result}"
                );
            } else {
                $this->assertSame(
                    10,
                    $result,
                    "Without group: all null, result should be 10 but got {$result}"
                );
            }
        });
    }
}
