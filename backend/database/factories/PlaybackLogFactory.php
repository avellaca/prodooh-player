<?php

namespace Database\Factories;

use App\Models\PlaybackLog;
use App\Models\Screen;
use App\Models\Tenant;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\PlaybackLog>
 */
class PlaybackLogFactory extends Factory
{
    protected $model = PlaybackLog::class;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $startedAt = fake()->dateTimeBetween('-1 hour', 'now');
        $durationSeconds = fake()->randomFloat(2, 5, 30);
        $endedAt = (clone $startedAt)->modify("+{$durationSeconds} seconds");

        return [
            'screen_id' => Screen::factory(),
            'tenant_id' => Tenant::factory(),
            'content_id' => fake()->uuid(),
            'source' => fake()->randomElement(['prodooh', 'gam', 'url', 'playlist']),
            'started_at' => $startedAt,
            'ended_at' => $endedAt,
            'duration_seconds' => $durationSeconds,
            'result' => fake()->randomElement(['success', 'failed']),
            'failure_reason' => null,
            'synced_at' => now(),
        ];
    }
}
