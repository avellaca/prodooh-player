<?php

namespace Tests\Property;

use Eris\Generators;
use Eris\TestTrait;
use Illuminate\Support\Facades\Validator;
use Tests\TestCase;

/**
 * Property 5: OrderLine active_dates format validation
 *
 * For any array of strings submitted as `active_dates`, the OrderLineController
 * SHALL accept the request if and only if every string matches the format
 * YYYY-MM-DD (or the array is null/empty).
 *
 * **Validates: Requirements 1.2, 3.4**
 */
class OrderLineActiveDatesFormatPropertyTest extends TestCase
{
    use TestTrait;

    /**
     * The validation rules applied by OrderLineController for active_dates.
     */
    private function validationRules(): array
    {
        return [
            'active_dates' => ['nullable', 'array'],
            'active_dates.*' => ['required', 'string', 'date_format:Y-m-d'],
        ];
    }

    /**
     * Property 5: Valid YYYY-MM-DD arrays pass validation.
     *
     * Generate arrays of valid date strings in YYYY-MM-DD format and verify
     * that the validator accepts them.
     *
     * **Validates: Requirements 1.2, 3.4**
     */
    public function test_valid_date_format_arrays_pass_validation(): void
    {
        $this->limitTo(5)->forAll(
            Generators::choose(1, 5),    // number of dates
            Generators::choose(2020, 2030), // year
            Generators::choose(1, 12),   // month
            Generators::choose(1, 28)    // day (use 28 to avoid invalid day-of-month)
        )->then(function (int $numDates, int $year, int $month, int $day): void {
            $dates = [];
            for ($i = 0; $i < $numDates; $i++) {
                // Vary the day slightly for each date in the array
                $d = min(28, $day + $i);
                $dates[] = sprintf('%04d-%02d-%02d', $year, $month, $d);
            }

            $validator = Validator::make(
                ['active_dates' => $dates],
                $this->validationRules()
            );

            $this->assertFalse(
                $validator->fails(),
                sprintf(
                    'Property 5: Valid dates %s should pass validation but failed with: %s',
                    json_encode($dates),
                    json_encode($validator->errors()->toArray())
                )
            );
        });
    }

    /**
     * Property 5: Null active_dates passes validation.
     *
     * **Validates: Requirements 1.2, 3.4**
     */
    public function test_null_active_dates_passes_validation(): void
    {
        $validator = Validator::make(
            ['active_dates' => null],
            $this->validationRules()
        );

        $this->assertFalse(
            $validator->fails(),
            'Property 5: null active_dates should pass validation'
        );
    }

    /**
     * Property 5: Empty array active_dates passes validation.
     *
     * **Validates: Requirements 1.2, 3.4**
     */
    public function test_empty_array_active_dates_passes_validation(): void
    {
        $validator = Validator::make(
            ['active_dates' => []],
            $this->validationRules()
        );

        $this->assertFalse(
            $validator->fails(),
            'Property 5: empty array active_dates should pass validation'
        );
    }

    /**
     * Property 5: Invalid format strings fail validation.
     *
     * Generate arrays containing strings that do NOT match YYYY-MM-DD format
     * and verify that the validator rejects them.
     *
     * **Validates: Requirements 1.2, 3.4**
     */
    public function test_invalid_format_strings_fail_validation(): void
    {
        $this->limitTo(5)->forAll(
            Generators::elements(
                'not-a-date',
                '2025/01/15',
                '01-15-2025',
                '15-01-2025',
                '2025-1-5',
                '2025-13-01',
                '2025-00-15',
                '20250115',
                '2025-01-32',
                'abcd-ef-gh',
                ''
            ),
            Generators::choose(0, 2) // number of valid dates to include alongside the invalid one
        )->then(function (string $invalidDate, int $validCount): void {
            $dates = [];

            // Add some valid dates
            for ($i = 0; $i < $validCount; $i++) {
                $dates[] = sprintf('2025-01-%02d', $i + 1);
            }

            // Add the invalid date
            $dates[] = $invalidDate;

            // Shuffle to ensure position doesn't matter
            shuffle($dates);

            $validator = Validator::make(
                ['active_dates' => $dates],
                $this->validationRules()
            );

            $this->assertTrue(
                $validator->fails(),
                sprintf(
                    'Property 5: Array containing invalid date "%s" (full: %s) should FAIL validation but passed',
                    $invalidDate,
                    json_encode($dates)
                )
            );
        });
    }
}
