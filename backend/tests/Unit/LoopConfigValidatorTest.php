<?php

namespace Tests\Unit;

use App\Services\LoopConfigValidator;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class LoopConfigValidatorTest extends TestCase
{
    private LoopConfigValidator $validator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->validator = new LoopConfigValidator();
    }

    // ─── Valid configurations ───────────────────────────────────────────────

    public function test_valid_default_config_passes(): void
    {
        $result = $this->validator->validate([
            'num_slots' => 10,
            'ssp_slots' => 2,
            'playlist_slots' => 1,
        ]);

        $this->assertTrue($result['is_valid']);
        $this->assertEmpty($result['errors']);
        $this->assertEquals(7, $result['ad_slots']);
    }

    public function test_valid_config_with_all_optional_fields(): void
    {
        $result = $this->validator->validate([
            'num_slots' => 20,
            'ssp_slots' => 5,
            'playlist_slots' => 3,
            'sync_interval_seconds' => 120,
            'cache_flush_interval_hours' => 48,
        ]);

        $this->assertTrue($result['is_valid']);
        $this->assertEquals(12, $result['ad_slots']);
    }

    public function test_minimum_valid_config(): void
    {
        $result = $this->validator->validate([
            'num_slots' => 1,
            'ssp_slots' => 0,
            'playlist_slots' => 0,
        ]);

        $this->assertTrue($result['is_valid']);
        $this->assertEquals(1, $result['ad_slots']);
    }

    public function test_maximum_valid_config(): void
    {
        $result = $this->validator->validate([
            'num_slots' => 100,
            'ssp_slots' => 50,
            'playlist_slots' => 49,
        ]);

        $this->assertTrue($result['is_valid']);
        $this->assertEquals(1, $result['ad_slots']);
    }

    public function test_boundary_sync_interval(): void
    {
        $result = $this->validator->validate([
            'num_slots' => 10,
            'ssp_slots' => 2,
            'playlist_slots' => 1,
            'sync_interval_seconds' => 30,
        ]);

        $this->assertTrue($result['is_valid']);

        $result = $this->validator->validate([
            'num_slots' => 10,
            'ssp_slots' => 2,
            'playlist_slots' => 1,
            'sync_interval_seconds' => 900,
        ]);

        $this->assertTrue($result['is_valid']);
    }

    public function test_boundary_cache_flush_interval(): void
    {
        $result = $this->validator->validate([
            'num_slots' => 10,
            'ssp_slots' => 2,
            'playlist_slots' => 1,
            'cache_flush_interval_hours' => 1,
        ]);

        $this->assertTrue($result['is_valid']);

        $result = $this->validator->validate([
            'num_slots' => 10,
            'ssp_slots' => 2,
            'playlist_slots' => 1,
            'cache_flush_interval_hours' => 720,
        ]);

        $this->assertTrue($result['is_valid']);
    }

    // ─── num_slots validation ───────────────────────────────────────────────

    public function test_rejects_num_slots_below_minimum(): void
    {
        $this->expectException(ValidationException::class);

        $this->validator->validate([
            'num_slots' => 0,
            'ssp_slots' => 0,
            'playlist_slots' => 0,
        ]);
    }

    public function test_rejects_num_slots_above_maximum(): void
    {
        $this->expectException(ValidationException::class);

        $this->validator->validate([
            'num_slots' => 101,
            'ssp_slots' => 0,
            'playlist_slots' => 0,
        ]);
    }

    public function test_rejects_missing_num_slots(): void
    {
        $this->expectException(ValidationException::class);

        $this->validator->validate([
            'ssp_slots' => 2,
            'playlist_slots' => 1,
        ]);
    }

    public function test_rejects_non_integer_num_slots(): void
    {
        $this->expectException(ValidationException::class);

        $this->validator->validate([
            'num_slots' => 'ten',
            'ssp_slots' => 2,
            'playlist_slots' => 1,
        ]);
    }

    // ─── ssp_slots validation ───────────────────────────────────────────────

    public function test_rejects_ssp_slots_below_minimum(): void
    {
        $this->expectException(ValidationException::class);

        $this->validator->validate([
            'num_slots' => 10,
            'ssp_slots' => -1,
            'playlist_slots' => 1,
        ]);
    }

    public function test_rejects_ssp_slots_above_num_slots(): void
    {
        $this->expectException(ValidationException::class);

        $this->validator->validate([
            'num_slots' => 10,
            'ssp_slots' => 11,
            'playlist_slots' => 1,
        ]);
    }

    public function test_rejects_missing_ssp_slots(): void
    {
        $this->expectException(ValidationException::class);

        $this->validator->validate([
            'num_slots' => 10,
            'playlist_slots' => 1,
        ]);
    }

    // ─── playlist_slots validation ──────────────────────────────────────────

    public function test_rejects_playlist_slots_below_minimum(): void
    {
        $this->expectException(ValidationException::class);

        $this->validator->validate([
            'num_slots' => 10,
            'ssp_slots' => 2,
            'playlist_slots' => -1,
        ]);
    }

    public function test_rejects_playlist_slots_above_num_slots(): void
    {
        $this->expectException(ValidationException::class);

        $this->validator->validate([
            'num_slots' => 10,
            'ssp_slots' => 2,
            'playlist_slots' => 11,
        ]);
    }

    public function test_rejects_missing_playlist_slots(): void
    {
        $this->expectException(ValidationException::class);

        $this->validator->validate([
            'num_slots' => 10,
            'ssp_slots' => 2,
        ]);
    }

    // ─── sync_interval_seconds validation ───────────────────────────────────

    public function test_rejects_sync_interval_below_minimum(): void
    {
        $this->expectException(ValidationException::class);

        $this->validator->validate([
            'num_slots' => 10,
            'ssp_slots' => 2,
            'playlist_slots' => 1,
            'sync_interval_seconds' => 29,
        ]);
    }

    public function test_rejects_sync_interval_above_maximum(): void
    {
        $this->expectException(ValidationException::class);

        $this->validator->validate([
            'num_slots' => 10,
            'ssp_slots' => 2,
            'playlist_slots' => 1,
            'sync_interval_seconds' => 901,
        ]);
    }

    // ─── cache_flush_interval_hours validation ──────────────────────────────

    public function test_rejects_cache_flush_below_minimum(): void
    {
        $this->expectException(ValidationException::class);

        $this->validator->validate([
            'num_slots' => 10,
            'ssp_slots' => 2,
            'playlist_slots' => 1,
            'cache_flush_interval_hours' => 0,
        ]);
    }

    public function test_rejects_cache_flush_above_maximum(): void
    {
        $this->expectException(ValidationException::class);

        $this->validator->validate([
            'num_slots' => 10,
            'ssp_slots' => 2,
            'playlist_slots' => 1,
            'cache_flush_interval_hours' => 721,
        ]);
    }

    // ─── Cross-field constraint: at least 1 ad_slot ─────────────────────────

    public function test_rejects_when_ssp_plus_playlist_equals_num_slots(): void
    {
        $this->expectException(ValidationException::class);

        $this->validator->validate([
            'num_slots' => 10,
            'ssp_slots' => 5,
            'playlist_slots' => 5,
        ]);
    }

    public function test_rejects_when_ssp_plus_playlist_exceeds_num_slots(): void
    {
        $this->expectException(ValidationException::class);

        $this->validator->validate([
            'num_slots' => 10,
            'ssp_slots' => 6,
            'playlist_slots' => 5,
        ]);
    }

    public function test_error_message_mentions_ad_slot(): void
    {
        try {
            $this->validator->validate([
                'num_slots' => 10,
                'ssp_slots' => 5,
                'playlist_slots' => 5,
            ]);
            $this->fail('Expected ValidationException');
        } catch (ValidationException $e) {
            $errors = $e->errors();
            $this->assertArrayHasKey('num_slots', $errors);
            $this->assertStringContainsString('ad_slot', $errors['num_slots'][0]);
        }
    }

    // ─── calculateAdSlots helper ────────────────────────────────────────────

    public function test_calculate_ad_slots(): void
    {
        $this->assertEquals(7, $this->validator->calculateAdSlots(10, 2, 1));
        $this->assertEquals(1, $this->validator->calculateAdSlots(100, 50, 49));
        $this->assertEquals(1, $this->validator->calculateAdSlots(1, 0, 0));
        $this->assertEquals(50, $this->validator->calculateAdSlots(100, 25, 25));
    }
}
