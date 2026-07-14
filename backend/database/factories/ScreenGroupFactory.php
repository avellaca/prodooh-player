<?php

namespace Database\Factories;

use App\Models\ScreenGroup;
use App\Models\Tenant;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\ScreenGroup>
 */
class ScreenGroupFactory extends Factory
{
    protected $model = ScreenGroup::class;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'tenant_id' => Tenant::factory(),
            'name' => fake()->words(2, true) . ' Group',
            'duration_seconds' => fake()->randomElement([10, 15, 20, 30]),
            'schedule' => null,
        ];
    }
}
