<?php

namespace Database\Factories;

use App\Models\Screen;
use App\Models\Tenant;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\Screen>
 */
class ScreenFactory extends Factory
{
    protected $model = Screen::class;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'tenant_id' => Tenant::factory(),
            'group_id' => null,
            'venue_id' => 'venue-' . Str::uuid()->toString(),
            'device_token_hash' => Hash::make('test-device-token'),
            'name' => fake()->words(3, true) . ' Screen',
            'status' => 'offline',
            'orientation' => 'landscape',
            'resolution_width' => 1920,
            'resolution_height' => 1080,
            'duration_seconds' => null,
            'schedule' => null,
            'loop_config' => [
                'slots' => [
                    ['source' => 'prodooh', 'duration' => 10],
                    ['source' => 'gam', 'duration' => 10],
                    ['source' => 'url', 'duration' => 10],
                    ['source' => 'playlist', 'duration' => 10],
                ],
            ],
            'sources_config' => [
                'prodooh' => ['enabled' => true],
                'gam' => ['enabled' => true],
                'url' => ['enabled' => true],
                'playlist' => ['enabled' => true],
            ],
            'transition_type' => null,
            'transition_duration_ms' => null,
            'playlist_version' => '',
            'last_heartbeat' => null,
            'last_storage_status' => null,
        ];
    }

    /**
     * Set a specific device token (stores the hash).
     */
    public function withDeviceToken(string $token): static
    {
        return $this->state(fn (array $attributes) => [
            'device_token_hash' => Hash::make($token),
        ]);
    }
}
