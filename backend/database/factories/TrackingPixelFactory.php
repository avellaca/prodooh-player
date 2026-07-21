<?php

namespace Database\Factories;

use App\Models\TrackingPixel;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\TrackingPixel>
 */
class TrackingPixelFactory extends Factory
{
    protected $model = TrackingPixel::class;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'url' => fake()->url(),
            'trigger_type' => fake()->randomElement(['play', 'impression']),
            'multiplier' => fake()->numberBetween(1, 5),
        ];
    }
}
