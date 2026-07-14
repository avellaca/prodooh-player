<?php

namespace Tests\Feature;

use App\Models\Content;
use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ResolutionControllerTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;
    private User $user;
    private Order $order;
    private OrderLine $orderLine;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::factory()->create();
        $this->user = User::factory()->tenantAdmin()->create(['tenant_id' => $this->tenant->id]);
        $this->actingAs($this->user, 'sanctum');

        $this->order = Order::factory()->create(['tenant_id' => $this->tenant->id]);
        $this->orderLine = OrderLine::factory()->create(['order_id' => $this->order->id]);
    }

    public function test_returns_empty_data_when_no_targets(): void
    {
        $response = $this->getJson("/api/admin/order-lines/{$this->orderLine->id}/resolutions");

        $response->assertOk()
            ->assertJson(['data' => []]);
    }

    public function test_returns_404_for_nonexistent_order_line(): void
    {
        $response = $this->getJson('/api/admin/order-lines/00000000-0000-0000-0000-000000000000/resolutions');

        $response->assertNotFound();
    }

    public function test_returns_404_for_invalid_uuid(): void
    {
        $response = $this->getJson('/api/admin/order-lines/not-a-uuid/resolutions');

        $response->assertNotFound();
    }

    public function test_groups_screens_by_resolution_with_direct_targets(): void
    {
        // Create screens with different resolutions
        $screen1 = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
            'name' => 'Screen HD 1',
        ]);
        $screen2 = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
            'name' => 'Screen HD 2',
        ]);
        $screen3 = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'resolution_width' => 1080,
            'resolution_height' => 1920,
            'name' => 'Screen Vertical',
        ]);

        // Create targets linking screens to the order line
        OrderLineTarget::create([
            'order_line_id' => $this->orderLine->id,
            'screen_id' => $screen1->id,
            'screen_group_id' => null,
        ]);
        OrderLineTarget::create([
            'order_line_id' => $this->orderLine->id,
            'screen_id' => $screen2->id,
            'screen_group_id' => null,
        ]);
        OrderLineTarget::create([
            'order_line_id' => $this->orderLine->id,
            'screen_id' => $screen3->id,
            'screen_group_id' => null,
        ]);

        $response = $this->getJson("/api/admin/order-lines/{$this->orderLine->id}/resolutions");

        $response->assertOk();

        $data = $response->json('data');

        // Should have 2 groups
        $this->assertCount(2, $data);

        // First group should be the one with most screens (1920x1080 = 2 screens)
        $this->assertEquals(1920, $data[0]['resolution_width']);
        $this->assertEquals(1080, $data[0]['resolution_height']);
        $this->assertEquals(2, $data[0]['screen_count']);
        $this->assertCount(2, $data[0]['screens']);
        $this->assertFalse($data[0]['has_creative']);
        $this->assertEquals(0, $data[0]['coverage']['with_creative']);
        $this->assertEquals(2, $data[0]['coverage']['total']);

        // Second group (1080x1920 = 1 screen)
        $this->assertEquals(1080, $data[1]['resolution_width']);
        $this->assertEquals(1920, $data[1]['resolution_height']);
        $this->assertEquals(1, $data[1]['screen_count']);
        $this->assertCount(1, $data[1]['screens']);
    }

    public function test_resolves_screens_via_screen_group(): void
    {
        // Create a screen group directly (factory has outdated schema columns)
        $group = ScreenGroup::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Test Group',
            'duration_seconds' => 15,
        ]);
        $screen1 = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'group_id' => $group->id,
            'resolution_width' => 3840,
            'resolution_height' => 2160,
            'name' => 'Screen 4K 1',
        ]);
        $screen2 = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'group_id' => $group->id,
            'resolution_width' => 3840,
            'resolution_height' => 2160,
            'name' => 'Screen 4K 2',
        ]);

        // Create target referencing the group
        OrderLineTarget::create([
            'order_line_id' => $this->orderLine->id,
            'screen_id' => null,
            'screen_group_id' => $group->id,
        ]);

        $response = $this->getJson("/api/admin/order-lines/{$this->orderLine->id}/resolutions");

        $response->assertOk();

        $data = $response->json('data');
        $this->assertCount(1, $data);
        $this->assertEquals(3840, $data[0]['resolution_width']);
        $this->assertEquals(2160, $data[0]['resolution_height']);
        $this->assertEquals(2, $data[0]['screen_count']);
    }

    public function test_screen_entries_include_target_id(): void
    {
        $screen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
            'name' => 'Test Screen',
        ]);

        $target = OrderLineTarget::create([
            'order_line_id' => $this->orderLine->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);

        $response = $this->getJson("/api/admin/order-lines/{$this->orderLine->id}/resolutions");

        $response->assertOk();

        $data = $response->json('data');
        $this->assertEquals($screen->id, $data[0]['screens'][0]['id']);
        $this->assertEquals('Test Screen', $data[0]['screens'][0]['name']);
        $this->assertEquals($target->id, $data[0]['screens'][0]['target_id']);
    }

    public function test_calculates_coverage_correctly(): void
    {
        $screen1 = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);
        $screen2 = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'resolution_width' => 1920,
            'resolution_height' => 1080,
        ]);

        $target1 = OrderLineTarget::create([
            'order_line_id' => $this->orderLine->id,
            'screen_id' => $screen1->id,
            'screen_group_id' => null,
        ]);
        $target2 = OrderLineTarget::create([
            'order_line_id' => $this->orderLine->id,
            'screen_id' => $screen2->id,
            'screen_group_id' => null,
        ]);

        // Add a creative to only the first target
        $content = Content::factory()->create(['tenant_id' => $this->tenant->id]);
        Creative::factory()->create([
            'order_line_target_id' => $target1->id,
            'order_line_id' => $this->orderLine->id,
            'content_id' => $content->id,
        ]);

        $response = $this->getJson("/api/admin/order-lines/{$this->orderLine->id}/resolutions");

        $response->assertOk();

        $data = $response->json('data');
        $this->assertCount(1, $data);
        $this->assertTrue($data[0]['has_creative']);
        $this->assertEquals(1, $data[0]['coverage']['with_creative']);
        $this->assertEquals(2, $data[0]['coverage']['total']);
    }

    public function test_ordered_by_screen_count_descending(): void
    {
        // Create 3 screens with resolution A and 1 screen with resolution B
        for ($i = 0; $i < 3; $i++) {
            $screen = Screen::factory()->create([
                'tenant_id' => $this->tenant->id,
                'resolution_width' => 1920,
                'resolution_height' => 1080,
            ]);
            OrderLineTarget::create([
                'order_line_id' => $this->orderLine->id,
                'screen_id' => $screen->id,
                'screen_group_id' => null,
            ]);
        }

        $screenB = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'resolution_width' => 1080,
            'resolution_height' => 1920,
        ]);
        OrderLineTarget::create([
            'order_line_id' => $this->orderLine->id,
            'screen_id' => $screenB->id,
            'screen_group_id' => null,
        ]);

        $response = $this->getJson("/api/admin/order-lines/{$this->orderLine->id}/resolutions");

        $response->assertOk();

        $data = $response->json('data');
        $this->assertEquals(3, $data[0]['screen_count']);
        $this->assertEquals(1, $data[1]['screen_count']);
    }

    public function test_unauthenticated_user_cannot_access(): void
    {
        // Reset auth
        $this->app['auth']->forgetGuards();

        $response = $this->getJson("/api/admin/order-lines/{$this->orderLine->id}/resolutions");

        $response->assertUnauthorized();
    }
}
