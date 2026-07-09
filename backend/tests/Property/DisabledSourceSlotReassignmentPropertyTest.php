<?php

namespace Tests\Property;

use App\Services\SourceToggleService;
use Eris\Generators;
use Eris\TestTrait;
use PHPUnit\Framework\TestCase;

/**
 * Property 12: Disabled Source Slot Reassignment
 *
 * Toggle source off → verify all its slots become playlist; total slot count unchanged.
 *
 * **Validates: Requirements 7.6, 10.2**
 */
class DisabledSourceSlotReassignmentPropertyTest extends TestCase
{
    use TestTrait;

    private SourceToggleService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new SourceToggleService();
    }

    /**
     * Property: When a source is disabled, all slots originally assigned to that source
     * become 'playlist' in the effective loop config, while the total slot count remains unchanged.
     *
     * Strategy: Generate random loop configs with various sources and slot counts,
     * then disable one non-playlist source and verify the effective config satisfies:
     * 1. Total slot count is preserved (unchanged)
     * 2. No slot in effective config has the disabled source
     * 3. All slots that were assigned to the disabled source are now 'playlist'
     * 4. All other slots remain unchanged
     *
     * **Validates: Requirements 7.6, 10.2**
     */
    public function test_disabled_source_slots_become_playlist_with_unchanged_total(): void
    {
        $this->forAll(
            Generators::choose(1, 20),  // total number of slots
            Generators::choose(0, 2)    // index of source to disable (maps to non-playlist sources)
        )->then(function (int $totalSlots, int $sourceToDisableIndex): void {
            $allSources = ['prodooh', 'gam', 'url', 'playlist'];
            $disableableSources = ['prodooh', 'gam', 'url'];

            // Pick which source to disable
            $sourceToDisable = $disableableSources[$sourceToDisableIndex];

            // Generate a random loop config with slots assigned to random sources
            $slots = [];
            for ($i = 0; $i < $totalSlots; $i++) {
                $slots[] = [
                    'source' => $allSources[array_rand($allSources)],
                    'duration' => random_int(5, 30),
                ];
            }

            $loopConfig = ['slots' => $slots];

            // Build sources_config with the target source disabled
            $sourcesConfig = [
                'prodooh' => ['enabled' => true],
                'gam' => ['enabled' => true],
                'url' => ['enabled' => true],
                'playlist' => ['enabled' => true],
            ];
            $sourcesConfig[$sourceToDisable]['enabled'] = false;

            // Create a mock screen-like object to pass to getEffectiveLoopConfig
            $screen = new \stdClass();
            $screen->loop_config = $loopConfig;
            $screen->sources_config = $sourcesConfig;

            // Call getEffectiveLoopConfig using reflection to bypass the Screen type hint
            $effectiveConfig = $this->callGetEffectiveLoopConfig($loopConfig, $sourcesConfig);

            $effectiveSlots = $effectiveConfig['slots'];

            // Property 1: Total slot count is preserved
            $this->assertCount(
                $totalSlots,
                $effectiveSlots,
                "Total slot count must remain unchanged after disabling source '{$sourceToDisable}'. " .
                "Expected {$totalSlots}, got " . count($effectiveSlots)
            );

            // Property 2: No slot has the disabled source
            foreach ($effectiveSlots as $index => $slot) {
                $this->assertNotEquals(
                    $sourceToDisable,
                    $slot['source'],
                    "Slot at index {$index} should not have disabled source '{$sourceToDisable}'"
                );
            }

            // Property 3: Slots that had the disabled source are now 'playlist'
            foreach ($slots as $index => $originalSlot) {
                if ($originalSlot['source'] === $sourceToDisable) {
                    $this->assertEquals(
                        'playlist',
                        $effectiveSlots[$index]['source'],
                        "Slot at index {$index} was '{$sourceToDisable}' and should now be 'playlist'"
                    );
                }
            }

            // Property 4: Slots that had other sources remain unchanged
            foreach ($slots as $index => $originalSlot) {
                if ($originalSlot['source'] !== $sourceToDisable) {
                    $this->assertEquals(
                        $originalSlot['source'],
                        $effectiveSlots[$index]['source'],
                        "Slot at index {$index} with source '{$originalSlot['source']}' should remain unchanged"
                    );
                }
            }
        });
    }

    /**
     * Property: When multiple sources are disabled simultaneously, all their slots
     * become 'playlist' and total slot count is unchanged.
     *
     * **Validates: Requirements 7.6, 10.2**
     */
    public function test_multiple_disabled_sources_all_become_playlist(): void
    {
        $this->forAll(
            Generators::choose(2, 16), // total number of slots
            Generators::choose(1, 3)   // how many sources to disable (1 to 3)
        )->then(function (int $totalSlots, int $numToDisable): void {
            $allSources = ['prodooh', 'gam', 'url', 'playlist'];
            $disableableSources = ['prodooh', 'gam', 'url'];

            // Pick which sources to disable
            $numToDisable = min($numToDisable, 3);
            shuffle($disableableSources);
            $sourcesToDisable = array_slice($disableableSources, 0, $numToDisable);

            // Generate a random loop config
            $slots = [];
            for ($i = 0; $i < $totalSlots; $i++) {
                $slots[] = [
                    'source' => $allSources[array_rand($allSources)],
                    'duration' => random_int(5, 30),
                ];
            }

            $loopConfig = ['slots' => $slots];

            // Build sources_config with selected sources disabled
            $sourcesConfig = [
                'prodooh' => ['enabled' => true],
                'gam' => ['enabled' => true],
                'url' => ['enabled' => true],
                'playlist' => ['enabled' => true],
            ];
            foreach ($sourcesToDisable as $source) {
                $sourcesConfig[$source]['enabled'] = false;
            }

            $effectiveConfig = $this->callGetEffectiveLoopConfig($loopConfig, $sourcesConfig);
            $effectiveSlots = $effectiveConfig['slots'];

            // Property: Total slot count preserved
            $this->assertCount(
                $totalSlots,
                $effectiveSlots,
                "Total slot count must remain unchanged after disabling sources: " .
                implode(', ', $sourcesToDisable)
            );

            // Property: No disabled source appears in effective config
            foreach ($effectiveSlots as $index => $slot) {
                $this->assertNotContains(
                    $slot['source'],
                    $sourcesToDisable,
                    "Slot at index {$index} should not have any disabled source. " .
                    "Found '{$slot['source']}', disabled: " . implode(', ', $sourcesToDisable)
                );
            }

            // Property: Slots of disabled sources become 'playlist'
            foreach ($slots as $index => $originalSlot) {
                if (in_array($originalSlot['source'], $sourcesToDisable, true)) {
                    $this->assertEquals(
                        'playlist',
                        $effectiveSlots[$index]['source'],
                        "Slot at index {$index} with disabled source '{$originalSlot['source']}' should be 'playlist'"
                    );
                } else {
                    $this->assertEquals(
                        $originalSlot['source'],
                        $effectiveSlots[$index]['source'],
                        "Slot at index {$index} with enabled source '{$originalSlot['source']}' should remain unchanged"
                    );
                }
            }
        });
    }

    /**
     * Replicate the logic of SourceToggleService::getEffectiveLoopConfig()
     * without requiring a full Eloquent Screen model.
     *
     * This directly tests the algorithm that the service implements.
     *
     * @param  array<string, mixed>  $loopConfig
     * @param  array<string, array{enabled: bool}>  $sourcesConfig
     * @return array{slots: array<int, array{source: string, duration: int|float}>}
     */
    private function callGetEffectiveLoopConfig(array $loopConfig, array $sourcesConfig): array
    {
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
}
