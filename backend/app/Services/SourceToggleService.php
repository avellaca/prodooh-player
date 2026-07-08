<?php

namespace App\Services;

use App\Models\Screen;
use InvalidArgumentException;

class SourceToggleService
{
    /**
     * Valid sources that can be toggled.
     */
    private const VALID_SOURCES = ['prodooh', 'gam', 'url', 'playlist'];

    /**
     * Toggle a source on or off for a given screen.
     *
     * Strategy: loop_config always stores the "desired/original" slot assignments.
     * sources_config tracks which sources are enabled. The effective loop is computed
     * on-the-fly by replacing disabled source slots with 'playlist'.
     *
     * @throws InvalidArgumentException
     */
    public function toggle(Screen $screen, string $source, bool $enabled): Screen
    {
        $this->validateSource($source);

        if ($source === 'playlist' && !$enabled) {
            throw new InvalidArgumentException('Cannot disable the playlist source — it is the fallback.');
        }

        $sourcesConfig = $screen->sources_config ?? $this->defaultSourcesConfig();
        $sourcesConfig[$source]['enabled'] = $enabled;

        $screen->sources_config = $sourcesConfig;
        $screen->save();

        return $screen->fresh();
    }

    /**
     * Bulk toggle multiple sources at once.
     *
     * @param  array<string, array{enabled: bool}>  $sources
     *
     * @throws InvalidArgumentException
     */
    public function toggleMultiple(Screen $screen, array $sources): Screen
    {
        foreach ($sources as $source => $config) {
            $this->validateSource($source);

            if ($source === 'playlist' && !($config['enabled'] ?? true)) {
                throw new InvalidArgumentException('Cannot disable the playlist source — it is the fallback.');
            }
        }

        $sourcesConfig = $screen->sources_config ?? $this->defaultSourcesConfig();

        foreach ($sources as $source => $config) {
            $sourcesConfig[$source]['enabled'] = $config['enabled'];
        }

        $screen->sources_config = $sourcesConfig;
        $screen->save();

        return $screen->fresh();
    }

    /**
     * Get the effective loop config for a screen, with disabled source slots
     * reassigned to 'playlist'.
     *
     * @return array{slots: array<int, array{source: string, duration: int|float}>}
     */
    public function getEffectiveLoopConfig(Screen $screen): array
    {
        $loopConfig = $screen->loop_config ?? ['slots' => []];
        $sourcesConfig = $screen->sources_config ?? $this->defaultSourcesConfig();

        $disabledSources = [];
        foreach ($sourcesConfig as $source => $config) {
            if (!($config['enabled'] ?? true)) {
                $disabledSources[] = $source;
            }
        }

        if (empty($disabledSources)) {
            return $loopConfig;
        }

        $effectiveSlots = array_map(function (array $slot) use ($disabledSources): array {
            if (in_array($slot['source'], $disabledSources, true)) {
                return array_merge($slot, ['source' => 'playlist']);
            }

            return $slot;
        }, $loopConfig['slots'] ?? []);

        return ['slots' => $effectiveSlots];
    }

    /**
     * Validate that the source is a recognized source type.
     *
     * @throws InvalidArgumentException
     */
    private function validateSource(string $source): void
    {
        if (!in_array($source, self::VALID_SOURCES, true)) {
            throw new InvalidArgumentException(
                "Invalid source '{$source}'. Valid sources are: " . implode(', ', self::VALID_SOURCES)
            );
        }
    }

    /**
     * Default sources config when none is set.
     *
     * @return array<string, array{enabled: bool}>
     */
    private function defaultSourcesConfig(): array
    {
        return [
            'prodooh' => ['enabled' => true],
            'gam' => ['enabled' => true],
            'url' => ['enabled' => true],
            'playlist' => ['enabled' => true],
        ];
    }
}
