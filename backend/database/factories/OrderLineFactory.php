<?php

namespace Database\Factories;

use App\Models\Order;
use App\Models\OrderLine;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\OrderLine>
 */
class OrderLineFactory extends Factory
{
    protected $model = OrderLine::class;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'order_id' => Order::factory(),
            'name' => fake()->sentence(2),
            'priority_tier' => fake()->randomElement(['patrocinio', 'estandar', 'red_interna']),
            'starts_at' => now()->subDays(3),
            'ends_at' => now()->addDays(20),
            'target_spots' => fake()->optional()->numberBetween(100, 10000),
            'delivery_pace' => fake()->randomElement(['uniform', 'asap']),
            'time_window' => null,
            'status' => 'active',
        ];
    }
}
