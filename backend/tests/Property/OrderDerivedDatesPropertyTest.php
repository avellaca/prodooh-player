<?php

namespace Tests\Property;

use App\Models\Order;
use App\Models\OrderLine;
use App\Models\Tenant;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Property-based test for derived order dates.
 *
 * Uses randomized inputs (100 iterations) to verify Property 13:
 * For any order with at least one OrderLine, starts_at must equal MIN(starts_at)
 * of all its OrderLines, and ends_at must equal MAX(ends_at). For orders without
 * lines, both dates must be null.
 *
 * **Validates: Requirements 5.2**
 */
class OrderDerivedDatesPropertyTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Property 13a: For any order without OrderLines, starts_at and ends_at must be null.
     *
     * **Validates: Requirements 5.2**
     */
    public function test_order_without_lines_has_null_dates(): void
    {
        for ($i = 0; $i < 50; $i++) {
            $tenant = Tenant::factory()->create();

            $order = Order::create([
                'tenant_id' => $tenant->id,
                'name' => "Empty Order iter {$i}",
                'advertiser_name' => fake()->company(),
                'status' => 'draft',
            ]);

            $this->assertNull(
                $order->starts_at,
                "Property 13a (iter {$i}): Order without OrderLines must have starts_at = null, " .
                "got '{$order->starts_at}'"
            );

            $this->assertNull(
                $order->ends_at,
                "Property 13a (iter {$i}): Order without OrderLines must have ends_at = null, " .
                "got '{$order->ends_at}'"
            );
        }
    }

    /**
     * Property 13b: For any order with exactly one OrderLine, starts_at and ends_at
     * must equal the OrderLine's starts_at and ends_at respectively.
     *
     * **Validates: Requirements 5.2**
     */
    public function test_order_with_single_line_matches_line_dates(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $tenant = Tenant::factory()->create();

            $order = Order::create([
                'tenant_id' => $tenant->id,
                'name' => "Single Line Order iter {$i}",
                'status' => 'draft',
            ]);

            // Generate random dates within a reasonable range
            $startOffset = random_int(0, 365);
            $duration = random_int(1, 180);
            $lineStartsAt = Carbon::parse('2025-01-01')->addDays($startOffset);
            $lineEndsAt = $lineStartsAt->copy()->addDays($duration);

            OrderLine::withoutEvents(function () use ($order, $lineStartsAt, $lineEndsAt, $i) {
                return OrderLine::create([
                    'order_id' => $order->id,
                    'name' => "Line iter {$i}",
                    'priority_tier' => 'estandar',
                    'starts_at' => $lineStartsAt->toDateString(),
                    'ends_at' => $lineEndsAt->toDateString(),
                    'delivery_pace' => 'uniform',
                    'share_weight' => 1,
                    'status' => 'draft',
                ]);
            });

            $order->refresh();

            $this->assertEquals(
                $lineStartsAt->toDateString(),
                $order->starts_at->toDateString(),
                "Property 13b (iter {$i}): Order with 1 line must have starts_at = line.starts_at " .
                "(expected {$lineStartsAt->toDateString()}, got {$order->starts_at->toDateString()})"
            );

            $this->assertEquals(
                $lineEndsAt->toDateString(),
                $order->ends_at->toDateString(),
                "Property 13b (iter {$i}): Order with 1 line must have ends_at = line.ends_at " .
                "(expected {$lineEndsAt->toDateString()}, got {$order->ends_at->toDateString()})"
            );
        }
    }

    /**
     * Property 13c: For any order with multiple OrderLines, starts_at must equal
     * MIN(starts_at) and ends_at must equal MAX(ends_at) of all lines.
     *
     * **Validates: Requirements 5.2**
     */
    public function test_order_with_multiple_lines_derives_min_max_dates(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $tenant = Tenant::factory()->create();

            $order = Order::create([
                'tenant_id' => $tenant->id,
                'name' => "Multi Line Order iter {$i}",
                'status' => 'draft',
            ]);

            // Generate 2-5 random order lines with different date ranges
            $numLines = random_int(2, 5);
            $lineStarts = [];
            $lineEnds = [];

            for ($j = 0; $j < $numLines; $j++) {
                $startOffset = random_int(0, 365);
                $duration = random_int(1, 180);
                $lineStartsAt = Carbon::parse('2025-01-01')->addDays($startOffset);
                $lineEndsAt = $lineStartsAt->copy()->addDays($duration);

                $lineStarts[] = $lineStartsAt->toDateString();
                $lineEnds[] = $lineEndsAt->toDateString();

                OrderLine::withoutEvents(function () use ($order, $lineStartsAt, $lineEndsAt, $i, $j) {
                    return OrderLine::create([
                        'order_id' => $order->id,
                        'name' => "Line {$j} iter {$i}",
                        'priority_tier' => 'estandar',
                        'starts_at' => $lineStartsAt->toDateString(),
                        'ends_at' => $lineEndsAt->toDateString(),
                        'delivery_pace' => 'uniform',
                        'share_weight' => 1,
                        'status' => 'draft',
                    ]);
                });
            }

            $expectedStartsAt = min($lineStarts);
            $expectedEndsAt = max($lineEnds);

            $order->refresh();

            $this->assertEquals(
                $expectedStartsAt,
                $order->starts_at->toDateString(),
                "Property 13c (iter {$i}): Order with {$numLines} lines must have starts_at = MIN(line.starts_at). " .
                "Line starts: " . implode(', ', $lineStarts) . " → " .
                "expected {$expectedStartsAt}, got {$order->starts_at->toDateString()}"
            );

            $this->assertEquals(
                $expectedEndsAt,
                $order->ends_at->toDateString(),
                "Property 13c (iter {$i}): Order with {$numLines} lines must have ends_at = MAX(line.ends_at). " .
                "Line ends: " . implode(', ', $lineEnds) . " → " .
                "expected {$expectedEndsAt}, got {$order->ends_at->toDateString()}"
            );
        }
    }

    /**
     * Property 13d: The API endpoint GET /api/admin/orders/{id} returns the computed
     * starts_at and ends_at values correctly derived from order lines.
     *
     * **Validates: Requirements 5.2**
     */
    public function test_api_endpoint_returns_computed_dates(): void
    {
        for ($i = 0; $i < 50; $i++) {
            $tenant = Tenant::factory()->create();

            // Create a user for authentication
            $user = \App\Models\User::factory()->create([
                'tenant_id' => $tenant->id,
                'role' => 'tenant_admin',
            ]);

            $order = Order::create([
                'tenant_id' => $tenant->id,
                'name' => "API Order iter {$i}",
                'status' => 'draft',
            ]);

            // Generate 1-4 random lines
            $numLines = random_int(1, 4);
            $lineStarts = [];
            $lineEnds = [];

            for ($j = 0; $j < $numLines; $j++) {
                $startOffset = random_int(0, 365);
                $duration = random_int(1, 180);
                $lineStartsAt = Carbon::parse('2025-01-01')->addDays($startOffset);
                $lineEndsAt = $lineStartsAt->copy()->addDays($duration);

                $lineStarts[] = $lineStartsAt->toDateString();
                $lineEnds[] = $lineEndsAt->toDateString();

                OrderLine::withoutEvents(function () use ($order, $lineStartsAt, $lineEndsAt, $i, $j) {
                    return OrderLine::create([
                        'order_id' => $order->id,
                        'name' => "API Line {$j} iter {$i}",
                        'priority_tier' => 'estandar',
                        'starts_at' => $lineStartsAt->toDateString(),
                        'ends_at' => $lineEndsAt->toDateString(),
                        'delivery_pace' => 'uniform',
                        'share_weight' => 1,
                        'status' => 'draft',
                    ]);
                });
            }

            $expectedStartsAt = min($lineStarts);
            $expectedEndsAt = max($lineEnds);

            // Call the API
            $response = $this->actingAs($user)->getJson("/api/admin/orders/{$order->id}");

            $response->assertStatus(200);

            $data = $response->json('data');

            $this->assertNotNull(
                $data['starts_at'],
                "Property 13d (iter {$i}): API response must include non-null starts_at for order with lines"
            );

            $this->assertNotNull(
                $data['ends_at'],
                "Property 13d (iter {$i}): API response must include non-null ends_at for order with lines"
            );

            // Parse dates from API response (may include time component)
            $apiStartsAt = Carbon::parse($data['starts_at'])->toDateString();
            $apiEndsAt = Carbon::parse($data['ends_at'])->toDateString();

            $this->assertEquals(
                $expectedStartsAt,
                $apiStartsAt,
                "Property 13d (iter {$i}): API must return starts_at = MIN(line.starts_at). " .
                "Expected {$expectedStartsAt}, got {$apiStartsAt}"
            );

            $this->assertEquals(
                $expectedEndsAt,
                $apiEndsAt,
                "Property 13d (iter {$i}): API must return ends_at = MAX(line.ends_at). " .
                "Expected {$expectedEndsAt}, got {$apiEndsAt}"
            );
        }
    }

    /**
     * Property 13e: The API endpoint returns null dates for orders without lines.
     *
     * **Validates: Requirements 5.2**
     */
    public function test_api_endpoint_returns_null_dates_for_empty_order(): void
    {
        for ($i = 0; $i < 20; $i++) {
            $tenant = Tenant::factory()->create();

            $user = \App\Models\User::factory()->create([
                'tenant_id' => $tenant->id,
                'role' => 'tenant_admin',
            ]);

            $order = Order::create([
                'tenant_id' => $tenant->id,
                'name' => "Empty API Order iter {$i}",
                'status' => 'draft',
            ]);

            $response = $this->actingAs($user)->getJson("/api/admin/orders/{$order->id}");

            $response->assertStatus(200);

            $data = $response->json('data');

            $this->assertNull(
                $data['starts_at'],
                "Property 13e (iter {$i}): API must return starts_at = null for order without lines"
            );

            $this->assertNull(
                $data['ends_at'],
                "Property 13e (iter {$i}): API must return ends_at = null for order without lines"
            );
        }
    }
}
