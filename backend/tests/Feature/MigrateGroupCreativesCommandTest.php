<?php

namespace Tests\Feature;

use App\Models\Content;
use App\Models\Creative;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\TestCase;

class MigrateGroupCreativesCommandTest extends TestCase
{
    use DatabaseTransactions;

    public function test_migrates_group_creative_to_individual_screen_creatives(): void
    {
        $tenant = Tenant::factory()->create();
        $group = ScreenGroup::factory()->create(['tenant_id' => $tenant->id]);
        $screen1 = Screen::factory()->create(['tenant_id' => $tenant->id, 'group_id' => $group->id]);
        $screen2 = Screen::factory()->create(['tenant_id' => $tenant->id, 'group_id' => $group->id]);

        $orderLine = OrderLine::factory()->create();
        $groupTarget = OrderLineTarget::factory()->forScreenGroup($group->id)->create([
            'order_line_id' => $orderLine->id,
        ]);

        $content = Content::factory()->create(['tenant_id' => $tenant->id, 'width' => 1920, 'height' => 1080]);
        $creative = Creative::factory()->create([
            'order_line_target_id' => $groupTarget->id,
            'content_id' => $content->id,
            'weight' => 50,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);

        $this->artisan('creatives:migrate-groups')
            ->assertSuccessful();

        // Original group creative should be deleted
        $this->assertDatabaseMissing('creatives', ['id' => $creative->id]);

        // Should have created 2 individual creatives (one per screen)
        $newCreatives = Creative::where('content_id', $content->id)->get();
        $this->assertCount(2, $newCreatives);

        foreach ($newCreatives as $newCreative) {
            $this->assertEquals($content->id, $newCreative->content_id);
            $this->assertEquals(50, $newCreative->weight);
            $this->assertEquals(1920, $newCreative->resolution_width);
            $this->assertEquals(1080, $newCreative->resolution_height);

            // Each new creative should be linked to a screen-level target
            $target = OrderLineTarget::find($newCreative->order_line_target_id);
            $this->assertNotNull($target->screen_id);
            $this->assertNull($target->screen_group_id);
        }

        // The new targets should reference the individual screens
        $screenIds = $newCreatives->map(fn ($c) => OrderLineTarget::find($c->order_line_target_id)->screen_id)->sort()->values();
        $expectedScreenIds = collect([$screen1->id, $screen2->id])->sort()->values();
        $this->assertEquals($expectedScreenIds, $screenIds);
    }

    public function test_fixes_null_resolution_from_content(): void
    {
        $tenant = Tenant::factory()->create();
        $group = ScreenGroup::factory()->create(['tenant_id' => $tenant->id]);
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id, 'group_id' => $group->id]);

        $orderLine = OrderLine::factory()->create();
        $groupTarget = OrderLineTarget::factory()->forScreenGroup($group->id)->create([
            'order_line_id' => $orderLine->id,
        ]);

        $content = Content::factory()->create(['tenant_id' => $tenant->id, 'width' => 3840, 'height' => 2160]);
        $creative = Creative::factory()->create([
            'order_line_target_id' => $groupTarget->id,
            'content_id' => $content->id,
            'weight' => 100,
            'resolution_width' => null,
            'resolution_height' => null,
        ]);

        $this->artisan('creatives:migrate-groups')
            ->assertSuccessful();

        // New creative should have resolution copied from content
        $newCreative = Creative::where('content_id', $content->id)->first();
        $this->assertNotNull($newCreative);
        $this->assertEquals(3840, $newCreative->resolution_width);
        $this->assertEquals(2160, $newCreative->resolution_height);
    }

    public function test_dry_run_does_not_modify_data(): void
    {
        $tenant = Tenant::factory()->create();
        $group = ScreenGroup::factory()->create(['tenant_id' => $tenant->id]);
        Screen::factory()->create(['tenant_id' => $tenant->id, 'group_id' => $group->id]);

        $orderLine = OrderLine::factory()->create();
        $groupTarget = OrderLineTarget::factory()->forScreenGroup($group->id)->create([
            'order_line_id' => $orderLine->id,
        ]);

        $content = Content::factory()->create(['tenant_id' => $tenant->id]);
        $creative = Creative::factory()->create([
            'order_line_target_id' => $groupTarget->id,
            'content_id' => $content->id,
            'weight' => 75,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);

        $this->artisan('creatives:migrate-groups', ['--dry-run' => true])
            ->assertSuccessful();

        // Original creative should still exist
        $this->assertDatabaseHas('creatives', ['id' => $creative->id]);

        // No new creatives should have been created
        $this->assertCount(1, Creative::all());
    }

    public function test_no_group_creatives_reports_nothing_to_migrate(): void
    {
        // Only screen-level creatives exist
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
        $orderLine = OrderLine::factory()->create();
        $screenTarget = OrderLineTarget::factory()->create([
            'order_line_id' => $orderLine->id,
            'screen_id' => $screen->id,
        ]);

        Creative::factory()->create([
            'order_line_target_id' => $screenTarget->id,
            'content_id' => Content::factory()->create(['tenant_id' => $tenant->id])->id,
        ]);

        $this->artisan('creatives:migrate-groups')
            ->expectsOutput('No group-level creatives found. Nothing to migrate.')
            ->assertSuccessful();
    }

    public function test_continues_on_individual_failure(): void
    {
        $tenant = Tenant::factory()->create();

        // First group creative (will succeed)
        $group1 = ScreenGroup::factory()->create(['tenant_id' => $tenant->id]);
        $screen1 = Screen::factory()->create(['tenant_id' => $tenant->id, 'group_id' => $group1->id]);
        $orderLine = OrderLine::factory()->create();
        $groupTarget1 = OrderLineTarget::factory()->forScreenGroup($group1->id)->create([
            'order_line_id' => $orderLine->id,
        ]);
        $content1 = Content::factory()->create(['tenant_id' => $tenant->id]);
        Creative::factory()->create([
            'order_line_target_id' => $groupTarget1->id,
            'content_id' => $content1->id,
            'weight' => 100,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);

        // Second group creative (group with screens will also succeed)
        $group2 = ScreenGroup::factory()->create(['tenant_id' => $tenant->id]);
        $screen2 = Screen::factory()->create(['tenant_id' => $tenant->id, 'group_id' => $group2->id]);
        $groupTarget2 = OrderLineTarget::factory()->forScreenGroup($group2->id)->create([
            'order_line_id' => $orderLine->id,
        ]);
        $content2 = Content::factory()->create(['tenant_id' => $tenant->id]);
        Creative::factory()->create([
            'order_line_target_id' => $groupTarget2->id,
            'content_id' => $content2->id,
            'weight' => 80,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);

        $this->artisan('creatives:migrate-groups')
            ->assertSuccessful();

        // Both group creatives should be migrated successfully
        $this->assertCount(2, Creative::all());
    }
}
