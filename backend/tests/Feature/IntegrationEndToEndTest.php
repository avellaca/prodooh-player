<?php

namespace Tests\Feature;

use App\Console\Commands\MidnightRolloverCommand;
use App\Jobs\RecalculateManifestJob;
use App\Models\Content;
use App\Models\Creative;
use App\Models\Impression;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\ScreenManifest;
use App\Models\Tenant;
use App\Services\BresenhamInterleaver;
use App\Services\CreativeSelector;
use App\Services\ManifestGenerator;
use App\Services\PriorityEngine;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Bus;
use Tests\TestCase;

class IntegrationEndToEndTest extends TestCase
{
    use RefreshDatabase;

    private string $jwtSecret = 'test-jwt-secret-key-must-be-at-least-32-bytes-long';

    protected function setUp(): void
    {
        parent::setUp();

        config(['jwt.secret' => $this->jwtSecret]);
        config(['jwt.ttl' => 1440]);
        config(['jwt.algorithm' => 'HS256']);
    }

    // ──────────────────────────────────────────────
    // Test 1: Full pipeline — create data → PriorityEngine → verify manifest
    // ──────────────────────────────────────────────

    public function test_full_pipeline_creates_manifest_with_correct_structure(): void
    {
        // Arrange: create tenant → group → screen → order → lines → creatives → targets
        $tenant = Tenant::factory()->create(['default_duration_seconds' => 10]);
        $group = ScreenGroup::factory()->create([
            'tenant_id' => $tenant->id,
            'duration_seconds' => 10,
        ]);
        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'group_id' => $group->id,
        ]);

        $order = Order::factory()->create([
            'tenant_id' => $tenant->id,
            'status' => 'active',
            'starts_at' => now()->subDays(5),
            'ends_at' => now()->addDays(30),
        ]);

        $line1 = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'patrocinio',
            'status' => 'active',
            'starts_at' => now()->subDays(3),
            'ends_at' => now()->addDays(20),
            'target_spots' => 100,
            'delivery_pace' => 'uniform',
            'share_weight' => 5,
        ]);

        $line2 = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'estandar',
            'status' => 'active',
            'starts_at' => now()->subDays(3),
            'ends_at' => now()->addDays(20),
            'target_spots' => 200,
            'delivery_pace' => 'uniform',
            'share_weight' => 3,
        ]);

        // Create targets pointing to the screen
        $target1 = OrderLineTarget::create([
            'order_line_id' => $line1->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);
        $target2 = OrderLineTarget::create([
            'order_line_id' => $line2->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);

        // Create creatives for each line, linked to their targets
        $content1 = Content::factory()->create(['tenant_id' => $tenant->id]);
        $creative1 = Creative::factory()->create([
            'order_line_target_id' => $target1->id,
            'order_line_id' => $line1->id,
            'content_id' => $content1->id,
            'weight' => 1,
        ]);

        $content2 = Content::factory()->create(['tenant_id' => $tenant->id]);
        $creative2 = Creative::factory()->create([
            'order_line_target_id' => $target2->id,
            'order_line_id' => $line2->id,
            'content_id' => $content2->id,
            'weight' => 1,
        ]);

        // Act: Run RecalculateManifestJob synchronously
        $job = new RecalculateManifestJob($screen->id, false);
        $job->handle(
            app(PriorityEngine::class),
            app(ManifestGenerator::class),
        );

        // Assert: verify screen_manifests row exists with correct data
        $manifest = ScreenManifest::where('screen_id', $screen->id)->first();
        $this->assertNotNull($manifest, 'Manifest should exist after recalculation');
        $this->assertNotEmpty($manifest->version, 'Version should be a non-empty hash');
        $this->assertNotNull($manifest->generated_at);
        $this->assertGreaterThan(0, $manifest->total_spots);
        $this->assertIsArray($manifest->items);
        $this->assertNotEmpty($manifest->items, 'Items should not be empty when there are active lines');

        // Verify item types are valid
        $validTypes = ['order_line_creative', 'prodooh_ssp_call', 'playlist_item'];
        foreach ($manifest->items as $item) {
            $this->assertContains($item['type'], $validTypes);
            $this->assertArrayHasKey('position', $item);
            $this->assertArrayHasKey('duration_seconds', $item);
        }

        // Verify there's at least one order_line_creative item
        $orderLineItems = array_filter($manifest->items, fn($i) => $i['type'] === 'order_line_creative');
        $this->assertNotEmpty($orderLineItems, 'Should have order_line_creative items');
    }

    // ──────────────────────────────────────────────
    // Test 2: Polling + confirm — GET manifest → verify → POST confirm
    // ──────────────────────────────────────────────

    public function test_polling_and_confirm_updates_manifest_version(): void
    {
        // Arrange: create screen with manifest
        $tenant = Tenant::factory()->create();
        $screen = Screen::factory()->create(['tenant_id' => $tenant->id]);
        $token = $this->issueToken($screen);

        $manifestVersion = hash('sha256', 'test-manifest-content');
        ScreenManifest::create([
            'screen_id' => $screen->id,
            'version' => $manifestVersion,
            'generated_at' => now(),
            'items' => [
                [
                    'position' => 0,
                    'type' => 'order_line_creative',
                    'asset_url' => 'https://cdn.example.com/video.mp4',
                    'checksum_sha256' => hash('sha256', 'video-content'),
                    'duration_seconds' => 10,
                    'order_line_id' => fake()->uuid(),
                    'creative_id' => fake()->uuid(),
                ],
                [
                    'position' => 1,
                    'type' => 'prodooh_ssp_call',
                    'duration_seconds' => 10,
                ],
            ],
            'total_spots' => 100,
            'remaining_spots' => 80,
        ]);

        // Act 1: Poll manifest (GET)
        $response = $this->getJson('/api/device/manifest', [
            'Authorization' => 'Bearer ' . $token,
        ]);

        // Assert: response structure is correct
        $response->assertStatus(200);
        $response->assertJsonStructure([
            'version',
            'generated_at',
            'items' => [
                '*' => ['position', 'type', 'duration_seconds'],
            ],
        ]);
        $data = $response->json();
        $this->assertEquals($manifestVersion, $data['version']);
        $this->assertCount(2, $data['items']);
        $response->assertHeader('ETag', $manifestVersion);

        // Act 2: Confirm manifest adoption (POST)
        $confirmResponse = $this->postJson('/api/device/manifest/confirm', [
            'version' => $manifestVersion,
        ], [
            'Authorization' => 'Bearer ' . $token,
        ]);

        // Assert: confirm succeeded and version is updated in DB
        $confirmResponse->assertStatus(200);
        $confirmResponse->assertJson(['ack' => true]);

        $screen->refresh();
        $this->assertEquals($manifestVersion, $screen->manifest_version);
    }

    // ──────────────────────────────────────────────
    // Test 3: Impressions affect budget on next recalculation
    // ──────────────────────────────────────────────

    public function test_impressions_affect_daily_budget_on_recalculation(): void
    {
        // Arrange: create a line with uniform target=10
        $tenant = Tenant::factory()->create(['default_duration_seconds' => 10]);
        $group = ScreenGroup::factory()->create([
            'tenant_id' => $tenant->id,
            'duration_seconds' => 10,
        ]);
        $screen = Screen::factory()->create([
            'tenant_id' => $tenant->id,
            'group_id' => $group->id,
        ]);
        $token = $this->issueToken($screen);

        $order = Order::factory()->create([
            'tenant_id' => $tenant->id,
            'status' => 'active',
            'starts_at' => now()->subDays(1),
            'ends_at' => now()->addDays(10),
        ]);

        $line = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'patrocinio',
            'status' => 'active',
            'starts_at' => now()->subDays(1),
            'ends_at' => now()->addDays(10),
            'target_spots' => 100,
            'delivery_pace' => 'uniform',
            'share_weight' => 5,
        ]);

        $content = Content::factory()->create(['tenant_id' => $tenant->id]);

        $target = OrderLineTarget::create([
            'order_line_id' => $line->id,
            'screen_id' => $screen->id,
            'screen_group_id' => null,
        ]);

        $creative = Creative::factory()->create([
            'order_line_target_id' => $target->id,
            'order_line_id' => $line->id,
            'content_id' => $content->id,
            'weight' => 1,
        ]);

        // Act 1: Calculate initial daily_budget (no impressions yet)
        $engine = app(PriorityEngine::class);
        $initialBudget = $engine->calculateDailyBudget($line);

        // Act 2: Report 5 impressions via API
        $impressionsPayload = [];
        for ($i = 0; $i < 5; $i++) {
            $impressionsPayload[] = [
                'order_line_id' => $line->id,
                'creative_id' => $creative->id,
                'started_at' => now()->subMinutes(10 - $i)->toIso8601String(),
                'ended_at' => now()->subMinutes(10 - $i)->addSeconds(10)->toIso8601String(),
                'duration_seconds' => 10,
                'result' => 'success',
                'failure_reason' => null,
            ];
        }

        $response = $this->postJson('/api/device/impressions', [
            'impressions' => $impressionsPayload,
        ], [
            'Authorization' => 'Bearer ' . $token,
        ]);

        $response->assertStatus(201);

        // Assert: impressions are persisted
        $this->assertEquals(5, Impression::where('order_line_id', $line->id)->count());

        // Act 3: Recalculate daily_budget after impressions
        $line->refresh();
        $newBudget = $engine->calculateDailyBudget($line);

        // Assert: new budget reflects delivered impressions
        // Initial: ceil((100 - 0) / remaining_days), After: ceil((100 - 5) / remaining_days)
        $this->assertNotNull($initialBudget);
        $this->assertNotNull($newBudget);
        $this->assertLessThan($initialBudget, $newBudget, 'Daily budget should decrease after impressions are delivered');
    }

    // ──────────────────────────────────────────────
    // Test 4: Midnight rollover dispatches recalculation for all screens
    // ──────────────────────────────────────────────

    public function test_midnight_rollover_generates_manifests_for_all_screens(): void
    {
        // Arrange: create 3 screens with active lines so manifests can be generated
        $tenant = Tenant::factory()->create(['default_duration_seconds' => 10]);
        $group = ScreenGroup::factory()->create([
            'tenant_id' => $tenant->id,
            'duration_seconds' => 10,
        ]);

        $screens = [];
        for ($i = 0; $i < 3; $i++) {
            $screens[] = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'group_id' => $group->id,
            ]);
        }

        // Create an order with lines targeting the group (covers all 3 screens)
        $order = Order::factory()->create([
            'tenant_id' => $tenant->id,
            'status' => 'active',
            'starts_at' => now()->subDays(5),
            'ends_at' => now()->addDays(30),
        ]);

        $line = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'estandar',
            'status' => 'active',
            'starts_at' => now()->subDays(3),
            'ends_at' => now()->addDays(20),
            'target_spots' => 500,
            'delivery_pace' => 'uniform',
            'share_weight' => 5,
        ]);

        $content = Content::factory()->create(['tenant_id' => $tenant->id]);

        // Target the group (all screens in it)
        $target = OrderLineTarget::create([
            'order_line_id' => $line->id,
            'screen_id' => null,
            'screen_group_id' => $group->id,
        ]);

        Creative::factory()->create([
            'order_line_target_id' => $target->id,
            'order_line_id' => $line->id,
            'content_id' => $content->id,
            'weight' => 1,
        ]);

        // Act: Dispatch MidnightRolloverCommand with sync queue
        Bus::fake([RecalculateManifestJob::class]);

        Artisan::call('manifest:rollover');

        // Assert: RecalculateManifestJob was dispatched for all 3 screens
        Bus::assertDispatched(RecalculateManifestJob::class, 3);

        foreach ($screens as $screen) {
            Bus::assertDispatched(
                RecalculateManifestJob::class,
                fn(RecalculateManifestJob $job) => $job->screenId === $screen->id && $job->isIntraDay === false
            );
        }
    }

    // ──────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────

    private function issueToken(Screen $screen): string
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
}
