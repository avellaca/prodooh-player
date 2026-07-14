<?php

namespace Database\Factories;

use App\Models\Content;
use App\Models\Creative;
use App\Models\OrderLine;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\Creative>
 */
class CreativeFactory extends Factory
{
    protected $model = Creative::class;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'order_line_id' => OrderLine::factory(),
            'content_id' => Content::factory(),
            'weight' => fake()->numberBetween(1, 10),
        ];
    }
}
