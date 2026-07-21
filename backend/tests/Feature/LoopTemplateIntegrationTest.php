<?php

namespace Tests\Feature;

use App\Models\Content;
use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\ScreenManifest;
use App\Models\Tenant;
use App\Models\User;
use App\Models\UserInvitation;
use App\Services\LoopTemplateGeneratorInterface;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Integration tests for end-to-end flows.
 *
 * Validates: Requirements 2.11, 6.1, 10.1, 1.8
 */
class LoopTemplateIntegrationTest extends TestCase
{
    use RefreshDatabase;

    private string $jwtSecret = 'test-jwt-secret-key-must-be-at-least-32-bytes-long';
    private Tenant $tenant;
    private User $tenantAdmin;
    private ScreenGroup $group;
    private Screen $screen;

    protected function setUp(): void
    {
        parent::setUp();

        config(['jwt.secret' => $this->jwtSecret]);
        config(['jwt.ttl' => 1440]);
        config(['jwt.algorithm' => 'HS256']);

        $this->tenant = Tenant::factory()->create([
            'num_slots' => 10,
            'ssp_slots' => 2,
            'playlist_slots' => 1,
            'default_duration_seconds' => 10,
            'sync_interval_seconds' => 240,
            'cache_flush_interval_hours' => 24,
        ]);

        $this->tenantAdmin = User::factory()->tenantAdmin()->create([
            'tenant_id' => $this->tenant->id,
        ]);

        $this->group = ScreenGroup::factory()->create([
            'tenant_id' => $this->tenant->id,
            'duration_seconds' => 10,
        ]);

        $this->screen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'group_id' => $this->group->id,
        ]);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Test 1: Activation flow with availability check
    // Validates: Requirements 2.11, 6.1
    // ──────────────────────────────────────────────────────────────────────

    public function test_activation_flow_with_availability_check(): void
    {
        $this->actingAs($this->tenantAdmin, 'sanctum');

        // 1. Create an order
        $order = Order::factory()->create([
            'tenant_id' => $this->tenant->id,
            'status' => 'active',
        ]);

        // 2. Create an order line in draft status
        $orderLine = OrderLine::factory()->create([
            'order_id' => $order->id,
            'priority_tier' => 'estandar',
            'status' => 'draft',
            'starts_at' => now()->subDays(1),
            'ends_at' => now()->addDays(30),
            'target_spots' => 100,
            'delivery_pace' => 'uniform',
        ]);

        // 3. Create a target pointing to the screen
        $target = OrderLineTarget::create([
            'order_line_id' => $orderLine->id,
            'screen_id' => $this->screen->id,
            'screen_group_id' => null,
        ]);

        // 4. Create a creative for the line
        $content = Content::factory()->create(['tenant_id' => $this->tenant->id]);
        Creative::factory()->create([
            'order_line_target_id' => $target->id,
            'order_line_id' => $orderLine->id,
            'content_id' => $content->id,
            'weight' => 1,
        ]);

        // 5. Check availability before activation
        $availabilityResponse = $this->getJson("/api/admin/order-lines/{$orderLine->id}/availability");
        $availabilityResponse->assertOk()
            ->assertJsonStructure([
                'data' => [
                    'is_sufficient',
                    'target_spots',
                    'available_capacity',
                    'saturation_percent',
                ],
            ]);

        // 6. Activate the order line
        $activateResponse = $this->patchJson("/api/admin/order-lines/{$orderLine->id}/activate");
        $activateResponse->assertOk();

        // Verify the order line is now active
        $orderLine->refresh();
        $this->assertEquals('active', $orderLine->status);

        // 7. Verify the loop template was regenerated (screen_manifests row exists)
        $manifest = ScreenManifest::where('screen_id', $this->screen->id)->first();
        $this->assertNotNull($manifest, 'Loop template should be generated after activation');
        $this->assertNotNull($manifest->version);
        $this->assertIsArray($manifest->items);

        // 8. Verify the manifest contains the activated line's content
        $items = $manifest->items;
        $this->assertArrayHasKey('slots', $items);
        $this->assertNotEmpty($items['slots']);

        // Verify ad slots exist
        $adSlots = array_filter($items['slots'], fn($s) => $s['type'] === 'ad');
        $this->assertNotEmpty($adSlots, 'Should have ad slots after activation');
    }

    // ──────────────────────────────────────────────────────────────────────
    // Test 2: Loop template generation from order creation to player consumption
    // Validates: Requirements 2.11
    // ──────────────────────────────────────────────────────────────────────

    public function test_loop_template_generation_to_player_consumption(): void
    {
        $this->actingAs($this->tenantAdmin, 'sanctum');

        // 1. Create an order via API
        $orderResponse = $this->postJson('/api/admin/orders', [
            'name' => 'Integration Test Order',
            'advertiser_name' => 'Test Advertiser',
        ]);
        $orderResponse->assertCreated();
        $orderId = $orderResponse->json('data.id');

        // 2. Create an order line via API
        $lineResponse = $this->postJson("/api/admin/orders/{$orderId}/order-lines", [
            'name' => 'Integration Test Line',
            'priority_tier' => 'estandar',
            'starts_at' => now()->subDays(1)->toDateString(),
            'ends_at' => now()->addDays(30)->toDateString(),
            'target_spots' => 200,
            'delivery_pace' => 'uniform',
            'status' => 'draft',
        ]);
        $lineResponse->assertCreated();
        $lineId = $lineResponse->json('data.id');

        // 3. Create a target pointing to the screen
        $targetResponse = $this->postJson("/api/admin/order-lines/{$lineId}/targets", [
            'screen_id' => $this->screen->id,
        ]);
        $targetResponse->assertCreated();
        $targetId = $targetResponse->json('data.id');

        // 4. Assign a creative
        $content = Content::factory()->create(['tenant_id' => $this->tenant->id]);
        $creativeResponse = $this->postJson("/api/admin/order-line-targets/{$targetId}/creatives", [
            'content_id' => $content->id,
            'weight' => 1,
        ]);
        $creativeResponse->assertCreated();

        // 5. Activate the order line (triggers loop template regeneration)
        $activateResponse = $this->patchJson("/api/admin/order-lines/{$lineId}/activate");
        $activateResponse->assertOk();

        // 6. Verify loop template was generated
        $manifest = ScreenManifest::where('screen_id', $this->screen->id)->first();
        $this->assertNotNull($manifest, 'Manifest should exist after activation');

        // 7. Player polls the manifest (simulating device auth)
        $token = $this->issueDeviceToken($this->screen);

        $deviceResponse = $this->getJson('/api/device/manifest', [
            'Authorization' => 'Bearer ' . $token,
        ]);
        $deviceResponse->assertOk()
            ->assertJsonStructure([
                'version',
                'generated_at',
                'loop_config' => ['num_slots', 'slot_duration_seconds', 'loop_duration_seconds', 'loops_per_day'],
                'slots',
                'sync_interval_seconds',
                'cache_flush_interval_hours',
            ]);

        $templateData = $deviceResponse->json();
        $this->assertEquals(240, $templateData['sync_interval_seconds']);
        $this->assertEquals(24, $templateData['cache_flush_interval_hours']);
        $this->assertNotEmpty($templateData['slots']);

        // 8. Verify the template has the correct structure (num_slots total)
        $this->assertCount(
            $templateData['loop_config']['num_slots'],
            $templateData['slots'],
            'Template should have exactly num_slots positions'
        );

        // 9. Verify ETag is present for caching
        $deviceResponse->assertHeader('ETag');

        // 10. Verify HTTP 304 when no change (If-None-Match)
        $etag = $deviceResponse->headers->get('ETag');
        $cachedResponse = $this->getJson('/api/device/manifest', [
            'Authorization' => 'Bearer ' . $token,
            'If-None-Match' => $etag,
        ]);
        $cachedResponse->assertStatus(304);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Test 3: User invitation → registration → login flow
    // Validates: Requirements 10.1
    // ──────────────────────────────────────────────────────────────────────

    public function test_user_invitation_registration_login_flow(): void
    {
        Mail::fake();

        $this->actingAs($this->tenantAdmin, 'sanctum');

        $newUserEmail = 'integration-test-' . Str::random(8) . '@example.com';

        // 1. Tenant admin invites a new user
        $inviteResponse = $this->postJson('/api/admin/users/invite', [
            'email' => $newUserEmail,
            'role' => 'trafficker',
        ]);
        $inviteResponse->assertCreated()
            ->assertJson([
                'message' => 'Invitation sent successfully.',
                'email' => $newUserEmail,
                'role' => 'trafficker',
                'tenant_id' => $this->tenant->id,
            ]);

        // Retrieve the token from the database
        $invitation = UserInvitation::where('email', $newUserEmail)->first();
        $this->assertNotNull($invitation, 'Invitation should be stored in database');
        $this->assertNotNull($invitation->token);
        $this->assertEquals(64, strlen($invitation->token));

        // 2. New user registers with the invitation token
        $registerResponse = $this->postJson('/api/auth/register', [
            'token' => $invitation->token,
            'password' => 'SecurePassword123!',
            'password_confirmation' => 'SecurePassword123!',
        ]);
        $registerResponse->assertCreated()
            ->assertJson([
                'message' => 'Registration completed successfully.',
            ]);

        // Verify user was created
        $this->assertDatabaseHas('users', [
            'email' => $newUserEmail,
            'role' => 'trafficker',
            'tenant_id' => $this->tenant->id,
            'is_active' => true,
        ]);

        // 3. Newly registered user logs in
        $loginResponse = $this->postJson('/api/admin/login', [
            'email' => $newUserEmail,
            'password' => 'SecurePassword123!',
        ]);
        $loginResponse->assertOk()
            ->assertJsonStructure([
                'token',
                'user' => ['id', 'email', 'role', 'tenant_id'],
            ]);

        $loginData = $loginResponse->json();
        $this->assertEquals($newUserEmail, $loginData['user']['email']);
        $this->assertEquals('trafficker', $loginData['user']['role']);
        $this->assertEquals($this->tenant->id, $loginData['user']['tenant_id']);

        // 4. Verify the token works for authenticated requests
        // Reset the acting user so the Bearer token is used instead
        $this->app['auth']->forgetGuards();
        $authToken = $loginData['token'];
        $userResponse = $this->withHeaders([
            'Authorization' => 'Bearer ' . $authToken,
        ])->getJson('/api/admin/user');
        $userResponse->assertOk()
            ->assertJson([
                'email' => $newUserEmail,
                'role' => 'trafficker',
            ]);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Test 4: num_slots propagation across hierarchy
    // Validates: Requirements 1.8
    // ──────────────────────────────────────────────────────────────────────

    public function test_num_slots_propagation_across_hierarchy(): void
    {
        $this->actingAs($this->tenantAdmin, 'sanctum');

        // Create a hierarchy with mixed overrides
        $groupWithOverride = ScreenGroup::factory()->create([
            'tenant_id' => $this->tenant->id,
            'num_slots' => 15, // explicit override
            'duration_seconds' => 10,
        ]);
        $groupWithoutOverride = ScreenGroup::factory()->create([
            'tenant_id' => $this->tenant->id,
            'num_slots' => null, // inherits from tenant
            'duration_seconds' => 10,
        ]);

        $screenWithOverride = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'group_id' => $groupWithOverride->id,
            'num_slots' => 20, // explicit override
        ]);
        $screenWithoutOverride1 = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'group_id' => $groupWithOverride->id,
            'num_slots' => null, // inherits
        ]);
        $screenWithoutOverride2 = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'group_id' => $groupWithoutOverride->id,
            'num_slots' => null, // inherits
        ]);

        // 1. Update the tenant's loop config
        $updateResponse = $this->putJson("/api/admin/tenants/{$this->tenant->id}/loop-config", [
            'num_slots' => 12,
            'ssp_slots' => 2,
            'playlist_slots' => 1,
        ]);
        $updateResponse->assertOk();

        // 2. Propagate num_slots to descendants without explicit override
        $propagateResponse = $this->postJson("/api/admin/tenants/{$this->tenant->id}/loop-config/propagate");
        $propagateResponse->assertOk()
            ->assertJsonStructure([
                'message',
                'affected_screen_groups',
                'affected_screens',
                'num_slots',
            ]);

        $propagateData = $propagateResponse->json();
        $this->assertEquals(12, $propagateData['num_slots']);

        // 3. Verify: entities WITH explicit override keep their original values
        $groupWithOverride->refresh();
        $this->assertEquals(15, $groupWithOverride->num_slots, 'Group with override should keep its value');

        $screenWithOverride->refresh();
        $this->assertEquals(20, $screenWithOverride->num_slots, 'Screen with override should keep its value');

        // 4. Verify: entities WITHOUT override now have the propagated value
        $groupWithoutOverride->refresh();
        $this->assertEquals(12, $groupWithoutOverride->num_slots, 'Group without override should get propagated value');

        $screenWithoutOverride1->refresh();
        $this->assertEquals(12, $screenWithoutOverride1->num_slots, 'Screen without override should get propagated value');

        $screenWithoutOverride2->refresh();
        $this->assertEquals(12, $screenWithoutOverride2->num_slots, 'Screen without override should get propagated value');

        // 5. Verify that num_slots resolution uses the correct hierarchy
        // The LoopTemplateGenerator should resolve using inheritance
        $generator = app(LoopTemplateGeneratorInterface::class);

        // Screen with explicit override: uses its own value
        $resolvedOverride = $generator->resolveNumSlots($screenWithOverride);
        $this->assertEquals(20, $resolvedOverride);

        // Screen without override after propagation: uses the propagated value (now 12)
        $resolvedPropagated = $generator->resolveNumSlots($screenWithoutOverride1);
        $this->assertEquals(12, $resolvedPropagated);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────────────

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
}
