<?php

namespace Tests\Property;

use App\Models\Content;
use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use App\Services\CreativeSelector;
use App\Services\ManifestGenerator;
use Carbon\Carbon;
use Eris\Generators;
use Eris\TestTrait;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Property 2: ManifestGenerator inclusion logic
 *
 * For any screen, for any day `d`, and for any OrderLine targeting that screen:
 * the ManifestGenerator includes the OrderLine's creatives if and only if
 * (a) `active_dates` is null/empty and `starts_at <= d <= ends_at`, or
 * (b) `active_dates` is non-empty and `d` is present in `active_dates`.
 *
 * **Validates: Requirements 1.5, 2.1, 2.2, 2.3**
 */
class ManifestGeneratorInclusionPropertyTest extends TestCase
{
    use RefreshDatabase, TestTrait;

    private ManifestGenerator $generator;

    /**
     * Prevent seeding — Eris TestTrait's $seed property (random seed integer)
     * conflicts with Laravel's shouldSeed() which checks property_exists($this, 'seed').
     */
    protected function shouldSeed(): bool
    {
        return false;
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->generator = new ManifestGenerator(new CreativeSelector());
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow(); // Reset Carbon mock
        parent::tearDown();
    }

    /**
     * Property 2: ManifestGenerator includes creatives iff active_dates condition holds.
     *
     * Strategy:
     * - Generate an active_dates mode: null, empty array, or populated array
     * - Generate a "today" date offset relative to the OrderLine range
     * - Create all required DB entities
     * - Set Carbon::setTestNow to the generated date
     * - Call ManifestGenerator::generate and verify inclusion/exclusion
     *
     * **Validates: Requirements 1.5, 2.1, 2.2, 2.3**
     */
    public function test_manifest_includes_creatives_iff_active_dates_condition_holds(): void
    {
        $this->limitTo(5)->forAll(
            Generators::elements('null', 'empty', 'populated'), // active_dates mode
            Generators::choose(-5, 25), // today offset from OrderLine starts_at (range is 0..20)
            Generators::choose(0, 20),  // offset for a date in active_dates list (within range)
            Generators::elements(true, false) // whether today is in the active_dates list (when populated)
        )->then(function (string $activeDatesMode, int $todayOffset, int $activeDateOffset, bool $todayInList): void {
            // OrderLine range: 2025-02-01 to 2025-02-21 (21 days)
            $olStartsAt = '2025-02-01';
            $olEndsAt = '2025-02-21';

            // Compute the "today" date
            $today = Carbon::parse($olStartsAt)->addDays($todayOffset);
            $todayStr = $today->toDateString();

            // Build active_dates based on mode
            $activeDates = null;
            switch ($activeDatesMode) {
                case 'null':
                    $activeDates = null;
                    break;
                case 'empty':
                    $activeDates = [];
                    break;
                case 'populated':
                    // Generate a list of 1-3 dates within the range
                    $baseDateForList = Carbon::parse($olStartsAt);
                    $activeDates = [
                        $baseDateForList->copy()->addDays($activeDateOffset)->toDateString(),
                    ];
                    // If today should be in the list, add it; otherwise ensure it's not
                    if ($todayInList) {
                        $activeDates[] = $todayStr;
                    } else {
                        // Remove today from the list if it ended up there
                        $activeDates = array_values(array_filter($activeDates, fn($d) => $d !== $todayStr));
                        // Ensure list is non-empty (add a date that isn't today)
                        if (empty($activeDates)) {
                            $fallbackDate = Carbon::parse($olStartsAt)->addDays(($activeDateOffset + 1) % 21)->toDateString();
                            if ($fallbackDate === $todayStr) {
                                $fallbackDate = Carbon::parse($olStartsAt)->addDays(($activeDateOffset + 2) % 21)->toDateString();
                            }
                            $activeDates = [$fallbackDate];
                        }
                    }
                    $activeDates = array_values(array_unique($activeDates));
                    break;
            }

            // Determine expected inclusion
            $inRange = $todayStr >= $olStartsAt && $todayStr <= $olEndsAt;
            if ($activeDatesMode === 'null' || $activeDatesMode === 'empty') {
                // (a) active_dates is null/empty: include iff starts_at <= d <= ends_at
                $shouldInclude = $inRange;
            } else {
                // (b) active_dates is non-empty: include iff d is in active_dates
                $shouldInclude = in_array($todayStr, $activeDates, true);
            }

            // Set Carbon to the generated "today"
            Carbon::setTestNow($today);

            // Create DB entities
            $tenant = Tenant::factory()->create();
            $group = ScreenGroup::factory()->create(['tenant_id' => $tenant->id]);
            $screen = Screen::factory()->create([
                'tenant_id' => $tenant->id,
                'group_id' => $group->id,
            ]);

            $order = Order::factory()->create([
                'tenant_id' => $tenant->id,
                'status' => 'active',
                'starts_at' => '2025-01-01',
                'ends_at' => '2025-12-31',
            ]);

            // Create OrderLine without events to avoid observer validation on active_dates
            $orderLine = OrderLine::withoutEvents(function () use ($order, $olStartsAt, $olEndsAt, $activeDates) {
                return OrderLine::factory()->create([
                    'order_id' => $order->id,
                    'starts_at' => $olStartsAt,
                    'ends_at' => $olEndsAt,
                    'active_dates' => $activeDates,
                    'status' => 'active',
                ]);
            });

            // Create target linking this order line to the screen
            $target = OrderLineTarget::factory()->create([
                'order_line_id' => $orderLine->id,
                'screen_id' => $screen->id,
                'screen_group_id' => null,
            ]);

            // Create a creative for this target
            $content = Content::factory()->create(['tenant_id' => $tenant->id]);
            $creative = Creative::factory()->create([
                'order_line_target_id' => $target->id,
                'order_line_id' => $orderLine->id,
                'content_id' => $content->id,
                'weight' => 1,
            ]);

            // Build sequence with one entry for this order line
            $sequence = [
                ['position' => 0, 'order_line_id' => $orderLine->id],
            ];

            // Generate manifest
            $manifest = $this->generator->generate($screen, $sequence, 0, 0);
            $items = $manifest->items;

            // Check inclusion: creative should appear iff shouldInclude is true
            $creativeIds = collect($items)
                ->where('type', 'order_line_creative')
                ->pluck('creative_id')
                ->toArray();

            if ($shouldInclude) {
                $this->assertContains(
                    $creative->id,
                    $creativeIds,
                    sprintf(
                        'Property 2: Creative SHOULD be included. Mode=%s, today=%s, range=[%s,%s], active_dates=%s',
                        $activeDatesMode,
                        $todayStr,
                        $olStartsAt,
                        $olEndsAt,
                        json_encode($activeDates)
                    )
                );
            } else {
                $this->assertNotContains(
                    $creative->id,
                    $creativeIds,
                    sprintf(
                        'Property 2: Creative should NOT be included. Mode=%s, today=%s, range=[%s,%s], active_dates=%s',
                        $activeDatesMode,
                        $todayStr,
                        $olStartsAt,
                        $olEndsAt,
                        json_encode($activeDates)
                    )
                );
            }

            // Cleanup
            Creative::withoutGlobalScopes()->delete();
            OrderLineTarget::query()->delete();
            Screen::withoutGlobalScopes()->delete();
            Content::withoutGlobalScopes()->delete();
            OrderLine::query()->delete();
            Order::query()->delete();
            Tenant::query()->delete();
        });
    }
}
