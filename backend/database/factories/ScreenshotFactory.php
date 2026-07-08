<?php

namespace Database\Factories;

use App\Models\Screen;
use App\Models\Screenshot;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\Screenshot>
 */
class ScreenshotFactory extends Factory
{
    protected $model = Screenshot::class;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'screen_id' => Screen::factory(),
            'storage_path' => 'screenshots/' . fake()->uuid() . '.png',
            'captured_at' => fake()->dateTimeBetween('-1 day', 'now'),
        ];
    }
}
