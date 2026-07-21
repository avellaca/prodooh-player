<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\Tenant;
use App\Models\User;
use App\Services\PlaybackModeResolver;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\TestCase;

class PlaybackModeTest extends TestCase
{
    use DatabaseTransactions;

    private function actingAsTenantAdmin(?Tenant $tenant = null): User
    {
        $tenant ??= Tenant::factory()->create();
        $user = User::factory()->tenantAdmin()->create(['tenant_id' => $tenant->id]);
        $this->actingAs($user, 'sanctum');

        return $user;
    }

    // --- OrderLineController@update: playback_mode validation ---

    public function test_update_order_line_accepts_round_robin(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);

        $response = $this->putJson("/api/admin/order-lines/{$orderLine->id}", [
            'playback_mode' => 'round_robin',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.playback_mode', 'round_robin');

        $this->assertDatabaseHas('order_lines', [
            'id' => $orderLine->id,
            'playback_mode' => 'round_robin',
        ]);
    }

    public function test_update_order_line_accepts_sequential(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);

        $response = $this->putJson("/api/admin/order-lines/{$orderLine->id}", [
            'playback_mode' => 'sequential',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.playback_mode', 'sequential');

        $this->assertDatabaseHas('order_lines', [
            'id' => $orderLine->id,
            'playback_mode' => 'sequential',
        ]);
    }

    public function test_update_order_line_rejects_invalid_playback_mode(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);

        $response = $this->putJson("/api/admin/order-lines/{$orderLine->id}", [
            'playback_mode' => 'random',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['playback_mode']);
    }

    public function test_order_line_show_includes_playback_mode(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $orderLine = OrderLine::factory()->create([
            'order_id' => $order->id,
            'playback_mode' => 'sequential',
        ]);

        $response = $this->getJson("/api/admin/order-lines/{$orderLine->id}");

        $response->assertOk()
            ->assertJsonPath('data.playback_mode', 'sequential');
    }

    public function test_order_line_index_includes_playback_mode(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        OrderLine::factory()->create([
            'order_id' => $order->id,
            'playback_mode' => 'sequential',
        ]);

        $response = $this->getJson("/api/admin/orders/{$order->id}/order-lines");

        $response->assertOk()
            ->assertJsonPath('data.0.playback_mode', 'sequential');
    }

    // --- OrderLineTargetController@update: playback_mode_override ---

    public function test_update_target_accepts_playback_mode_override_sequential(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);

        $target = OrderLineTarget::create([
            'order_line_id' => $orderLine->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);

        $response = $this->putJson("/api/admin/order-line-targets/{$target->id}", [
            'playback_mode_override' => 'sequential',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.playback_mode_override', 'sequential');

        $this->assertDatabaseHas('order_line_targets', [
            'id' => $target->id,
            'playback_mode_override' => 'sequential',
        ]);
    }

    public function test_update_target_accepts_null_playback_mode_override(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);

        $target = OrderLineTarget::create([
            'order_line_id' => $orderLine->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
            'playback_mode_override' => 'sequential',
        ]);

        $response = $this->putJson("/api/admin/order-line-targets/{$target->id}", [
            'playback_mode_override' => null,
        ]);

        $response->assertOk()
            ->assertJsonPath('data.playback_mode_override', null);

        $this->assertDatabaseHas('order_line_targets', [
            'id' => $target->id,
            'playback_mode_override' => null,
        ]);
    }

    public function test_update_target_rejects_invalid_playback_mode_override(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);

        $target = OrderLineTarget::create([
            'order_line_id' => $orderLine->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);

        $response = $this->putJson("/api/admin/order-line-targets/{$target->id}", [
            'playback_mode_override' => 'invalid_mode',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['playback_mode_override']);
    }

    public function test_update_target_returns_404_for_nonexistent(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $response = $this->putJson('/api/admin/order-line-targets/nonexistent-uuid', [
            'playback_mode_override' => 'sequential',
        ]);

        $response->assertNotFound();
    }

    public function test_target_response_includes_playback_mode_override(): void
    {
        $tenant = Tenant::factory()->create();
        $this->actingAsTenantAdmin($tenant);

        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $orderLine = OrderLine::factory()->create(['order_id' => $order->id]);
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);

        $target = OrderLineTarget::create([
            'order_line_id' => $orderLine->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
            'playback_mode_override' => 'round_robin',
        ]);

        $response = $this->putJson("/api/admin/order-line-targets/{$target->id}", [
            'playback_mode_override' => 'round_robin',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.playback_mode_override', 'round_robin');
    }

    // --- PlaybackModeResolver ---

    public function test_resolver_returns_override_when_set(): void
    {
        $tenant = Tenant::factory()->create();
        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $orderLine = OrderLine::factory()->create([
            'order_id' => $order->id,
            'playback_mode' => 'round_robin',
        ]);
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);

        $target = OrderLineTarget::create([
            'order_line_id' => $orderLine->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
            'playback_mode_override' => 'sequential',
        ]);

        $this->assertEquals('sequential', PlaybackModeResolver::resolve($target));
    }

    public function test_resolver_falls_back_to_order_line_when_no_override(): void
    {
        $tenant = Tenant::factory()->create();
        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $orderLine = OrderLine::factory()->create([
            'order_id' => $order->id,
            'playback_mode' => 'sequential',
        ]);
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);

        $target = OrderLineTarget::create([
            'order_line_id' => $orderLine->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
            'playback_mode_override' => null,
        ]);

        $this->assertEquals('sequential', PlaybackModeResolver::resolve($target));
    }

    public function test_resolver_defaults_to_round_robin_when_no_override_and_default_mode(): void
    {
        $tenant = Tenant::factory()->create();
        $order = Order::factory()->create(['tenant_id' => $tenant->id]);
        $orderLine = OrderLine::factory()->create([
            'order_id' => $order->id,
            'playback_mode' => 'round_robin',
        ]);
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);

        $target = OrderLineTarget::create([
            'order_line_id' => $orderLine->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
            'playback_mode_override' => null,
        ]);

        $this->assertEquals('round_robin', PlaybackModeResolver::resolve($target));
    }
}
