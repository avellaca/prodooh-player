<?php

namespace Database\Factories;

use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\OrderLineTarget>
 */
class OrderLineTargetFactory extends Factory
{
    protected $model = OrderLineTarget::class;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'order_line_id' => OrderLine::factory(),
            'screen_id' => Screen::factory(),
            'screen_group_id' => null,
        ];
    }

    /**
     * Create a target for a screen group instead of a direct screen.
     */
    public function forScreenGroup(string $screenGroupId): static
    {
        return $this->state(fn() => [
            'screen_id' => null,
            'screen_group_id' => $screenGroupId,
        ]);
    }
}
