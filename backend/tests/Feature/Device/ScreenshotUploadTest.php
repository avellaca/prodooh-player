<?php

namespace Tests\Feature\Device;

use App\Models\DeviceCommand;
use App\Models\Screen;
use App\Models\Screenshot;
use App\Models\Tenant;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ScreenshotUploadTest extends TestCase
{
    use RefreshDatabase;

    private string $jwtSecret = 'test-jwt-secret-key-must-be-at-least-32-bytes-long';
    private Tenant $tenant;
    private Screen $screen;
    private string $token;

    protected function setUp(): void
    {
        parent::setUp();

        config(['jwt.secret' => $this->jwtSecret]);
        config(['jwt.ttl' => 1440]);
        config(['jwt.algorithm' => 'HS256']);

        Storage::fake('local');

        $this->tenant = Tenant::factory()->create();
        $this->screen = Screen::factory()->create(['tenant_id' => $this->tenant->id]);
        $this->token = $this->issueToken($this->screen);
    }

    public function test_successful_screenshot_upload(): void
    {
        $file = UploadedFile::fake()->image('screenshot.jpg', 1920, 1080);
        $capturedAt = '2024-01-15T10:30:00Z';

        $response = $this->postJson('/api/device/screenshot', [
            'image' => $file,
            'captured_at' => $capturedAt,
        ], [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(201);
        $response->assertJsonStructure([
            'id',
            'url',
        ]);

        // Verify the screenshot record was created
        $this->assertDatabaseHas('screenshots', [
            'screen_id' => $this->screen->id,
            'id' => $response->json('id'),
        ]);

        // Verify file was stored
        $storagePath = $response->json('url');
        Storage::disk('local')->assertExists($storagePath);
    }

    public function test_screenshot_upload_with_png(): void
    {
        $file = UploadedFile::fake()->image('screenshot.png', 1920, 1080);
        $capturedAt = '2024-01-15T10:30:00Z';

        $response = $this->postJson('/api/device/screenshot', [
            'image' => $file,
            'captured_at' => $capturedAt,
        ], [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(201);
        $response->assertJsonStructure(['id', 'url']);
    }

    public function test_screenshot_upload_requires_image(): void
    {
        $response = $this->postJson('/api/device/screenshot', [
            'captured_at' => '2024-01-15T10:30:00Z',
        ], [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['image']);
    }

    public function test_screenshot_upload_requires_captured_at(): void
    {
        $file = UploadedFile::fake()->image('screenshot.jpg', 1920, 1080);

        $response = $this->postJson('/api/device/screenshot', [
            'image' => $file,
        ], [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['captured_at']);
    }

    public function test_screenshot_upload_rejects_invalid_file_type(): void
    {
        $file = UploadedFile::fake()->create('document.pdf', 100, 'application/pdf');

        $response = $this->postJson('/api/device/screenshot', [
            'image' => $file,
            'captured_at' => '2024-01-15T10:30:00Z',
        ], [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['image']);
    }

    public function test_screenshot_upload_rejects_invalid_captured_at(): void
    {
        $file = UploadedFile::fake()->image('screenshot.jpg', 1920, 1080);

        $response = $this->postJson('/api/device/screenshot', [
            'image' => $file,
            'captured_at' => 'not-a-valid-date',
        ], [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['captured_at']);
    }

    public function test_screenshot_upload_requires_authentication(): void
    {
        $file = UploadedFile::fake()->image('screenshot.jpg', 1920, 1080);

        $response = $this->postJson('/api/device/screenshot', [
            'image' => $file,
            'captured_at' => '2024-01-15T10:30:00Z',
        ]);

        $response->assertStatus(401);
    }

    public function test_screenshot_upload_marks_pending_command_as_completed(): void
    {
        // Create a pending screenshot command for this screen
        $command = DeviceCommand::factory()->create([
            'screen_id' => $this->screen->id,
            'type' => 'screenshot',
            'status' => 'pending',
        ]);

        $file = UploadedFile::fake()->image('screenshot.jpg', 1920, 1080);

        $response = $this->postJson('/api/device/screenshot', [
            'image' => $file,
            'captured_at' => '2024-01-15T10:30:00Z',
        ], [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(201);

        // Verify the command was marked as completed
        $this->assertDatabaseHas('device_commands', [
            'id' => $command->id,
            'status' => 'completed',
        ]);
    }

    public function test_screenshot_upload_does_not_affect_other_screen_commands(): void
    {
        $otherScreen = Screen::factory()->create(['tenant_id' => $this->tenant->id]);

        // Create a pending screenshot command for another screen
        $otherCommand = DeviceCommand::factory()->create([
            'screen_id' => $otherScreen->id,
            'type' => 'screenshot',
            'status' => 'pending',
        ]);

        $file = UploadedFile::fake()->image('screenshot.jpg', 1920, 1080);

        $response = $this->postJson('/api/device/screenshot', [
            'image' => $file,
            'captured_at' => '2024-01-15T10:30:00Z',
        ], [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(201);

        // The other screen's command should remain pending
        $this->assertDatabaseHas('device_commands', [
            'id' => $otherCommand->id,
            'status' => 'pending',
        ]);
    }

    public function test_screenshot_upload_does_not_affect_non_screenshot_commands(): void
    {
        // Create a pending config_update command for this screen
        $command = DeviceCommand::factory()->create([
            'screen_id' => $this->screen->id,
            'type' => 'config_update',
            'status' => 'pending',
        ]);

        $file = UploadedFile::fake()->image('screenshot.jpg', 1920, 1080);

        $response = $this->postJson('/api/device/screenshot', [
            'image' => $file,
            'captured_at' => '2024-01-15T10:30:00Z',
        ], [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(201);

        // The non-screenshot command should remain pending
        $this->assertDatabaseHas('device_commands', [
            'id' => $command->id,
            'status' => 'pending',
        ]);
    }

    public function test_screenshot_stored_in_correct_path(): void
    {
        $file = UploadedFile::fake()->image('screenshot.jpg', 1920, 1080);

        $response = $this->postJson('/api/device/screenshot', [
            'image' => $file,
            'captured_at' => '2024-01-15T10:30:00Z',
        ], [
            'Authorization' => 'Bearer ' . $this->token,
        ]);

        $response->assertStatus(201);

        $url = $response->json('url');
        // Verify the path format: screenshots/{screen_id}/{uuid}.jpg
        $this->assertStringStartsWith("screenshots/{$this->screen->id}/", $url);
        $this->assertStringEndsWith('.jpg', $url);
    }

    /**
     * Generate a signed JWT token for the given screen.
     */
    private function issueToken(Screen $screen): string
    {
        $payload = [
            'sub' => $screen->id,
            'tenant_id' => $screen->tenant_id,
            'venue_id' => $screen->venue_id,
            'iat' => time(),
            'exp' => time() + 86400,
        ];

        return JWT::encode($payload, $this->jwtSecret, 'HS256');
    }
}
