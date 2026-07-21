<?php

namespace Tests\Feature;

use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\Tenant;
use App\Models\TrackingPixel;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\TestCase;

class TrackingPixelControllerTest extends TestCase
{
    use DatabaseTransactions;

    private User $tenantAdmin;
    private Tenant $tenant;
    private string $token;
    private Order $order;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::factory()->create();
        $this->tenantAdmin = User::factory()->tenantAdmin()->create([
            'tenant_id' => $this->tenant->id,
        ]);
        $this->token = $this->tenantAdmin->createToken('test-token')->plainTextToken;

        $this->order = Order::factory()->create(['tenant_id' => $this->tenant->id]);
    }

    private function authHeaders(): array
    {
        return ['Authorization' => 'Bearer ' . $this->token];
    }

    // --- INDEX ---

    public function test_can_list_tracking_pixels_for_order(): void
    {
        TrackingPixel::factory()->count(2)->create([
            'trackable_type' => Order::class,
            'trackable_id' => $this->order->id,
        ]);

        $response = $this->withHeaders($this->authHeaders())
            ->getJson("/api/admin/orders/{$this->order->id}/tracking-pixels");

        $response->assertOk()
            ->assertJsonCount(2, 'data');
    }

    public function test_can_list_tracking_pixels_for_order_line(): void
    {
        $orderLine = OrderLine::factory()->create([
            'order_id' => $this->order->id,
        ]);

        TrackingPixel::factory()->create([
            'trackable_type' => OrderLine::class,
            'trackable_id' => $orderLine->id,
        ]);

        $response = $this->withHeaders($this->authHeaders())
            ->getJson("/api/admin/order-lines/{$orderLine->id}/tracking-pixels");

        $response->assertOk()
            ->assertJsonCount(1, 'data');
    }

    public function test_can_list_tracking_pixels_for_creative(): void
    {
        $orderLine = OrderLine::factory()->create([
            'order_id' => $this->order->id,
        ]);

        $screen = Screen::factory()->create(['tenant_id' => $this->tenant->id]);

        $target = OrderLineTarget::factory()->create([
            'order_line_id' => $orderLine->id,
            'screen_id' => $screen->id,
        ]);

        $creative = Creative::factory()->create([
            'order_line_target_id' => $target->id,
        ]);

        TrackingPixel::factory()->create([
            'trackable_type' => Creative::class,
            'trackable_id' => $creative->id,
        ]);

        $response = $this->withHeaders($this->authHeaders())
            ->getJson("/api/admin/creatives/{$creative->id}/tracking-pixels");

        $response->assertOk()
            ->assertJsonCount(1, 'data');
    }

    public function test_list_returns_empty_when_no_pixels(): void
    {
        $response = $this->withHeaders($this->authHeaders())
            ->getJson("/api/admin/orders/{$this->order->id}/tracking-pixels");

        $response->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_list_with_invalid_trackable_type_returns_422(): void
    {
        $response = $this->withHeaders($this->authHeaders())
            ->getJson("/api/admin/invalid-type/{$this->order->id}/tracking-pixels");

        $response->assertNotFound();
    }

    public function test_list_with_nonexistent_entity_returns_404(): void
    {
        $fakeUuid = '00000000-0000-0000-0000-000000000000';

        $response = $this->withHeaders($this->authHeaders())
            ->getJson("/api/admin/orders/{$fakeUuid}/tracking-pixels");

        $response->assertNotFound();
    }

    // --- STORE ---

    public function test_can_create_tracking_pixel_for_order(): void
    {
        $response = $this->withHeaders($this->authHeaders())
            ->postJson("/api/admin/orders/{$this->order->id}/tracking-pixels", [
                'url' => 'https://pixel.example.com/track',
                'trigger_type' => 'impression',
                'multiplier' => 2,
            ]);

        $response->assertCreated()
            ->assertJsonPath('data.url', 'https://pixel.example.com/track')
            ->assertJsonPath('data.trigger_type', 'impression')
            ->assertJsonPath('data.multiplier', 2);

        $this->assertDatabaseHas('tracking_pixels', [
            'trackable_type' => Order::class,
            'trackable_id' => $this->order->id,
            'url' => 'https://pixel.example.com/track',
            'trigger_type' => 'impression',
            'multiplier' => 2,
        ]);
    }

    public function test_create_pixel_defaults_multiplier_to_1(): void
    {
        $response = $this->withHeaders($this->authHeaders())
            ->postJson("/api/admin/orders/{$this->order->id}/tracking-pixels", [
                'url' => 'https://pixel.example.com/track',
                'trigger_type' => 'play',
            ]);

        $response->assertCreated()
            ->assertJsonPath('data.multiplier', 1);
    }

    public function test_create_pixel_requires_url(): void
    {
        $response = $this->withHeaders($this->authHeaders())
            ->postJson("/api/admin/orders/{$this->order->id}/tracking-pixels", [
                'trigger_type' => 'play',
            ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['url']);
    }

    public function test_create_pixel_requires_valid_url(): void
    {
        $response = $this->withHeaders($this->authHeaders())
            ->postJson("/api/admin/orders/{$this->order->id}/tracking-pixels", [
                'url' => 'not-a-url',
                'trigger_type' => 'play',
            ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['url']);
    }

    public function test_create_pixel_url_max_2048(): void
    {
        $response = $this->withHeaders($this->authHeaders())
            ->postJson("/api/admin/orders/{$this->order->id}/tracking-pixels", [
                'url' => 'https://example.com/' . str_repeat('a', 2040),
                'trigger_type' => 'play',
            ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['url']);
    }

    public function test_create_pixel_requires_trigger_type(): void
    {
        $response = $this->withHeaders($this->authHeaders())
            ->postJson("/api/admin/orders/{$this->order->id}/tracking-pixels", [
                'url' => 'https://pixel.example.com/track',
            ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['trigger_type']);
    }

    public function test_create_pixel_trigger_type_must_be_valid(): void
    {
        $response = $this->withHeaders($this->authHeaders())
            ->postJson("/api/admin/orders/{$this->order->id}/tracking-pixels", [
                'url' => 'https://pixel.example.com/track',
                'trigger_type' => 'invalid',
            ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['trigger_type']);
    }

    public function test_create_pixel_multiplier_must_be_at_least_1(): void
    {
        $response = $this->withHeaders($this->authHeaders())
            ->postJson("/api/admin/orders/{$this->order->id}/tracking-pixels", [
                'url' => 'https://pixel.example.com/track',
                'trigger_type' => 'play',
                'multiplier' => 0,
            ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['multiplier']);
    }

    public function test_create_pixel_multiplier_must_be_integer(): void
    {
        $response = $this->withHeaders($this->authHeaders())
            ->postJson("/api/admin/orders/{$this->order->id}/tracking-pixels", [
                'url' => 'https://pixel.example.com/track',
                'trigger_type' => 'play',
                'multiplier' => 1.5,
            ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['multiplier']);
    }

    public function test_create_pixel_for_nonexistent_entity_returns_404(): void
    {
        $fakeUuid = '00000000-0000-0000-0000-000000000000';

        $response = $this->withHeaders($this->authHeaders())
            ->postJson("/api/admin/orders/{$fakeUuid}/tracking-pixels", [
                'url' => 'https://pixel.example.com/track',
                'trigger_type' => 'play',
            ]);

        $response->assertNotFound();
    }

    // --- UPDATE ---

    public function test_can_update_tracking_pixel(): void
    {
        $pixel = TrackingPixel::factory()->create([
            'trackable_type' => Order::class,
            'trackable_id' => $this->order->id,
            'url' => 'https://old.example.com/pixel',
            'trigger_type' => 'play',
            'multiplier' => 1,
        ]);

        $response = $this->withHeaders($this->authHeaders())
            ->putJson("/api/admin/tracking-pixels/{$pixel->id}", [
                'url' => 'https://new.example.com/pixel',
                'trigger_type' => 'impression',
                'multiplier' => 3,
            ]);

        $response->assertOk()
            ->assertJsonPath('data.url', 'https://new.example.com/pixel')
            ->assertJsonPath('data.trigger_type', 'impression')
            ->assertJsonPath('data.multiplier', 3);
    }

    public function test_can_partially_update_tracking_pixel(): void
    {
        $pixel = TrackingPixel::factory()->create([
            'trackable_type' => Order::class,
            'trackable_id' => $this->order->id,
            'url' => 'https://old.example.com/pixel',
            'trigger_type' => 'play',
            'multiplier' => 1,
        ]);

        $response = $this->withHeaders($this->authHeaders())
            ->putJson("/api/admin/tracking-pixels/{$pixel->id}", [
                'multiplier' => 5,
            ]);

        $response->assertOk()
            ->assertJsonPath('data.url', 'https://old.example.com/pixel')
            ->assertJsonPath('data.trigger_type', 'play')
            ->assertJsonPath('data.multiplier', 5);
    }

    public function test_update_nonexistent_pixel_returns_404(): void
    {
        $fakeUuid = '00000000-0000-0000-0000-000000000000';

        $response = $this->withHeaders($this->authHeaders())
            ->putJson("/api/admin/tracking-pixels/{$fakeUuid}", [
                'url' => 'https://new.example.com/pixel',
            ]);

        $response->assertNotFound();
    }

    public function test_update_with_invalid_id_returns_404(): void
    {
        $response = $this->withHeaders($this->authHeaders())
            ->putJson('/api/admin/tracking-pixels/not-a-uuid', [
                'url' => 'https://new.example.com/pixel',
            ]);

        $response->assertNotFound();
    }

    // --- DESTROY ---

    public function test_can_delete_tracking_pixel(): void
    {
        $pixel = TrackingPixel::factory()->create([
            'trackable_type' => Order::class,
            'trackable_id' => $this->order->id,
        ]);

        $response = $this->withHeaders($this->authHeaders())
            ->deleteJson("/api/admin/tracking-pixels/{$pixel->id}");

        $response->assertNoContent();
        $this->assertDatabaseMissing('tracking_pixels', ['id' => $pixel->id]);
    }

    public function test_delete_nonexistent_pixel_returns_404(): void
    {
        $fakeUuid = '00000000-0000-0000-0000-000000000000';

        $response = $this->withHeaders($this->authHeaders())
            ->deleteJson("/api/admin/tracking-pixels/{$fakeUuid}");

        $response->assertNotFound();
    }

    public function test_delete_with_invalid_id_returns_404(): void
    {
        $response = $this->withHeaders($this->authHeaders())
            ->deleteJson('/api/admin/tracking-pixels/not-a-uuid');

        $response->assertNotFound();
    }

    // --- AUTH ---

    public function test_unauthenticated_user_cannot_access_tracking_pixels(): void
    {
        $response = $this->getJson("/api/admin/orders/{$this->order->id}/tracking-pixels");

        $response->assertUnauthorized();
    }
}
