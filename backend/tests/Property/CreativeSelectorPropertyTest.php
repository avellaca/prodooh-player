<?php

namespace Tests\Property;

use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\Tenant;
use App\Services\CreativeSelector;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Tests\TestCase;

/**
 * Feature: 06-player-reingenieria-motor, Property 13: Creative selection anti-repetition
 *
 * Property 13: Creative selection anti-repetition — nunca mismo creativo consecutivo;
 * ventana de `min(N-1, 5)` cuando N > 5
 *
 * **Validates: Requirements 5.2, 5.3**
 */
class CreativeSelectorPropertyTest extends TestCase
{
    use RefreshDatabase;

    private CreativeSelector $selector;

    protected function setUp(): void
    {
        parent::setUp();
        $this->selector = new CreativeSelector();
    }

    /**
     * Property 13: Creative selection anti-repetition
     *
     * For any pool with N > 1 active creatives (N between 2 and 10),
     * running the selector in a loop for 100+ turns while maintaining history:
     * - The selected creative is NEVER the same as the immediately previous selection
     * - If N <= 5: the selected creative is NOT in the last N-1 selections
     * - If N > 5: the selected creative is NOT in the last min(N-1, 5) = 5 selections
     *
     * We run 50+ different random configurations (pool sizes and weights).
     *
     * **Validates: Requirements 5.2, 5.3**
     */
    public function test_creative_selection_anti_repetition_property(): void
    {
        $today = Carbon::today()->toDateString();
        $iterations = 50; // 50 different random configurations

        for ($config = 0; $config < $iterations; $config++) {
            // Generate random pool size N between 2 and 10
            $poolSize = random_int(2, 10);

            // Create an OrderLine with N creatives (all active today, various weights)
            $tenant = Tenant::factory()->create();
            $order = Order::factory()->create([
                'tenant_id' => $tenant->id,
                'status' => 'active',
            ]);
            $line = OrderLine::factory()->create([
                'order_id' => $order->id,
                'status' => 'active',
            ]);

            $pool = collect();
            for ($i = 0; $i < $poolSize; $i++) {
                $creative = Creative::factory()->create([
                    'order_line_id' => $line->id,
                    'weight' => random_int(1, 20),
                ]);
                $pool->push($creative);
            }

            $creativeIds = $pool->pluck('id')->toArray();

            // Calculate the expected anti-repetition window
            $windowSize = min($poolSize - 1, 5);

            // Run the selector for 100+ turns maintaining history
            $history = [];
            $turns = 100;

            for ($turn = 0; $turn < $turns; $turn++) {
                $selected = $this->selector->select($pool, $history);

                // Assert: never the same as immediately previous (Requirement 5.2)
                if (count($history) > 0) {
                    $this->assertNotEquals(
                        $history[0],
                        $selected->id,
                        "Config #{$config} (poolSize={$poolSize}), turn {$turn}: " .
                        "Selected creative must NOT be the same as the immediately previous selection. " .
                        "History (most recent first): [" . implode(', ', array_slice($history, 0, $windowSize)) . "]"
                    );
                }

                // Assert: not in the anti-repetition window (Requirements 5.2, 5.3)
                // Window is min(N-1, 5)
                $windowHistory = array_slice($history, 0, $windowSize);
                $this->assertNotContains(
                    $selected->id,
                    $windowHistory,
                    "Config #{$config} (poolSize={$poolSize}, windowSize={$windowSize}), turn {$turn}: " .
                    "Selected creative must NOT appear in the last {$windowSize} selections. " .
                    "Selected: {$selected->id}, Window: [" . implode(', ', $windowHistory) . "]"
                );

                // Prepend selected to history (most recent first)
                array_unshift($history, $selected->id);
            }
        }
    }
}
