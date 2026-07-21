<?php

namespace Tests\Property;

use App\Models\Content;
use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\Tenant;
use App\Models\User;
use Eris\Generators;
use Eris\TestTrait;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Property Test for Creative Delete Isolation.
 *
 * Property 6: Eliminación de creativo es aislada por pantalla
 *
 * For any OrderLine with creatives assigned in multiple screens, deleting a Creative
 * from one screen SHALL leave all Creatives on other screens unaltered (same count,
 * same IDs, same fields).
 *
 * **Validates: Requirements 11.2**
 */
class CreativeDeleteIsolationPropertyTest extends TestCase
{
    use RefreshDatabase, TestTrait;

    /**
     * Prevent seeding — Eris TestTrait's $seed property conflicts with Laravel's shouldSeed().
     */
    protected function shouldSeed(): bool
    {
        return false;
    }

    /**
     * Property 6: Eliminación de creativo es aislada por pantalla
     *
     * For any OrderLine with N screens (2..5) each having M creatives (1..4),
     * deleting a creative from a randomly chosen screen SHALL leave all creatives
     * on other screens completely unaltered (same count, same IDs, same fields).
     *
     * **Validates: Requirements 11.2**
     */
    public function test_deleting_creative_from_one_screen_does_not_affect_other_screens(): void
    {
        $this->limitTo(15)->forAll(
            Generators::choose(2, 5),  // number of screens
            Generators::choose(1, 4),  // number of creatives per screen
            Generators::choose(0, 99)  // seed for choosing which screen and creative to delete
        )->then(function (int $numScreens, int $creativesPerScreen, int $deleteSeed): void {
            // Setup: tenant, admin, order, order line
            $tenant = Tenant::factory()->create();
            $admin = User::factory()->tenantAdmin()->create(['tenant_id' => $tenant->id]);
            $this->actingAs($admin, 'sanctum');

            $order = Order::factory()->create(['tenant_id' => $tenant->id]);
            $orderLine = OrderLine::factory()->create([
                'order_id' => $order->id,
            ]);

            // Create N screens, each with its own OrderLineTarget and M creatives
            $screens = [];
            $targets = [];
            $creativesByTarget = [];

            for ($s = 0; $s < $numScreens; $s++) {
                $screen = Screen::factory()->create([
                    'tenant_id' => $tenant->id,
                    'resolution_width' => 1920,
                    'resolution_height' => 1080,
                ]);
                $screens[] = $screen;

                $target = OrderLineTarget::factory()->create([
                    'order_line_id' => $orderLine->id,
                    'screen_id' => $screen->id,
                    'screen_group_id' => null,
                ]);
                $targets[] = $target;

                $creativesByTarget[$target->id] = [];

                for ($c = 0; $c < $creativesPerScreen; $c++) {
                    $content = Content::factory()->create([
                        'tenant_id' => $tenant->id,
                        'width' => 1920,
                        'height' => 1080,
                    ]);

                    $creative = Creative::create([
                        'order_line_target_id' => $target->id,
                        'content_id' => $content->id,
                        'weight' => ($c + 1) * 50,
                        'resolution_width' => 1920,
                        'resolution_height' => 1080,
                        'position' => $c,
                    ]);

                    $creativesByTarget[$target->id][] = $creative;
                }
            }

            // Choose which screen to delete from using the seed
            $deleteScreenIndex = $deleteSeed % $numScreens;
            $deleteTarget = $targets[$deleteScreenIndex];
            $deleteCreatives = $creativesByTarget[$deleteTarget->id];

            // Choose which creative from that screen to delete
            $deleteCreativeIndex = $deleteSeed % count($deleteCreatives);
            $creativeToDelete = $deleteCreatives[$deleteCreativeIndex];

            // Capture the state of OTHER screens before deletion
            $otherScreensState = [];
            foreach ($targets as $index => $target) {
                if ($index === $deleteScreenIndex) {
                    continue;
                }
                $otherScreensState[$target->id] = [];
                foreach ($creativesByTarget[$target->id] as $creative) {
                    $otherScreensState[$target->id][] = [
                        'id' => $creative->id,
                        'content_id' => $creative->content_id,
                        'weight' => $creative->weight,
                        'resolution_width' => $creative->resolution_width,
                        'resolution_height' => $creative->resolution_height,
                        'position' => $creative->position,
                        'order_line_target_id' => $creative->order_line_target_id,
                    ];
                }
            }

            // Act: delete a creative from the chosen screen via API
            $response = $this->deleteJson("/api/admin/creatives/{$creativeToDelete->id}");

            $response->assertStatus(200);

            // PROPERTY ASSERTION 1: The deleted creative no longer exists
            $this->assertDatabaseMissing('creatives', ['id' => $creativeToDelete->id]);

            // PROPERTY ASSERTION 2: All creatives on OTHER screens are UNALTERED
            foreach ($otherScreensState as $targetId => $expectedCreatives) {
                $actualCreatives = Creative::where('order_line_target_id', $targetId)
                    ->orderBy('position')
                    ->get();

                // Same count
                $this->assertCount(
                    count($expectedCreatives),
                    $actualCreatives,
                    "Property 6: Screen target {$targetId} should still have " .
                    count($expectedCreatives) . " creatives after deleting from another screen, " .
                    "but has {$actualCreatives->count()}."
                );

                // Same IDs
                $expectedIds = array_column($expectedCreatives, 'id');
                $actualIds = $actualCreatives->pluck('id')->toArray();
                sort($expectedIds);
                sort($actualIds);
                $this->assertEquals(
                    $expectedIds,
                    $actualIds,
                    "Property 6: Creative IDs on other screen should be unchanged after deletion."
                );

                // Same fields for each creative
                foreach ($expectedCreatives as $expected) {
                    $actual = Creative::find($expected['id']);
                    $this->assertNotNull(
                        $actual,
                        "Property 6: Creative {$expected['id']} should still exist on other screen."
                    );
                    $this->assertEquals(
                        $expected['content_id'],
                        $actual->content_id,
                        "Property 6: content_id should be unchanged for creative {$expected['id']}."
                    );
                    $this->assertEquals(
                        $expected['weight'],
                        $actual->weight,
                        "Property 6: weight should be unchanged for creative {$expected['id']}."
                    );
                    $this->assertEquals(
                        $expected['resolution_width'],
                        $actual->resolution_width,
                        "Property 6: resolution_width should be unchanged for creative {$expected['id']}."
                    );
                    $this->assertEquals(
                        $expected['resolution_height'],
                        $actual->resolution_height,
                        "Property 6: resolution_height should be unchanged for creative {$expected['id']}."
                    );
                    $this->assertEquals(
                        $expected['position'],
                        $actual->position,
                        "Property 6: position should be unchanged for creative {$expected['id']}."
                    );
                    $this->assertEquals(
                        $expected['order_line_target_id'],
                        $actual->order_line_target_id,
                        "Property 6: order_line_target_id should be unchanged for creative {$expected['id']}."
                    );
                }
            }

            // PROPERTY ASSERTION 3: The deletion target screen lost exactly 1 creative
            $remainingOnDeletedScreen = Creative::where('order_line_target_id', $deleteTarget->id)->count();
            $this->assertEquals(
                $creativesPerScreen - 1,
                $remainingOnDeletedScreen,
                "Property 6: The screen from which we deleted should have exactly " .
                ($creativesPerScreen - 1) . " creatives remaining, but has {$remainingOnDeletedScreen}."
            );

            // Cleanup for next iteration
            Creative::withoutGlobalScopes()->delete();
            OrderLineTarget::query()->delete();
            Screen::withoutGlobalScopes()->delete();
            Content::withoutGlobalScopes()->delete();
            OrderLine::withoutEvents(function () {
                OrderLine::query()->forceDelete();
            });
            \App\Models\AuditLog::query()->delete();
            Order::withoutGlobalScopes()->delete();
            User::query()->delete();
            Tenant::query()->delete();
        });
    }
}
