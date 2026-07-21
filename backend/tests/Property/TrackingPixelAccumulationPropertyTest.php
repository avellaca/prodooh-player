<?php

namespace Tests\Property;

use App\Jobs\FireTrackingPixelJob;
use App\Models\Content;
use App\Models\Creative;
use App\Models\Impression;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\Tenant;
use App\Models\TrackingPixel;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * Property-based tests for tracking pixel accumulation and multiplier.
 *
 * Property 7: Disparo acumulativo de tracking pixels en los 3 niveles
 * For any impression of a Creative that has tracking pixels at its Order parent,
 * OrderLine parent, and itself, the system SHALL collect and dispatch ALL pixels
 * from the three levels whose trigger_type matches.
 *
 * Property 8: Multiplier determina cantidad de disparos
 * For any tracking pixel with multiplier = N where N ≥ 1, the system SHALL execute
 * exactly N HTTP GET requests per impression that activates it.
 *
 * **Validates: Requirements 13.2, 14.2, 14.3, 15.2, 15.3**
 */
class TrackingPixelAccumulationPropertyTest extends TestCase
{
    use RefreshDatabase;

    private string $jwtSecret = 'test-jwt-secret-key-must-be-at-least-32-bytes-long';

    /**
     * Prevent seeding — avoids conflict with property seed integers.
     */
    protected function shouldSeed(): bool
    {
        return false;
    }

    protected function setUp(): void
    {
        parent::setUp();

        config(['jwt.secret' => $this->jwtSecret]);
        config(['jwt.ttl' => 1440]);
        config(['jwt.algorithm' => 'HS256']);
    }

    /**
     * Issue a JWT token for device authentication.
     */
    private function issueDeviceToken(Screen $screen): string
    {
        $now = time();
        $payload = [
            'sub' => $screen->id,
            'tenant_id' => $screen->tenant_id,
            'venue_id' => $screen->venue_id ?? 'venue-test',
            'iat' => $now,
            'exp' => $now + 86400,
        ];

        return JWT::encode($payload, $this->jwtSecret, 'HS256');
    }

    /**
     * Property 7: For any impression of a Creative that has tracking pixels configured
     * at its Order parent, OrderLine parent, and itself, the system SHALL collect and
     * dispatch ALL pixels from the three levels whose trigger_type matches 'impression'.
     *
     * Strategy:
     * - Generate random tracking pixels (1-3) at each of the 3 levels (Order, OrderLine, Creative)
     * - Each pixel randomly gets trigger_type 'impression' or 'play'
     * - Simulate an impression by calling the ImpressionsController
     * - Verify that ALL pixels with trigger_type='impression' from all 3 levels are dispatched
     * - Verify that pixels with trigger_type='play' are NOT dispatched
     *
     * **Validates: Requirements 13.2, 14.2, 15.2, 15.3**
     */
    public function test_accumulation_dispatches_all_matching_pixels_from_three_levels(): void
    {
        for ($iteration = 0; $iteration < 30; $iteration++) {
            Queue::fake([FireTrackingPixelJob::class]);

            $tenant = Tenant::factory()->create();
            $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
            $token = $this->issueDeviceToken($screen);

            $order = Order::factory()->create(['tenant_id' => $tenant->id]);
            $orderLine = OrderLine::factory()->create([
                'order_id' => $order->id,
                'status' => 'active',
            ]);
            $target = OrderLineTarget::factory()->create([
                'order_line_id' => $orderLine->id,
                'screen_id' => $screen->id,
            ]);
            $content = Content::factory()->create(['tenant_id' => $tenant->id]);
            $creative = Creative::factory()->create([
                'order_line_target_id' => $target->id,
                'order_line_id' => $orderLine->id,
                'content_id' => $content->id,
            ]);

            // Generate random pixels at each level
            $orderPixelCount = random_int(1, 3);
            $orderLinePixelCount = random_int(1, 3);
            $creativePixelCount = random_int(1, 3);

            $allPixels = [];

            // Order-level pixels
            for ($p = 0; $p < $orderPixelCount; $p++) {
                $triggerType = random_int(0, 1) === 0 ? 'impression' : 'play';
                $pixel = TrackingPixel::factory()->create([
                    'trackable_type' => Order::class,
                    'trackable_id' => $order->id,
                    'url' => "https://tracker.example.com/order/{$iteration}/{$p}",
                    'trigger_type' => $triggerType,
                    'multiplier' => 1,
                ]);
                $allPixels[] = ['pixel' => $pixel, 'level' => 'order'];
            }

            // OrderLine-level pixels
            for ($p = 0; $p < $orderLinePixelCount; $p++) {
                $triggerType = random_int(0, 1) === 0 ? 'impression' : 'play';
                $pixel = TrackingPixel::factory()->create([
                    'trackable_type' => OrderLine::class,
                    'trackable_id' => $orderLine->id,
                    'url' => "https://tracker.example.com/orderline/{$iteration}/{$p}",
                    'trigger_type' => $triggerType,
                    'multiplier' => 1,
                ]);
                $allPixels[] = ['pixel' => $pixel, 'level' => 'order_line'];
            }

            // Creative-level pixels
            for ($p = 0; $p < $creativePixelCount; $p++) {
                $triggerType = random_int(0, 1) === 0 ? 'impression' : 'play';
                $pixel = TrackingPixel::factory()->create([
                    'trackable_type' => Creative::class,
                    'trackable_id' => $creative->id,
                    'url' => "https://tracker.example.com/creative/{$iteration}/{$p}",
                    'trigger_type' => $triggerType,
                    'multiplier' => 1,
                ]);
                $allPixels[] = ['pixel' => $pixel, 'level' => 'creative'];
            }

            // Calculate expected: only 'impression' trigger_type pixels should fire
            $expectedImpressionPixels = collect($allPixels)
                ->filter(fn ($entry) => $entry['pixel']->trigger_type === 'impression');
            $expectedCount = $expectedImpressionPixels->count();

            // Simulate the impression via the controller with JWT auth
            $response = $this->postJson('/api/device/impressions', [
                'impressions' => [[
                    'order_line_id' => $orderLine->id,
                    'creative_id' => $creative->id,
                    'started_at' => now()->subSeconds(10)->addSeconds($iteration)->toIso8601String(),
                    'ended_at' => now()->addSeconds($iteration)->toIso8601String(),
                    'duration_seconds' => 10,
                    'result' => 'success',
                ]],
            ], [
                'Authorization' => 'Bearer ' . $token,
            ]);

            $response->assertStatus(201);

            // Verify that exactly the expected number of jobs were dispatched
            Queue::assertPushed(FireTrackingPixelJob::class, $expectedCount);

            // Verify each expected pixel URL was dispatched
            foreach ($expectedImpressionPixels as $entry) {
                $pixelUrl = $entry['pixel']->url;
                Queue::assertPushed(
                    FireTrackingPixelJob::class,
                    fn (FireTrackingPixelJob $job) => $job->pixelUrl === $pixelUrl
                );
            }

            // Verify no 'play' trigger_type pixels were dispatched
            $playPixels = collect($allPixels)
                ->filter(fn ($entry) => $entry['pixel']->trigger_type === 'play');
            foreach ($playPixels as $entry) {
                $pixelUrl = $entry['pixel']->url;
                Queue::assertNotPushed(
                    FireTrackingPixelJob::class,
                    fn (FireTrackingPixelJob $job) => $job->pixelUrl === $pixelUrl
                );
            }

            // Cleanup
            TrackingPixel::query()->delete();
            Impression::query()->delete();
            Creative::query()->delete();
            OrderLineTarget::query()->delete();
            OrderLine::query()->delete();
            Order::query()->delete();
            Content::query()->delete();
            Screen::query()->delete();
            Tenant::query()->delete();
        }
    }

    /**
     * Property 7b: When pixels exist ONLY at some levels (not all 3), the system still
     * dispatches all matching pixels from whatever levels have them configured.
     *
     * For any subset of levels {Order, OrderLine, Creative} that have pixels configured,
     * all matching pixels from those levels SHALL be dispatched.
     *
     * **Validates: Requirements 13.2, 14.2, 15.2, 15.3**
     */
    public function test_accumulation_works_with_partial_level_configuration(): void
    {
        for ($iteration = 0; $iteration < 30; $iteration++) {
            Queue::fake([FireTrackingPixelJob::class]);

            $tenant = Tenant::factory()->create();
            $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
            $token = $this->issueDeviceToken($screen);

            $order = Order::factory()->create(['tenant_id' => $tenant->id]);
            $orderLine = OrderLine::factory()->create([
                'order_id' => $order->id,
                'status' => 'active',
            ]);
            $target = OrderLineTarget::factory()->create([
                'order_line_id' => $orderLine->id,
                'screen_id' => $screen->id,
            ]);
            $content = Content::factory()->create(['tenant_id' => $tenant->id]);
            $creative = Creative::factory()->create([
                'order_line_target_id' => $target->id,
                'order_line_id' => $orderLine->id,
                'content_id' => $content->id,
            ]);

            // Randomly decide which levels have pixels (at least 1 level)
            $hasOrderPixels = (bool) random_int(0, 1);
            $hasOrderLinePixels = (bool) random_int(0, 1);
            $hasCreativePixels = (bool) random_int(0, 1);

            // Ensure at least one level has pixels
            if (!$hasOrderPixels && !$hasOrderLinePixels && !$hasCreativePixels) {
                $choice = random_int(0, 2);
                if ($choice === 0) $hasOrderPixels = true;
                elseif ($choice === 1) $hasOrderLinePixels = true;
                else $hasCreativePixels = true;
            }

            $expectedUrls = [];

            if ($hasOrderPixels) {
                $count = random_int(1, 2);
                for ($p = 0; $p < $count; $p++) {
                    $url = "https://tracker.example.com/partial/order/{$iteration}/{$p}";
                    TrackingPixel::factory()->create([
                        'trackable_type' => Order::class,
                        'trackable_id' => $order->id,
                        'url' => $url,
                        'trigger_type' => 'impression',
                        'multiplier' => 1,
                    ]);
                    $expectedUrls[] = $url;
                }
            }

            if ($hasOrderLinePixels) {
                $count = random_int(1, 2);
                for ($p = 0; $p < $count; $p++) {
                    $url = "https://tracker.example.com/partial/orderline/{$iteration}/{$p}";
                    TrackingPixel::factory()->create([
                        'trackable_type' => OrderLine::class,
                        'trackable_id' => $orderLine->id,
                        'url' => $url,
                        'trigger_type' => 'impression',
                        'multiplier' => 1,
                    ]);
                    $expectedUrls[] = $url;
                }
            }

            if ($hasCreativePixels) {
                $count = random_int(1, 2);
                for ($p = 0; $p < $count; $p++) {
                    $url = "https://tracker.example.com/partial/creative/{$iteration}/{$p}";
                    TrackingPixel::factory()->create([
                        'trackable_type' => Creative::class,
                        'trackable_id' => $creative->id,
                        'url' => $url,
                        'trigger_type' => 'impression',
                        'multiplier' => 1,
                    ]);
                    $expectedUrls[] = $url;
                }
            }

            // Simulate impression
            $response = $this->postJson('/api/device/impressions', [
                'impressions' => [[
                    'order_line_id' => $orderLine->id,
                    'creative_id' => $creative->id,
                    'started_at' => now()->subSeconds(5)->addSeconds($iteration)->toIso8601String(),
                    'ended_at' => now()->addSeconds($iteration)->toIso8601String(),
                    'duration_seconds' => 5,
                    'result' => 'success',
                ]],
            ], [
                'Authorization' => 'Bearer ' . $token,
            ]);

            $response->assertStatus(201);

            // Verify exactly the expected number of jobs
            Queue::assertPushed(FireTrackingPixelJob::class, count($expectedUrls));

            // Verify each expected URL was dispatched
            foreach ($expectedUrls as $url) {
                Queue::assertPushed(
                    FireTrackingPixelJob::class,
                    fn (FireTrackingPixelJob $job) => $job->pixelUrl === $url
                );
            }

            // Cleanup
            TrackingPixel::query()->delete();
            Impression::query()->delete();
            Creative::query()->delete();
            OrderLineTarget::query()->delete();
            OrderLine::query()->delete();
            Order::query()->delete();
            Content::query()->delete();
            Screen::query()->delete();
            Tenant::query()->delete();
        }
    }

    /**
     * Property 8: For any tracking pixel with multiplier = N where N ≥ 1, the system
     * SHALL execute exactly N HTTP GET requests per impression that activates it.
     *
     * Strategy:
     * - Generate pixels with random multipliers (1 to 5)
     * - Verify that the job's handle() method makes exactly N HTTP requests
     *
     * **Validates: Requirements 14.3**
     */
    public function test_multiplier_determines_number_of_http_requests(): void
    {
        for ($iteration = 0; $iteration < 30; $iteration++) {
            // Generate a random multiplier between 1 and 5
            $multiplier = random_int(1, 5);
            $pixelUrl = "https://tracker.example.com/multiplier/{$iteration}";

            // Fake HTTP to count requests
            Http::fake([
                $pixelUrl => Http::response('', 200),
            ]);

            // Create and execute the job directly
            $job = new FireTrackingPixelJob(
                pixelUrl: $pixelUrl,
                creativeId: fake()->uuid(),
                impressionId: fake()->uuid(),
                multiplier: $multiplier,
            );

            $job->handle();

            // Verify exactly N requests were made
            Http::assertSentCount($multiplier);
        }
    }

    /**
     * Property 8b: The multiplier value dispatched in the job matches the multiplier
     * configured on the TrackingPixel record. Verifies end-to-end from pixel config
     * through to job dispatch.
     *
     * Strategy:
     * - Create pixels with random multipliers at all 3 levels
     * - Simulate an impression
     * - Verify each dispatched job carries the correct multiplier from its pixel
     *
     * **Validates: Requirements 14.3**
     */
    public function test_dispatched_job_carries_correct_multiplier_from_pixel_config(): void
    {
        for ($iteration = 0; $iteration < 30; $iteration++) {
            Queue::fake([FireTrackingPixelJob::class]);

            $tenant = Tenant::factory()->create();
            $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
            $token = $this->issueDeviceToken($screen);

            $order = Order::factory()->create(['tenant_id' => $tenant->id]);
            $orderLine = OrderLine::factory()->create([
                'order_id' => $order->id,
                'status' => 'active',
            ]);
            $target = OrderLineTarget::factory()->create([
                'order_line_id' => $orderLine->id,
                'screen_id' => $screen->id,
            ]);
            $content = Content::factory()->create(['tenant_id' => $tenant->id]);
            $creative = Creative::factory()->create([
                'order_line_target_id' => $target->id,
                'order_line_id' => $orderLine->id,
                'content_id' => $content->id,
            ]);

            // Create pixels with random multipliers at each level
            $pixelConfigs = [];

            // Order level
            $orderMultiplier = random_int(1, 5);
            $orderUrl = "https://tracker.example.com/mult/order/{$iteration}";
            TrackingPixel::factory()->create([
                'trackable_type' => Order::class,
                'trackable_id' => $order->id,
                'url' => $orderUrl,
                'trigger_type' => 'impression',
                'multiplier' => $orderMultiplier,
            ]);
            $pixelConfigs[] = ['url' => $orderUrl, 'multiplier' => $orderMultiplier];

            // OrderLine level
            $lineMultiplier = random_int(1, 5);
            $lineUrl = "https://tracker.example.com/mult/line/{$iteration}";
            TrackingPixel::factory()->create([
                'trackable_type' => OrderLine::class,
                'trackable_id' => $orderLine->id,
                'url' => $lineUrl,
                'trigger_type' => 'impression',
                'multiplier' => $lineMultiplier,
            ]);
            $pixelConfigs[] = ['url' => $lineUrl, 'multiplier' => $lineMultiplier];

            // Creative level
            $creativeMultiplier = random_int(1, 5);
            $creativeUrl = "https://tracker.example.com/mult/creative/{$iteration}";
            TrackingPixel::factory()->create([
                'trackable_type' => Creative::class,
                'trackable_id' => $creative->id,
                'url' => $creativeUrl,
                'trigger_type' => 'impression',
                'multiplier' => $creativeMultiplier,
            ]);
            $pixelConfigs[] = ['url' => $creativeUrl, 'multiplier' => $creativeMultiplier];

            // Simulate impression
            $response = $this->postJson('/api/device/impressions', [
                'impressions' => [[
                    'order_line_id' => $orderLine->id,
                    'creative_id' => $creative->id,
                    'started_at' => now()->subSeconds(10)->addSeconds($iteration)->toIso8601String(),
                    'ended_at' => now()->addSeconds($iteration)->toIso8601String(),
                    'duration_seconds' => 10,
                    'result' => 'success',
                ]],
            ], [
                'Authorization' => 'Bearer ' . $token,
            ]);

            $response->assertStatus(201);

            // Verify 3 jobs dispatched (one per pixel)
            Queue::assertPushed(FireTrackingPixelJob::class, 3);

            // Verify each job has the correct multiplier
            foreach ($pixelConfigs as $config) {
                Queue::assertPushed(
                    FireTrackingPixelJob::class,
                    fn (FireTrackingPixelJob $job) =>
                        $job->pixelUrl === $config['url'] &&
                        $job->multiplier === $config['multiplier']
                );
            }

            // Cleanup
            TrackingPixel::query()->delete();
            Impression::query()->delete();
            Creative::query()->delete();
            OrderLineTarget::query()->delete();
            OrderLine::query()->delete();
            Order::query()->delete();
            Content::query()->delete();
            Screen::query()->delete();
            Tenant::query()->delete();
        }
    }
}
