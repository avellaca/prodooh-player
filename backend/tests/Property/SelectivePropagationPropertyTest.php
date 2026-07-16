<?php

namespace Tests\Property;

use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Property-based test for selective propagation of num_slots.
 *
 * Uses randomized inputs (100 iterations) to verify Property 4:
 * For any "Aplicar a todos" operation of num_slots on a Tenant, only ScreenGroups
 * and Screens that DO NOT have an explicit override must be updated to the new value;
 * those that have override must maintain their original value.
 *
 * **Validates: Requirements 1.8**
 */
class SelectivePropagationPropertyTest extends TestCase
{
    use RefreshDatabase;

    private User $superAdmin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->superAdmin = User::factory()->superAdmin()->create();
    }

    /**
     * Property 4a: ScreenGroups WITHOUT explicit override receive the tenant's num_slots after propagation.
     *
     * For any tenant num_slots value and any number of ScreenGroups without override (num_slots IS NULL),
     * after propagation all such ScreenGroups must have num_slots equal to the tenant's value.
     *
     * **Validates: Requirements 1.8**
     */
    public function test_screen_groups_without_override_receive_tenant_num_slots(): void
    {
        for ($i = 0; $i < 50; $i++) {
            // Random tenant num_slots in valid range
            $tenantNumSlots = random_int(1, 100);

            $tenant = Tenant::factory()->create([
                'num_slots' => $tenantNumSlots,
                'ssp_slots' => 0,
                'playlist_slots' => 0,
            ]);

            // Random number of groups without override (1 to 5)
            $groupCount = random_int(1, 5);
            $groups = [];
            for ($g = 0; $g < $groupCount; $g++) {
                $groups[] = ScreenGroup::factory()->create([
                    'tenant_id' => $tenant->id,
                    'num_slots' => null,
                ]);
            }

            // Propagate via API
            $this->actingAs($this->superAdmin, 'sanctum')
                ->postJson("/api/admin/tenants/{$tenant->id}/loop-config/propagate")
                ->assertOk();

            // Verify all groups without override now have tenant's num_slots
            foreach ($groups as $group) {
                $group->refresh();
                $this->assertEquals(
                    $tenantNumSlots,
                    $group->num_slots,
                    "Property 4a (iter {$i}): ScreenGroup without override should receive " .
                    "tenant num_slots={$tenantNumSlots}, got {$group->num_slots}"
                );
            }
        }
    }

    /**
     * Property 4b: ScreenGroups WITH explicit override maintain their original value after propagation.
     *
     * For any tenant num_slots value and any ScreenGroup with an explicit override,
     * after propagation the ScreenGroup must keep its original override value unchanged.
     *
     * **Validates: Requirements 1.8**
     */
    public function test_screen_groups_with_override_keep_original_value(): void
    {
        for ($i = 0; $i < 50; $i++) {
            $tenantNumSlots = random_int(1, 100);

            $tenant = Tenant::factory()->create([
                'num_slots' => $tenantNumSlots,
                'ssp_slots' => 0,
                'playlist_slots' => 0,
            ]);

            // Random number of groups with override (1 to 5)
            $groupCount = random_int(1, 5);
            $groups = [];
            for ($g = 0; $g < $groupCount; $g++) {
                $override = random_int(1, 100);
                $groups[] = [
                    'model' => ScreenGroup::factory()->create([
                        'tenant_id' => $tenant->id,
                        'num_slots' => $override,
                    ]),
                    'original_value' => $override,
                ];
            }

            // Propagate via API
            $this->actingAs($this->superAdmin, 'sanctum')
                ->postJson("/api/admin/tenants/{$tenant->id}/loop-config/propagate")
                ->assertOk();

            // Verify all groups with override keep their original value
            foreach ($groups as $entry) {
                $entry['model']->refresh();
                $this->assertEquals(
                    $entry['original_value'],
                    $entry['model']->num_slots,
                    "Property 4b (iter {$i}): ScreenGroup with override={$entry['original_value']} " .
                    "should maintain its value after propagation, got {$entry['model']->num_slots}"
                );
            }
        }
    }

    /**
     * Property 4c: Screens WITHOUT explicit override receive the tenant's num_slots after propagation.
     *
     * For any tenant num_slots value and any number of Screens without override (num_slots IS NULL),
     * after propagation all such Screens must have num_slots equal to the tenant's value.
     *
     * **Validates: Requirements 1.8**
     */
    public function test_screens_without_override_receive_tenant_num_slots(): void
    {
        for ($i = 0; $i < 50; $i++) {
            $tenantNumSlots = random_int(1, 100);

            $tenant = Tenant::factory()->create([
                'num_slots' => $tenantNumSlots,
                'ssp_slots' => 0,
                'playlist_slots' => 0,
            ]);

            // Random number of screens without override (1 to 5)
            $screenCount = random_int(1, 5);
            $screens = [];
            for ($s = 0; $s < $screenCount; $s++) {
                $screens[] = Screen::factory()->create([
                    'tenant_id' => $tenant->id,
                    'num_slots' => null,
                ]);
            }

            // Propagate via API
            $this->actingAs($this->superAdmin, 'sanctum')
                ->postJson("/api/admin/tenants/{$tenant->id}/loop-config/propagate")
                ->assertOk();

            // Verify all screens without override now have tenant's num_slots
            foreach ($screens as $screen) {
                $screen->refresh();
                $this->assertEquals(
                    $tenantNumSlots,
                    $screen->num_slots,
                    "Property 4c (iter {$i}): Screen without override should receive " .
                    "tenant num_slots={$tenantNumSlots}, got {$screen->num_slots}"
                );
            }
        }
    }

    /**
     * Property 4d: Screens WITH explicit override maintain their original value after propagation.
     *
     * For any tenant num_slots value and any Screen with an explicit override,
     * after propagation the Screen must keep its original override value unchanged.
     *
     * **Validates: Requirements 1.8**
     */
    public function test_screens_with_override_keep_original_value(): void
    {
        for ($i = 0; $i < 50; $i++) {
            $tenantNumSlots = random_int(1, 100);

            $tenant = Tenant::factory()->create([
                'num_slots' => $tenantNumSlots,
                'ssp_slots' => 0,
                'playlist_slots' => 0,
            ]);

            // Random number of screens with override (1 to 5)
            $screenCount = random_int(1, 5);
            $screens = [];
            for ($s = 0; $s < $screenCount; $s++) {
                $override = random_int(1, 100);
                $screens[] = [
                    'model' => Screen::factory()->create([
                        'tenant_id' => $tenant->id,
                        'num_slots' => $override,
                    ]),
                    'original_value' => $override,
                ];
            }

            // Propagate via API
            $this->actingAs($this->superAdmin, 'sanctum')
                ->postJson("/api/admin/tenants/{$tenant->id}/loop-config/propagate")
                ->assertOk();

            // Verify all screens with override keep their original value
            foreach ($screens as $entry) {
                $entry['model']->refresh();
                $this->assertEquals(
                    $entry['original_value'],
                    $entry['model']->num_slots,
                    "Property 4d (iter {$i}): Screen with override={$entry['original_value']} " .
                    "should maintain its value after propagation, got {$entry['model']->num_slots}"
                );
            }
        }
    }

    /**
     * Property 4e: Mixed scenario — propagation selectively updates only entities without override.
     *
     * For any tenant with a mix of ScreenGroups and Screens (some with override, some without),
     * after propagation:
     * - Entities WITHOUT override must have num_slots = tenant's num_slots
     * - Entities WITH override must retain their original num_slots value
     *
     * This is the combined property that verifies selectivity universally.
     *
     * **Validates: Requirements 1.8**
     */
    public function test_mixed_propagation_only_affects_entities_without_override(): void
    {
        for ($i = 0; $i < 50; $i++) {
            $tenantNumSlots = random_int(1, 100);

            $tenant = Tenant::factory()->create([
                'num_slots' => $tenantNumSlots,
                'ssp_slots' => 0,
                'playlist_slots' => 0,
            ]);

            // Random mix of groups: some with override, some without
            $totalGroups = random_int(1, 6);
            $groupsWithOverride = [];
            $groupsWithoutOverride = [];

            for ($g = 0; $g < $totalGroups; $g++) {
                $hasOverride = (bool) random_int(0, 1);
                if ($hasOverride) {
                    $override = random_int(1, 100);
                    $groupsWithOverride[] = [
                        'model' => ScreenGroup::factory()->create([
                            'tenant_id' => $tenant->id,
                            'num_slots' => $override,
                        ]),
                        'original_value' => $override,
                    ];
                } else {
                    $groupsWithoutOverride[] = ScreenGroup::factory()->create([
                        'tenant_id' => $tenant->id,
                        'num_slots' => null,
                    ]);
                }
            }

            // Random mix of screens: some with override, some without
            $totalScreens = random_int(1, 6);
            $screensWithOverride = [];
            $screensWithoutOverride = [];

            for ($s = 0; $s < $totalScreens; $s++) {
                $hasOverride = (bool) random_int(0, 1);
                if ($hasOverride) {
                    $override = random_int(1, 100);
                    $screensWithOverride[] = [
                        'model' => Screen::factory()->create([
                            'tenant_id' => $tenant->id,
                            'num_slots' => $override,
                        ]),
                        'original_value' => $override,
                    ];
                } else {
                    $screensWithoutOverride[] = Screen::factory()->create([
                        'tenant_id' => $tenant->id,
                        'num_slots' => null,
                    ]);
                }
            }

            // Propagate via API
            $response = $this->actingAs($this->superAdmin, 'sanctum')
                ->postJson("/api/admin/tenants/{$tenant->id}/loop-config/propagate");

            $response->assertOk();

            // Verify response affected counts match expectation
            $response->assertJson([
                'affected_screen_groups' => count($groupsWithoutOverride),
                'affected_screens' => count($screensWithoutOverride),
                'num_slots' => $tenantNumSlots,
            ]);

            // Verify groups WITHOUT override got tenant's value
            foreach ($groupsWithoutOverride as $group) {
                $group->refresh();
                $this->assertEquals(
                    $tenantNumSlots,
                    $group->num_slots,
                    "Property 4e (iter {$i}): ScreenGroup without override should have " .
                    "num_slots={$tenantNumSlots} after propagation, got {$group->num_slots}"
                );
            }

            // Verify groups WITH override kept their original value
            foreach ($groupsWithOverride as $entry) {
                $entry['model']->refresh();
                $this->assertEquals(
                    $entry['original_value'],
                    $entry['model']->num_slots,
                    "Property 4e (iter {$i}): ScreenGroup with override={$entry['original_value']} " .
                    "should keep its value, got {$entry['model']->num_slots}"
                );
            }

            // Verify screens WITHOUT override got tenant's value
            foreach ($screensWithoutOverride as $screen) {
                $screen->refresh();
                $this->assertEquals(
                    $tenantNumSlots,
                    $screen->num_slots,
                    "Property 4e (iter {$i}): Screen without override should have " .
                    "num_slots={$tenantNumSlots} after propagation, got {$screen->num_slots}"
                );
            }

            // Verify screens WITH override kept their original value
            foreach ($screensWithOverride as $entry) {
                $entry['model']->refresh();
                $this->assertEquals(
                    $entry['original_value'],
                    $entry['model']->num_slots,
                    "Property 4e (iter {$i}): Screen with override={$entry['original_value']} " .
                    "should keep its value, got {$entry['model']->num_slots}"
                );
            }
        }
    }
}
