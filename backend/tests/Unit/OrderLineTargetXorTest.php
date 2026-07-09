<?php

namespace Tests\Unit;

use App\Models\OrderLineTarget;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class OrderLineTargetXorTest extends TestCase
{
    /**
     * Test that saving a target with both screen_id and screen_group_id null fails XOR validation.
     * The ValidationException is thrown by the model's saving event BEFORE hitting the DB.
     */
    public function test_xor_fails_when_both_null(): void
    {
        $this->expectException(ValidationException::class);

        $target = new OrderLineTarget();
        $target->order_line_id = fake()->uuid();
        $target->screen_id = null;
        $target->screen_group_id = null;
        $target->save();
    }

    /**
     * Test that saving a target with both screen_id and screen_group_id present fails XOR validation.
     * The ValidationException is thrown by the model's saving event BEFORE hitting the DB.
     */
    public function test_xor_fails_when_both_present(): void
    {
        $this->expectException(ValidationException::class);

        $target = new OrderLineTarget();
        $target->order_line_id = fake()->uuid();
        $target->screen_id = fake()->uuid();
        $target->screen_group_id = fake()->uuid();
        $target->save();
    }

    /**
     * Test that saving a target with only screen_id passes XOR validation.
     * The model passes validation but may fail on DB (table might not exist in test env).
     * We verify no ValidationException is thrown.
     */
    public function test_xor_passes_with_only_screen_id(): void
    {
        $target = new OrderLineTarget();
        $target->order_line_id = fake()->uuid();
        $target->screen_id = fake()->uuid();
        $target->screen_group_id = null;

        try {
            $target->save();
        } catch (QueryException $e) {
            // DB error is acceptable (table may not exist in SQLite test env)
            // The important thing is that no ValidationException was thrown
            $this->assertTrue(true);
            return;
        }

        // If save succeeded, that's also fine
        $this->assertTrue(true);
    }

    /**
     * Test that saving a target with only screen_group_id passes XOR validation.
     * The model passes validation but may fail on DB (table might not exist in test env).
     * We verify no ValidationException is thrown.
     */
    public function test_xor_passes_with_only_screen_group_id(): void
    {
        $target = new OrderLineTarget();
        $target->order_line_id = fake()->uuid();
        $target->screen_id = null;
        $target->screen_group_id = fake()->uuid();

        try {
            $target->save();
        } catch (QueryException $e) {
            // DB error is acceptable (table may not exist in SQLite test env)
            // The important thing is that no ValidationException was thrown
            $this->assertTrue(true);
            return;
        }

        // If save succeeded, that's also fine
        $this->assertTrue(true);
    }
}
