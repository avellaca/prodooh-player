<?php

namespace Database\Factories;

use App\Models\Content;
use App\Models\Tenant;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\Content>
 */
class ContentFactory extends Factory
{
    protected $model = Content::class;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'tenant_id' => Tenant::factory(),
            'filename' => fake()->word() . '.mp4',
            'mime_type' => 'video/mp4',
            'storage_path' => 'content/' . Str::uuid() . '.mp4',
            'file_size_bytes' => fake()->numberBetween(100000, 10000000),
            'width' => 1920,
            'height' => 1080,
            'duration_seconds' => fake()->numberBetween(5, 30),
            'orientation' => 'landscape',
            'rotation' => 0,
            'checksum_sha256' => hash('sha256', Str::random(32)),
        ];
    }
}
