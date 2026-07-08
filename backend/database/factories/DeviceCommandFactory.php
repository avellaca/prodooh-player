<?php

namespace Database\Factories;

use App\Models\DeviceCommand;
use App\Models\Screen;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\DeviceCommand>
 */
class DeviceCommandFactory extends Factory
{
    protected $model = DeviceCommand::class;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'screen_id' => Screen::factory(),
            'type' => fake()->randomElement(['screenshot', 'config_update', 'playlist_update']),
            'payload' => [],
            'status' => 'pending',
            'delivered_at' => null,
        ];
    }

    /**
     * Set the command status to pending.
     */
    public function pending(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'pending',
            'delivered_at' => null,
        ]);
    }

    /**
     * Set the command status to delivered.
     */
    public function delivered(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'delivered',
            'delivered_at' => now(),
        ]);
    }
}
