<?php

namespace Database\Factories;

use App\Models\Tenant;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\Tenant>
 */
class TenantFactory extends Factory
{
    protected $model = Tenant::class;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => fake()->company(),
            'api_credential' => Str::uuid()->toString(),
            'default_config' => null,
            'default_duration_seconds' => 10,
            'default_timezone' => 'UTC',
            'default_schedule' => null,
            'transition_type' => 'cut',
            'transition_duration_ms' => 0,
        ];
    }
}
