<?php

namespace Tests\Property;

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

/**
 * Property-based test for order activation rejection without creative.
 *
 * Uses randomized inputs (100 iterations) to verify Property 14:
 * For any order that does not have at least 1 OrderLine with at least 1 Creative assigned,
 * the activation attempt must be rejected with a descriptive error.
 *
 * **Validates: Requirements 5.6**
 */
class OrderActivationRejectionPropertyTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;
    private User $user;

    /** All valid priority tiers */
    private const PRIORITY_TIERS = ['patrocinio', 'estandar', 'red_interna'];

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::factory()->create();
        $this->user = User::factory()->tenantAdmin()->create(['tenant_id' => $this->tenant->id]);
        $this->actingAs($this->user, 'sanctum');
    }

    // ─── Property 14: Rejection of activation without creative ──────────────────

    /**
     * Property 14a: For any order with a random number of OrderLines (0..N),
     * where NONE of the order lines have a Creative assigned,
     * the activation attempt MUST be rejected with HTTP 422.
     *
     * **Validates: Requirements 5.6**
     */
    public function test_activation_rejected_for_any_order_without_creatives(): void
    {
        for ($i = 0; $i < 100; $i++) {
            // Random number of order lines: 0 to 5
            $numOrderLines = random_int(0, 5);

            $order = Order::factory()->create([
                'tenant_id' => $this->tenant->id,
                'status' => 'draft',
            ]);

            // Create N order lines with random tiers, but NO creatives
            for ($j = 0; $j < $numOrderLines; $j++) {
                $tier = self::PRIORITY_TIERS[array_rand(self::PRIORITY_TIERS)];

                $orderLine = OrderLine::factory()->create([
                    'order_id' => $order->id,
                    'priority_tier' => $tier,
                    'delivery_pace' => 'uniform',
                ]);

                // Optionally add targets (but never creatives)
                if (random_int(0, 1) === 1) {
                    $screenGroup = ScreenGroup::factory()->create(['tenant_id' => $this->tenant->id]);
                    $screen = Screen::factory()->create(['group_id' => $screenGroup->id]);

                    OrderLineTarget::factory()->create([
                        'order_line_id' => $orderLine->id,
                        'screen_id' => $screen->id,
                        'screen_group_id' => null,
                    ]);
                }
            }

            $response = $this->putJson("/api/admin/orders/{$order->id}", [
                'status' => 'active',
            ]);

            $response->assertStatus(422,
                "Property 14a (iter {$i}): Order with {$numOrderLines} order lines (no creatives) " .
                "must be rejected with 422, got {$response->getStatusCode()}"
            );

            $json = $response->json();
            $this->assertArrayHasKey('errors', $json,
                "Property 14a (iter {$i}): Response must contain 'errors' key"
            );
            $this->assertArrayHasKey('status', $json['errors'],
                "Property 14a (iter {$i}): Errors must contain 'status' field"
            );
        }
    }

    /**
     * Property 14b: For any order that HAS at least 1 OrderLine with at least 1 Creative,
     * the activation attempt MUST succeed (HTTP 200).
     *
     * **Validates: Requirements 5.6**
     */
    public function test_activation_allowed_for_any_order_with_at_least_one_creative(): void
    {
        for ($i = 0; $i < 50; $i++) {
            // Random number of order lines: 1 to 5
            $numOrderLines = random_int(1, 5);
            // At least one of them will have a creative
            $lineWithCreativeIndex = random_int(0, $numOrderLines - 1);

            $order = Order::factory()->create([
                'tenant_id' => $this->tenant->id,
                'status' => 'draft',
            ]);

            $screenGroup = ScreenGroup::factory()->create(['tenant_id' => $this->tenant->id]);
            $screen = Screen::factory()->create(['group_id' => $screenGroup->id]);
            $content = Content::factory()->create(['tenant_id' => $this->tenant->id]);

            for ($j = 0; $j < $numOrderLines; $j++) {
                $tier = self::PRIORITY_TIERS[array_rand(self::PRIORITY_TIERS)];

                $orderLine = OrderLine::factory()->create([
                    'order_id' => $order->id,
                    'priority_tier' => $tier,
                    'delivery_pace' => 'uniform',
                ]);

                if ($j === $lineWithCreativeIndex) {
                    // This line WILL have a creative
                    $target = OrderLineTarget::factory()->create([
                        'order_line_id' => $orderLine->id,
                        'screen_id' => $screen->id,
                        'screen_group_id' => null,
                    ]);

                    // Random number of creatives: 1 to 3
                    $numCreatives = random_int(1, 3);
                    for ($k = 0; $k < $numCreatives; $k++) {
                        Creative::factory()->create([
                            'order_line_target_id' => $target->id,
                            'order_line_id' => $orderLine->id,
                            'content_id' => $content->id,
                        ]);
                    }
                }
            }

            $response = $this->putJson("/api/admin/orders/{$order->id}", [
                'status' => 'active',
            ]);

            $response->assertOk(
                "Property 14b (iter {$i}): Order with {$numOrderLines} lines (creative at index {$lineWithCreativeIndex}) " .
                "must be accepted (200), got {$response->getStatusCode()}"
            );

            $this->assertEquals('active', $response->json('data.status'),
                "Property 14b (iter {$i}): Order status must be 'active' after successful activation"
            );
        }
    }

    /**
     * Property 14c: The error message MUST be descriptive — it should reference
     * the missing creative as the reason for rejection.
     *
     * This property tests that for any rejected activation, the error message
     * contains meaningful information about what's missing.
     *
     * **Validates: Requirements 5.6**
     */
    public function test_rejection_error_message_is_always_descriptive(): void
    {
        for ($i = 0; $i < 50; $i++) {
            $numOrderLines = random_int(0, 3);

            $order = Order::factory()->create([
                'tenant_id' => $this->tenant->id,
                'status' => 'draft',
            ]);

            // Create order lines without creatives
            for ($j = 0; $j < $numOrderLines; $j++) {
                $tier = self::PRIORITY_TIERS[array_rand(self::PRIORITY_TIERS)];
                OrderLine::factory()->create([
                    'order_id' => $order->id,
                    'priority_tier' => $tier,
                    'delivery_pace' => 'uniform',
                ]);
            }

            $response = $this->putJson("/api/admin/orders/{$order->id}", [
                'status' => 'active',
            ]);

            $response->assertStatus(422);

            $errorMessage = $response->json('errors.status.0');
            $this->assertNotNull($errorMessage,
                "Property 14c (iter {$i}): Error message must not be null"
            );
            $this->assertNotEmpty($errorMessage,
                "Property 14c (iter {$i}): Error message must not be empty"
            );
            // The message should be descriptive (more than just a generic validation error)
            $this->assertGreaterThan(20, strlen($errorMessage),
                "Property 14c (iter {$i}): Error message must be descriptive (>20 chars), got: '{$errorMessage}'"
            );
        }
    }

    /**
     * Property 14d: Non-activation status changes must NOT be blocked regardless
     * of creative assignment. For any order (with or without creatives),
     * changing to a non-active status should always succeed.
     *
     * **Validates: Requirements 5.6**
     */
    public function test_non_activation_status_changes_never_blocked(): void
    {
        $nonActiveStatuses = ['paused', 'finished'];

        for ($i = 0; $i < 50; $i++) {
            $numOrderLines = random_int(0, 3);
            $targetStatus = $nonActiveStatuses[array_rand($nonActiveStatuses)];

            $order = Order::factory()->create([
                'tenant_id' => $this->tenant->id,
                'status' => 'draft',
            ]);

            // Create order lines without creatives
            for ($j = 0; $j < $numOrderLines; $j++) {
                $tier = self::PRIORITY_TIERS[array_rand(self::PRIORITY_TIERS)];
                OrderLine::factory()->create([
                    'order_id' => $order->id,
                    'priority_tier' => $tier,
                    'delivery_pace' => 'uniform',
                ]);
            }

            $response = $this->putJson("/api/admin/orders/{$order->id}", [
                'status' => $targetStatus,
            ]);

            $response->assertOk(
                "Property 14d (iter {$i}): Changing to '{$targetStatus}' with {$numOrderLines} lines " .
                "(no creatives) must succeed, got {$response->getStatusCode()}"
            );

            $this->assertEquals($targetStatus, $response->json('data.status'),
                "Property 14d (iter {$i}): Status must be '{$targetStatus}' after update"
            );
        }
    }
}
