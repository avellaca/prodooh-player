<?php

namespace Tests\Property;

use App\Services\LoopConfigValidator;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

/**
 * Property-based tests for LoopConfigValidator.
 *
 * Uses randomized inputs (100 iterations) to verify universal properties
 * about validation ranges and the ad_slots invariant.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 8.1, 8.2**
 */
class LoopConfigValidatorPropertyTest extends TestCase
{
    private LoopConfigValidator $validator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->validator = new LoopConfigValidator();
    }

    // ─── Property 1: Validation of range for loop config fields ─────────────

    /**
     * Property 1a: num_slots accepts values within [1, 100] and rejects values outside.
     *
     * For any integer value, the validator accepts it as num_slots if and only if
     * it is within [1, 100].
     *
     * **Validates: Requirements 1.1**
     */
    public function test_num_slots_accepts_values_within_range_and_rejects_outside(): void
    {
        for ($i = 0; $i < 100; $i++) {
            // Generate a random integer that may be inside or outside range
            $value = random_int(-50, 150);
            $inRange = $value >= 1 && $value <= 100;

            $config = [
                'num_slots' => $value,
                'ssp_slots' => 0,
                'playlist_slots' => 0,
            ];

            if ($inRange) {
                $result = $this->validator->validate($config);
                $this->assertTrue(
                    $result['is_valid'],
                    "Property 1a (iter {$i}): num_slots={$value} is within [1,100] and should be accepted"
                );
            } else {
                try {
                    $this->validator->validate($config);
                    $this->fail(
                        "Property 1a (iter {$i}): num_slots={$value} is outside [1,100] and should be rejected"
                    );
                } catch (ValidationException $e) {
                    $this->assertArrayHasKey('num_slots', $e->errors());
                }
            }
        }
    }

    /**
     * Property 1b: ssp_slots accepts values within [0, num_slots] and rejects values outside.
     *
     * For any valid num_slots and any integer ssp_slots value, the validator accepts it
     * if and only if ssp_slots is within [0, num_slots].
     *
     * **Validates: Requirements 1.2**
     */
    public function test_ssp_slots_accepts_values_within_range_and_rejects_outside(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $numSlots = random_int(1, 100);
            // Generate ssp_slots that may be valid or invalid
            $sspSlots = random_int(-10, $numSlots + 10);
            $inRange = $sspSlots >= 0 && $sspSlots <= $numSlots;

            // Use playlist_slots=0 to avoid cross-field constraint interference
            $config = [
                'num_slots' => $numSlots,
                'ssp_slots' => $sspSlots,
                'playlist_slots' => 0,
            ];

            if ($inRange) {
                // ssp_slots is in range — should pass (ad_slots = num_slots - ssp_slots >= 1 when ssp_slots < num_slots)
                if ($sspSlots < $numSlots) {
                    $result = $this->validator->validate($config);
                    $this->assertTrue(
                        $result['is_valid'],
                        "Property 1b (iter {$i}): ssp_slots={$sspSlots} with num_slots={$numSlots} should be accepted"
                    );
                } else {
                    // ssp_slots == num_slots → ad_slots = 0 → rejected by cross-field constraint
                    // This is covered by Property 2, so we just verify it throws
                    try {
                        $this->validator->validate($config);
                        $this->fail(
                            "Property 1b (iter {$i}): ssp_slots={$sspSlots} == num_slots={$numSlots} → ad_slots=0, should be rejected"
                        );
                    } catch (ValidationException $e) {
                        // Expected: cross-field constraint rejects ad_slots < 1
                        $this->assertTrue(true);
                    }
                }
            } else {
                try {
                    $this->validator->validate($config);
                    $this->fail(
                        "Property 1b (iter {$i}): ssp_slots={$sspSlots} is outside [0, {$numSlots}] and should be rejected"
                    );
                } catch (ValidationException $e) {
                    $this->assertArrayHasKey('ssp_slots', $e->errors());
                }
            }
        }
    }

    /**
     * Property 1c: playlist_slots accepts values within [0, num_slots] and rejects values outside.
     *
     * For any valid num_slots and any integer playlist_slots value, the validator accepts it
     * if and only if playlist_slots is within [0, num_slots].
     *
     * **Validates: Requirements 1.3**
     */
    public function test_playlist_slots_accepts_values_within_range_and_rejects_outside(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $numSlots = random_int(1, 100);
            // Generate playlist_slots that may be valid or invalid
            $playlistSlots = random_int(-10, $numSlots + 10);
            $inRange = $playlistSlots >= 0 && $playlistSlots <= $numSlots;

            // Use ssp_slots=0 to avoid cross-field constraint interference
            $config = [
                'num_slots' => $numSlots,
                'ssp_slots' => 0,
                'playlist_slots' => $playlistSlots,
            ];

            if ($inRange) {
                if ($playlistSlots < $numSlots) {
                    $result = $this->validator->validate($config);
                    $this->assertTrue(
                        $result['is_valid'],
                        "Property 1c (iter {$i}): playlist_slots={$playlistSlots} with num_slots={$numSlots} should be accepted"
                    );
                } else {
                    // playlist_slots == num_slots → ad_slots = 0 → rejected by cross-field constraint
                    try {
                        $this->validator->validate($config);
                        $this->fail(
                            "Property 1c (iter {$i}): playlist_slots={$playlistSlots} == num_slots={$numSlots} → ad_slots=0, should be rejected"
                        );
                    } catch (ValidationException $e) {
                        $this->assertTrue(true);
                    }
                }
            } else {
                try {
                    $this->validator->validate($config);
                    $this->fail(
                        "Property 1c (iter {$i}): playlist_slots={$playlistSlots} is outside [0, {$numSlots}] and should be rejected"
                    );
                } catch (ValidationException $e) {
                    $this->assertArrayHasKey('playlist_slots', $e->errors());
                }
            }
        }
    }

    /**
     * Property 1d: sync_interval_seconds accepts values within [30, 900] and rejects outside.
     *
     * For any integer value, the validator accepts it as sync_interval_seconds if and only if
     * it is within [30, 900].
     *
     * **Validates: Requirements 8.1**
     */
    public function test_sync_interval_seconds_accepts_values_within_range_and_rejects_outside(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $value = random_int(-50, 1000);
            $inRange = $value >= 30 && $value <= 900;

            $config = [
                'num_slots' => 10,
                'ssp_slots' => 2,
                'playlist_slots' => 1,
                'sync_interval_seconds' => $value,
            ];

            if ($inRange) {
                $result = $this->validator->validate($config);
                $this->assertTrue(
                    $result['is_valid'],
                    "Property 1d (iter {$i}): sync_interval_seconds={$value} is within [30,900] and should be accepted"
                );
            } else {
                try {
                    $this->validator->validate($config);
                    $this->fail(
                        "Property 1d (iter {$i}): sync_interval_seconds={$value} is outside [30,900] and should be rejected"
                    );
                } catch (ValidationException $e) {
                    $this->assertArrayHasKey('sync_interval_seconds', $e->errors());
                }
            }
        }
    }

    /**
     * Property 1e: cache_flush_interval_hours accepts values within [1, 720] and rejects outside.
     *
     * For any integer value, the validator accepts it as cache_flush_interval_hours if and only if
     * it is within [1, 720].
     *
     * **Validates: Requirements 8.2**
     */
    public function test_cache_flush_interval_hours_accepts_values_within_range_and_rejects_outside(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $value = random_int(-50, 800);
            $inRange = $value >= 1 && $value <= 720;

            $config = [
                'num_slots' => 10,
                'ssp_slots' => 2,
                'playlist_slots' => 1,
                'cache_flush_interval_hours' => $value,
            ];

            if ($inRange) {
                $result = $this->validator->validate($config);
                $this->assertTrue(
                    $result['is_valid'],
                    "Property 1e (iter {$i}): cache_flush_interval_hours={$value} is within [1,720] and should be accepted"
                );
            } else {
                try {
                    $this->validator->validate($config);
                    $this->fail(
                        "Property 1e (iter {$i}): cache_flush_interval_hours={$value} is outside [1,720] and should be rejected"
                    );
                } catch (ValidationException $e) {
                    $this->assertArrayHasKey('cache_flush_interval_hours', $e->errors());
                }
            }
        }
    }

    // ─── Property 2: ad_slots invariant and minimum constraint ──────────────

    /**
     * Property 2a: ad_slots equals num_slots - ssp_slots - playlist_slots for valid configs.
     *
     * For any valid configuration (where ssp_slots + playlist_slots < num_slots),
     * ad_slots must be exactly num_slots - ssp_slots - playlist_slots.
     *
     * **Validates: Requirements 1.4**
     */
    public function test_ad_slots_equals_num_slots_minus_ssp_minus_playlist(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $numSlots = random_int(2, 100);
            // Ensure ssp_slots + playlist_slots < num_slots (at least 1 ad_slot)
            $maxReserved = $numSlots - 1;
            $sspSlots = random_int(0, $maxReserved);
            $playlistSlots = random_int(0, $maxReserved - $sspSlots);

            $config = [
                'num_slots' => $numSlots,
                'ssp_slots' => $sspSlots,
                'playlist_slots' => $playlistSlots,
            ];

            $result = $this->validator->validate($config);

            $expectedAdSlots = $numSlots - $sspSlots - $playlistSlots;

            $this->assertEquals(
                $expectedAdSlots,
                $result['ad_slots'],
                "Property 2a (iter {$i}): ad_slots should be {$numSlots} - {$sspSlots} - {$playlistSlots} = {$expectedAdSlots}, " .
                "got {$result['ad_slots']}"
            );
        }
    }

    /**
     * Property 2b: Configuration is rejected when ad_slots < 1.
     *
     * For any configuration where ssp_slots + playlist_slots >= num_slots,
     * the validator must reject it with a validation error.
     *
     * **Validates: Requirements 1.5**
     */
    public function test_rejects_config_when_ad_slots_less_than_one(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $numSlots = random_int(1, 100);
            // Generate ssp_slots and playlist_slots such that their sum >= num_slots
            $sspSlots = random_int(0, $numSlots);
            $playlistSlots = random_int($numSlots - $sspSlots, $numSlots);

            // Ensure the constraint is actually violated
            if ($sspSlots + $playlistSlots < $numSlots) {
                $playlistSlots = $numSlots - $sspSlots;
            }

            $config = [
                'num_slots' => $numSlots,
                'ssp_slots' => $sspSlots,
                'playlist_slots' => $playlistSlots,
            ];

            // Skip if individual field validations would fail first (ssp_slots > num_slots or playlist_slots > num_slots)
            if ($sspSlots > $numSlots || $playlistSlots > $numSlots) {
                continue;
            }

            try {
                $this->validator->validate($config);
                $this->fail(
                    "Property 2b (iter {$i}): Config with num_slots={$numSlots}, ssp_slots={$sspSlots}, " .
                    "playlist_slots={$playlistSlots} (ad_slots=" . ($numSlots - $sspSlots - $playlistSlots) .
                    ") should be rejected because ad_slots < 1"
                );
            } catch (ValidationException $e) {
                $errors = $e->errors();
                $this->assertArrayHasKey(
                    'num_slots',
                    $errors,
                    "Property 2b (iter {$i}): Error should reference num_slots for ad_slots constraint"
                );
                $this->assertStringContainsString(
                    'ad_slot',
                    $errors['num_slots'][0],
                    "Property 2b (iter {$i}): Error message should mention ad_slot"
                );
            }
        }
    }

    /**
     * Property 2c: calculateAdSlots helper always returns num_slots - ssp_slots - playlist_slots.
     *
     * For any triple of integers (num_slots, ssp_slots, playlist_slots),
     * calculateAdSlots must return the arithmetic difference.
     *
     * **Validates: Requirements 1.4**
     */
    public function test_calculate_ad_slots_is_arithmetic_difference(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $numSlots = random_int(1, 100);
            $sspSlots = random_int(0, $numSlots);
            $playlistSlots = random_int(0, $numSlots);

            $expected = $numSlots - $sspSlots - $playlistSlots;
            $actual = $this->validator->calculateAdSlots($numSlots, $sspSlots, $playlistSlots);

            $this->assertEquals(
                $expected,
                $actual,
                "Property 2c (iter {$i}): calculateAdSlots({$numSlots}, {$sspSlots}, {$playlistSlots}) " .
                "should be {$expected}, got {$actual}"
            );
        }
    }
}
