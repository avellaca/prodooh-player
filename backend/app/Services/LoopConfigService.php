<?php

namespace App\Services;

use App\Models\Screen;
use Illuminate\Validation\ValidationException;

class LoopConfigService
{
    /**
     * Valid source types for loop slots.
     */
    public const VALID_SOURCES = ['prodooh', 'gam', 'url', 'playlist'];

    /**
     * Get the current loop configuration for a screen.
     *
     * @return array<string, mixed>
     */
    public function getConfig(Screen $screen): array
    {
        return $screen->loop_config ?? [
            'slots' => [
                ['source' => 'prodooh', 'duration' => 10],
                ['source' => 'gam', 'duration' => 10],
                ['source' => 'url', 'duration' => 10],
                ['source' => 'playlist', 'duration' => 10],
            ],
        ];
    }

    /**
     * Validate and update the loop configuration for a screen.
     *
     * @param  array<string, mixed>  $config
     *
     * @throws ValidationException
     */
    public function updateConfig(Screen $screen, array $config): Screen
    {
        $this->validateConfig($config);

        $screen->update(['loop_config' => $config]);

        return $screen->fresh();
    }

    /**
     * Validate a loop configuration array.
     *
     * Ensures:
     * - At least 1 slot exists
     * - Each slot has a valid source type
     * - Each slot has a duration >= 1
     *
     * @param  array<string, mixed>  $config
     *
     * @throws ValidationException
     */
    public function validateConfig(array $config): void
    {
        $errors = [];

        if (! isset($config['slots']) || ! is_array($config['slots'])) {
            throw ValidationException::withMessages([
                'slots' => ['The slots field is required and must be an array.'],
            ]);
        }

        if (count($config['slots']) < 1) {
            throw ValidationException::withMessages([
                'slots' => ['At least one slot is required.'],
            ]);
        }

        foreach ($config['slots'] as $index => $slot) {
            if (! isset($slot['source']) || ! in_array($slot['source'], self::VALID_SOURCES, true)) {
                $errors["slots.{$index}.source"] = [
                    "The slot source must be one of: " . implode(', ', self::VALID_SOURCES) . ".",
                ];
            }

            if (! isset($slot['duration']) || ! is_numeric($slot['duration']) || (int) $slot['duration'] < 1) {
                $errors["slots.{$index}.duration"] = [
                    'The slot duration must be at least 1 second.',
                ];
            }
        }

        if (! empty($errors)) {
            throw ValidationException::withMessages($errors);
        }
    }

    /**
     * Build a slot array from source weight distribution.
     *
     * Distributes totalSlots among sources according to their weights.
     * Weights are normalized so the sum equals totalSlots.
     *
     * @param  array<string, int>  $weights  Source => weight mapping (e.g., ['prodooh' => 3, 'playlist' => 1])
     * @param  int  $totalSlots  Total number of slots in the loop
     * @param  int  $defaultDuration  Default duration in seconds for each slot
     * @return array<int, array{source: string, duration: int}>
     */
    public function buildFromWeights(array $weights, int $totalSlots = 4, int $defaultDuration = 10): array
    {
        $totalWeight = array_sum($weights);

        if ($totalWeight === 0) {
            return [];
        }

        $slots = [];
        $allocated = 0;

        $sources = array_keys($weights);
        $lastSourceIndex = count($sources) - 1;

        foreach ($sources as $i => $source) {
            if ($i === $lastSourceIndex) {
                // Last source gets remaining slots to avoid rounding issues
                $count = $totalSlots - $allocated;
            } else {
                $count = (int) round(($weights[$source] / $totalWeight) * $totalSlots);
                $allocated += $count;
            }

            for ($j = 0; $j < $count; $j++) {
                $slots[] = ['source' => $source, 'duration' => $defaultDuration];
            }
        }

        return $slots;
    }
}
