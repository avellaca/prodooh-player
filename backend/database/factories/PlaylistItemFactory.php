<?php

namespace Database\Factories;

use App\Models\Playlist;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\PlaylistItem>
 */
class PlaylistItemFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'playlist_id' => Playlist::factory(),
            'content_id' => null,
            'type' => fake()->randomElement(['image', 'video', 'url']),
            'url' => fake()->optional()->url(),
            'duration_seconds' => fake()->numberBetween(5, 60),
            'position' => fake()->numberBetween(0, 10),
            'refresh_interval' => null,
        ];
    }

    /**
     * Create an image item.
     */
    public function image(): static
    {
        return $this->state(fn (array $attributes) => [
            'type' => 'image',
        ]);
    }

    /**
     * Create a video item.
     */
    public function video(): static
    {
        return $this->state(fn (array $attributes) => [
            'type' => 'video',
        ]);
    }

    /**
     * Create a URL item.
     */
    public function url(): static
    {
        return $this->state(fn (array $attributes) => [
            'type' => 'url',
            'url' => fake()->url(),
            'refresh_interval' => fake()->numberBetween(30, 300),
        ]);
    }
}
