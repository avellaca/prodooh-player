<?php

namespace Tests\Property;

use Eris\Generators;
use Eris\TestTrait;
use PHPUnit\Framework\TestCase;

class ExamplePropertyTest extends TestCase
{
    use TestTrait;

    /**
     * Verify Eris property-based testing works correctly.
     * Property: string concatenation length equals sum of individual lengths.
     */
    public function test_string_concatenation_length_property(): void
    {
        $this->forAll(
            Generators::string(),
            Generators::string()
        )->then(function (string $a, string $b): void {
            $this->assertEquals(
                strlen($a) + strlen($b),
                strlen($a . $b),
                'Concatenation length must equal sum of parts'
            );
        });
    }
}
