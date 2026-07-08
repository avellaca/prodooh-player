<?php

namespace Tests\Feature\Device;

use App\Models\PlaybackLog;
use App\Models\Screen;
use App\Models\Tenant;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PlaybackLogTest extends TestCase
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

        $this->tenant = Tenant::factory()->create();
        $this->screen = Screen::factory()->create(['tenant_id' => $this->tenant->id]);
        $this->token = $this->issueToken($this->screen);
    }

    private function issueToken(Screen $screen): string
    {
        $now = time();
        $payload = [
            'sub' => $screen->id,
            'tenant_id' => $screen->tenant_id,
            'venue_id' => $screen->venue_id,
            'iat' => $now,
            'exp' => $now + 86400,
        ];

        return JWT::encode($payload, $this->jwtSecret, 'HS256');
    }

    private function authHeaders(): array
    {
        return ['Authorization' => 'Bearer ' . $this->token];
    }

    public function test_successfully_stores_batched_playback_logs(): void
    {
        $payload = [
            'logs' => [
                [
                    'id' => 'log-uuid-001',
                    'content_id' => 'content-abc',
                    'source' => 'prodooh',
                    'started_at' => '2024-01-15T10:00:00Z',
                    'ended_at' => '2024-01-15T10:00:10Z',
                    'duration_seconds' => 10.0,
                    'result' => 'success',
                ],
                [
                    'id' => 'log-uuid-002',
                    'content_id' => 'content-def',
                    'source' => 'gam',
                    'started_at' => '2024-01-15T10:00:10Z',
                    'ended_at' => '2024-01-15T10:00:20Z',
                    'duration_seconds' => 10.0,
                    'result' => 'success',
                ],
            ],
        ];

        $response = $this->postJson('/api/device/playback-logs', $payload, $this->authHeaders());

        $response->assertStatus(200);
        $response->assertJson([
            'received' => 2,
            'ack_ids' => ['log-uuid-001', 'log-uuid-002'],
        ]);

        $this->assertDatabaseCount('playback_logs', 2);
        $this->assertDatabaseHas('playback_logs', [
            'screen_id' => $this->screen->id,
            'tenant_id' => $this->tenant->id,
            'content_id' => 'content-abc',
            'source' => 'prodooh',
            'result' => 'success',
        ]);
        $this->assertDatabaseHas('playback_logs', [
            'screen_id' => $this->screen->id,
            'tenant_id' => $this->tenant->id,
            'content_id' => 'content-def',
            'source' => 'gam',
            'result' => 'success',
        ]);
    }

    public function test_stores_log_with_failure_reason(): void
    {
        $payload = [
            'logs' => [
                [
                    'id' => 'log-uuid-003',
                    'content_id' => 'content-xyz',
                    'source' => 'playlist',
                    'started_at' => '2024-01-15T10:00:00Z',
                    'ended_at' => '2024-01-15T10:00:05Z',
                    'duration_seconds' => 5.0,
                    'result' => 'failed',
                    'failure_reason' => 'Codec not supported',
                ],
            ],
        ];

        $response = $this->postJson('/api/device/playback-logs', $payload, $this->authHeaders());

        $response->assertStatus(200);
        $response->assertJson([
            'received' => 1,
            'ack_ids' => ['log-uuid-003'],
        ]);

        $this->assertDatabaseHas('playback_logs', [
            'content_id' => 'content-xyz',
            'source' => 'playlist',
            'result' => 'failed',
            'failure_reason' => 'Codec not supported',
        ]);
    }

    public function test_sets_synced_at_timestamp(): void
    {
        $payload = [
            'logs' => [
                [
                    'id' => 'log-uuid-004',
                    'content_id' => 'content-sync',
                    'source' => 'url',
                    'started_at' => '2024-01-15T10:00:00Z',
                    'ended_at' => '2024-01-15T10:00:10Z',
                    'duration_seconds' => 10.0,
                    'result' => 'success',
                ],
            ],
        ];

        $response = $this->postJson('/api/device/playback-logs', $payload, $this->authHeaders());

        $response->assertStatus(200);

        $log = PlaybackLog::where('content_id', 'content-sync')->first();
        $this->assertNotNull($log->synced_at);
    }

    public function test_requires_authentication(): void
    {
        $payload = [
            'logs' => [
                [
                    'id' => 'log-uuid-005',
                    'content_id' => 'content-noauth',
                    'source' => 'prodooh',
                    'started_at' => '2024-01-15T10:00:00Z',
                    'ended_at' => '2024-01-15T10:00:10Z',
                    'duration_seconds' => 10.0,
                    'result' => 'success',
                ],
            ],
        ];

        $response = $this->postJson('/api/device/playback-logs', $payload);

        $response->assertStatus(401);
    }

    public function test_validates_logs_array_is_required(): void
    {
        $response = $this->postJson('/api/device/playback-logs', [], $this->authHeaders());

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['logs']);
    }

    public function test_validates_logs_must_be_array(): void
    {
        $response = $this->postJson('/api/device/playback-logs', ['logs' => 'not-an-array'], $this->authHeaders());

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['logs']);
    }

    public function test_validates_content_id_is_required(): void
    {
        $payload = [
            'logs' => [
                [
                    'id' => 'log-uuid-006',
                    'source' => 'prodooh',
                    'started_at' => '2024-01-15T10:00:00Z',
                    'ended_at' => '2024-01-15T10:00:10Z',
                    'duration_seconds' => 10.0,
                    'result' => 'success',
                ],
            ],
        ];

        $response = $this->postJson('/api/device/playback-logs', $payload, $this->authHeaders());

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['logs.0.content_id']);
    }

    public function test_validates_source_must_be_valid_enum(): void
    {
        $payload = [
            'logs' => [
                [
                    'id' => 'log-uuid-007',
                    'content_id' => 'content-bad-source',
                    'source' => 'invalid_source',
                    'started_at' => '2024-01-15T10:00:00Z',
                    'ended_at' => '2024-01-15T10:00:10Z',
                    'duration_seconds' => 10.0,
                    'result' => 'success',
                ],
            ],
        ];

        $response = $this->postJson('/api/device/playback-logs', $payload, $this->authHeaders());

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['logs.0.source']);
    }

    public function test_validates_result_must_be_valid_enum(): void
    {
        $payload = [
            'logs' => [
                [
                    'id' => 'log-uuid-008',
                    'content_id' => 'content-bad-result',
                    'source' => 'prodooh',
                    'started_at' => '2024-01-15T10:00:00Z',
                    'ended_at' => '2024-01-15T10:00:10Z',
                    'duration_seconds' => 10.0,
                    'result' => 'partial',
                ],
            ],
        ];

        $response = $this->postJson('/api/device/playback-logs', $payload, $this->authHeaders());

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['logs.0.result']);
    }

    public function test_validates_timestamps_are_required(): void
    {
        $payload = [
            'logs' => [
                [
                    'id' => 'log-uuid-009',
                    'content_id' => 'content-no-ts',
                    'source' => 'gam',
                    'duration_seconds' => 10.0,
                    'result' => 'success',
                ],
            ],
        ];

        $response = $this->postJson('/api/device/playback-logs', $payload, $this->authHeaders());

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['logs.0.started_at', 'logs.0.ended_at']);
    }

    public function test_validates_duration_seconds_is_required(): void
    {
        $payload = [
            'logs' => [
                [
                    'id' => 'log-uuid-010',
                    'content_id' => 'content-no-dur',
                    'source' => 'playlist',
                    'started_at' => '2024-01-15T10:00:00Z',
                    'ended_at' => '2024-01-15T10:00:10Z',
                    'result' => 'success',
                ],
            ],
        ];

        $response = $this->postJson('/api/device/playback-logs', $payload, $this->authHeaders());

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['logs.0.duration_seconds']);
    }

    public function test_validates_id_is_required_for_each_log(): void
    {
        $payload = [
            'logs' => [
                [
                    'content_id' => 'content-no-id',
                    'source' => 'prodooh',
                    'started_at' => '2024-01-15T10:00:00Z',
                    'ended_at' => '2024-01-15T10:00:10Z',
                    'duration_seconds' => 10.0,
                    'result' => 'success',
                ],
            ],
        ];

        $response = $this->postJson('/api/device/playback-logs', $payload, $this->authHeaders());

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['logs.0.id']);
    }

    public function test_accepts_all_valid_source_types(): void
    {
        $sources = ['prodooh', 'gam', 'url', 'playlist'];

        $logs = [];
        foreach ($sources as $index => $source) {
            $logs[] = [
                'id' => "log-uuid-src-{$index}",
                'content_id' => "content-{$source}",
                'source' => $source,
                'started_at' => '2024-01-15T10:00:00Z',
                'ended_at' => '2024-01-15T10:00:10Z',
                'duration_seconds' => 10.0,
                'result' => 'success',
            ];
        }

        $response = $this->postJson('/api/device/playback-logs', ['logs' => $logs], $this->authHeaders());

        $response->assertStatus(200);
        $response->assertJson(['received' => 4]);
    }

    public function test_uses_screen_id_and_tenant_id_from_jwt(): void
    {
        $payload = [
            'logs' => [
                [
                    'id' => 'log-uuid-jwt',
                    'content_id' => 'content-jwt-test',
                    'source' => 'prodooh',
                    'started_at' => '2024-01-15T10:00:00Z',
                    'ended_at' => '2024-01-15T10:00:10Z',
                    'duration_seconds' => 10.0,
                    'result' => 'success',
                ],
            ],
        ];

        $response = $this->postJson('/api/device/playback-logs', $payload, $this->authHeaders());

        $response->assertStatus(200);

        $log = PlaybackLog::where('content_id', 'content-jwt-test')->first();
        $this->assertEquals($this->screen->id, $log->screen_id);
        $this->assertEquals($this->tenant->id, $log->tenant_id);
    }
}
