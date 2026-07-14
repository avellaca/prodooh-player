<?php

namespace App\Services;

use App\Models\Impression;
use App\Models\OrderLine;
use App\Models\Screen;
use Carbon\Carbon;
use Illuminate\Support\Collection;

class PriorityEngine implements PriorityEngineInterface
{
    /**
     * Global default duration in seconds when no group or tenant duration is configured.
     */
    private const DEFAULT_DURATION_SECONDS = 10;

    /**
     * Full 24/7 operating window in seconds (24h × 60m × 60s).
     */
    private const FULL_DAY_SECONDS = 86400;

    /**
     * Priority tier processing order for the waterfall.
     */
    private const TIER_ORDER = ['patrocinio', 'estandar', 'red_interna'];

    private BresenhamInterleaverInterface $interleaver;

    /** The screen currently being recalculated (used by calculateDailyBudget per-screen) */
    private ?string $currentScreenId = null;

    public function __construct(BresenhamInterleaverInterface $interleaver)
    {
        $this->interleaver = $interleaver;
    }

    /**
     * Recalculate the manifest for a screen.
     *
     * Orchestrates: capacity → filter lines → waterfall → interleave → generate manifest.
     */
    public function recalculate(string $screenId, bool $isIntraDay = false): array
    {
        $this->currentScreenId = $screenId;
        $screen = Screen::withoutGlobalScopes()->with(['screenGroup.tenant', 'impressions'])->findOrFail($screenId);

        // Step 1: Calculate capacity
        $totalDailySpots = $this->calculateTotalDailySpots($screen);

        if ($isIntraDay) {
            $impressionsToday = Impression::where('screen_id', $screen->id)
                ->where('result', 'success')
                ->whereDate('started_at', Carbon::today())
                ->count();

            $capacity = max(0, $totalDailySpots - $impressionsToday);
        } else {
            $capacity = $totalDailySpots;
        }

        // Step 2: Filter active lines
        $activeLines = $this->filterActiveLines($screen);

        // Step 3: Run waterfall
        $waterfallResult = $this->runWaterfall($activeLines, $capacity);

        // Step 4: Interleave allocations using Bresenham
        $allocations = $waterfallResult['allocations'];
        $sequence = [];

        $nonZeroAllocations = array_filter($allocations, fn($a) => $a['count'] > 0);

        if (!empty($nonZeroAllocations)) {
            $totalAllocated = array_sum(array_column($nonZeroAllocations, 'count'));
            $sequence = $this->interleaver->interleave(array_values($nonZeroAllocations), $totalAllocated);
        }

        return [
            'screen_id' => $screenId,
            'total_daily_spots' => $totalDailySpots,
            'capacity' => $capacity,
            'allocations' => $waterfallResult['allocations'],
            'ssp_slots' => $waterfallResult['ssp_slots'],
            'playlist_slots' => $waterfallResult['playlist_slots'],
            'sequence' => $sequence,
        ];
    }

    /**
     * Run the waterfall allocation algorithm.
     *
     * Processes priority tiers in strict order: patrocinio → estandar → red_interna.
     * After red_interna, remaining capacity is split 50/50 between SSP and playlist.
     *
     * @param Collection<int, OrderLine> $lines Active order lines for this screen
     * @param int $capacity Total available spots to distribute
     * @return array{allocations: array, ssp_slots: int, playlist_slots: int}
     */
    public function runWaterfall(Collection $lines, int $capacity): array
    {
        // Case: no active lines → 100% playlist
        if ($lines->isEmpty()) {
            return [
                'allocations' => [],
                'ssp_slots' => 0,
                'playlist_slots' => $capacity,
            ];
        }

        // Group lines by priority_tier
        $grouped = $lines->groupBy('priority_tier');
        $remaining = $capacity;
        $allAllocations = [];

        // Process each tier in strict waterfall order
        foreach (self::TIER_ORDER as $tier) {
            $tierLines = $grouped->get($tier, collect());

            if ($tierLines->isEmpty()) {
                continue;
            }

            $result = $this->allocateLevel($tierLines, $remaining);
            $allAllocations = array_merge($allAllocations, $result['allocations']);
            $remaining = $result['remaining'];
        }

        // After all tiers, split remainder between SSP and playlist
        $remainder = $this->allocateRemainder($remaining);

        return [
            'allocations' => $allAllocations,
            'ssp_slots' => $remainder['ssp_slots'],
            'playlist_slots' => $remainder['playlist_slots'],
        ];
    }

    /**
     * Allocate capacity to a single priority level.
     *
     * If total demand ≤ remaining capacity → each line gets its exact daily_budget.
     * If total demand > remaining capacity → proportional allocation by share_weight.
     * Lines with null budget (unlimited) get proportional share after fixed-budget lines.
     *
     * @param Collection<int, OrderLine> $lines Lines in this tier
     * @param int $remainingCapacity Available capacity for this level
     * @return array{allocations: array, remaining: int}
     */
    public function allocateLevel(Collection $lines, int $remainingCapacity): array
    {
        if ($lines->isEmpty() || $remainingCapacity <= 0) {
            return [
                'allocations' => [],
                'remaining' => $remainingCapacity,
            ];
        }

        // Calculate daily_budget for each line (per-screen)
        $lineData = [];
        foreach ($lines as $line) {
            $budget = $this->calculateDailyBudget($line, $this->currentScreenId);
            $lineData[] = [
                'line' => $line,
                'budget' => $budget, // null means unlimited
                'share_weight' => $line->share_weight ?? 1,
            ];
        }

        // Separate fixed-budget lines from unlimited (null) lines
        $fixedLines = array_filter($lineData, fn($d) => !is_null($d['budget']));
        $unlimitedLines = array_filter($lineData, fn($d) => is_null($d['budget']));

        $totalFixedDemand = array_sum(array_column($fixedLines, 'budget'));

        // Case 1: All lines have fixed budgets
        if (empty($unlimitedLines)) {
            if ($totalFixedDemand <= $remainingCapacity) {
                // Under-capacity: each line gets its exact budget
                $allocations = [];
                $allocated = 0;
                foreach ($fixedLines as $data) {
                    $count = $data['budget'];
                    $allocations[] = [
                        'order_line_id' => $data['line']->id,
                        'count' => $count,
                    ];
                    $allocated += $count;
                }

                return [
                    'allocations' => $allocations,
                    'remaining' => $remainingCapacity - $allocated,
                ];
            } else {
                // Over-capacity: allocate respecting individual budgets as caps
                // Lines with pace=asap can absorb excess; uniform lines cap at their budget
                return $this->allocateWithCaps($fixedLines, $remainingCapacity);
            }
        }

        // Case 2: Mixed fixed + unlimited lines
        // First, serve fixed-budget lines up to remaining capacity
        if ($totalFixedDemand <= $remainingCapacity) {
            // Fixed lines get their exact budget
            $allocations = [];
            $allocated = 0;
            foreach ($fixedLines as $data) {
                $allocations[] = [
                    'order_line_id' => $data['line']->id,
                    'count' => $data['budget'],
                ];
                $allocated += $data['budget'];
            }

            // Unlimited lines share the remaining capacity proportionally
            $capacityForUnlimited = $remainingCapacity - $allocated;
            if ($capacityForUnlimited > 0 && !empty($unlimitedLines)) {
                $unlimitedAllocations = $this->allocateProportional($unlimitedLines, $capacityForUnlimited);
                $allocations = array_merge($allocations, $unlimitedAllocations['allocations']);
                $allocated += ($capacityForUnlimited - $unlimitedAllocations['remaining']);
            }

            return [
                'allocations' => $allocations,
                'remaining' => $remainingCapacity - $allocated,
            ];
        } else {
            // Over-capacity even for fixed lines → all lines compete proportionally
            $allLineData = array_merge($fixedLines, $unlimitedLines);

            return $this->allocateProportional($allLineData, $remainingCapacity);
        }
    }

    /**
     * Allocate remaining capacity after all order lines have been served.
     *
     * Splits evenly between SSP and playlist slots:
     * - ssp_slots = floor(remaining / 2)
     * - playlist_slots = remaining - ssp_slots (ceil for odd)
     *
     * @param int $remaining Capacity remaining after red_interna
     * @return array{ssp_slots: int, playlist_slots: int}
     */
    public function allocateRemainder(int $remaining): array
    {
        if ($remaining <= 0) {
            return [
                'ssp_slots' => 0,
                'playlist_slots' => 0,
            ];
        }

        $sspSlots = (int) floor($remaining / 2);
        $playlistSlots = $remaining - $sspSlots;

        return [
            'ssp_slots' => $sspSlots,
            'playlist_slots' => $playlistSlots,
        ];
    }

    /**
     * Allocate capacity proportionally by share_weight.
     *
     * Each line gets: floor(capacity × line_share_weight / total_share_weight).
     * Any rounding remainder is left unallocated (goes to next level or remainder).
     *
     * @param array $lineData Array of ['line' => OrderLine, 'budget' => ?int, 'share_weight' => int]
     * @param int $capacity Available capacity to distribute
     * @return array{allocations: array, remaining: int}
     */
    private function allocateProportional(array $lineData, int $capacity): array
    {
        $totalWeight = array_sum(array_column($lineData, 'share_weight'));

        if ($totalWeight <= 0) {
            // Edge case: no weight defined, distribute equally
            $perLine = (int) floor($capacity / count($lineData));
            $allocations = [];
            $allocated = 0;
            foreach ($lineData as $data) {
                $allocations[] = [
                    'order_line_id' => $data['line']->id,
                    'count' => $perLine,
                ];
                $allocated += $perLine;
            }

            return [
                'allocations' => $allocations,
                'remaining' => $capacity - $allocated,
            ];
        }

        $allocations = [];
        $allocated = 0;
        foreach ($lineData as $data) {
            $count = (int) floor($capacity * $data['share_weight'] / $totalWeight);
            $allocations[] = [
                'order_line_id' => $data['line']->id,
                'count' => $count,
            ];
            $allocated += $count;
        }

        return [
            'allocations' => $allocations,
            'remaining' => $capacity - $allocated,
        ];
    }

    /**
     * Allocate spots respecting each line's budget as a cap.
     *
     * Lines with pace=uniform get at most their daily budget.
     * Lines with pace=asap can absorb any remaining excess.
     * This prevents uniform lines from getting more than contracted while
     * allowing ASAP lines to fill remaining capacity.
     */
    private function allocateWithCaps(array $lineData, int $capacity): array
    {
        $allocations = [];
        $remaining = $capacity;

        // First pass: give each uniform line its budget (capped)
        $asapLines = [];
        $allocated = 0;

        foreach ($lineData as $data) {
            if ($data['line']->delivery_pace === 'asap') {
                $asapLines[] = $data;
            } else {
                // Uniform: cap at budget
                $count = min($data['budget'], $remaining);
                $allocations[] = [
                    'order_line_id' => $data['line']->id,
                    'count' => $count,
                ];
                $remaining -= $count;
                $allocated += $count;
            }
        }

        // Second pass: ASAP lines share the remaining capacity
        if (!empty($asapLines) && $remaining > 0) {
            $totalAsapWeight = array_sum(array_column($asapLines, 'share_weight'));
            foreach ($asapLines as $data) {
                $share = $totalAsapWeight > 0
                    ? (int) floor($remaining * $data['share_weight'] / $totalAsapWeight)
                    : (int) floor($remaining / count($asapLines));
                // Cap at their budget too (asap budget = remaining target)
                $count = min($share, $data['budget']);
                $allocations[] = [
                    'order_line_id' => $data['line']->id,
                    'count' => $count,
                ];
                $allocated += $count;
            }
        } elseif (empty($asapLines) && $remaining > 0) {
            // No ASAP lines — remaining capacity goes unused by order lines (to SSP/playlist)
            // Don't redistribute to uniform lines beyond their budget
        }

        return [
            'allocations' => $allocations,
            'remaining' => $capacity - $allocated,
        ];
    }

    /**
     * Calculate total daily spots for a screen.
     *
     * Uses the hierarchy for duration (group > tenant > 10s default)
     * and schedule (screen > group > tenant > 24/7).
     *
     * Formula: floor(window_seconds / duration_seconds)
     */
    public function calculateTotalDailySpots(Screen $screen): int
    {
        $durationSeconds = $this->resolveEffectiveDuration($screen);
        $windowSeconds = $this->resolveOperatingWindow($screen);

        return (int) floor($windowSeconds / $durationSeconds);
    }

    /**
     * Calculate daily budget for an order line on a specific screen.
     *
     * - uniform: ceil((target - delivered_on_screen) / remaining_days)
     * - asap: target - delivered_on_screen
     * - null target: null (unlimited, bounded by share_weight)
     *
     * When screenId is null, uses total impressions across all screens (for API display).
     */
    public function calculateDailyBudget(OrderLine $line, ?string $screenId = null): ?int
    {
        if (is_null($line->target_spots)) {
            return null;
        }

        $delivered = $this->getDeliveredImpressions($line, $screenId);
        $remaining = $line->target_spots - $delivered;

        if ($remaining <= 0) {
            return 0;
        }

        if ($line->delivery_pace === 'asap') {
            return $remaining;
        }

        // uniform pace
        $remainingDays = $this->calculateRemainingDays($line);

        if ($remainingDays <= 0) {
            // Last day or past end — deliver everything remaining
            return $remaining;
        }

        return (int) ceil($remaining / $remainingDays);
    }

    /**
     * Filter active order lines that apply to a given screen today.
     *
     * Criteria:
     * - order.status = 'active'
     * - order_line.status = 'active'
     * - today is within order date range (starts_at <= today <= ends_at)
     * - today is within line date range (starts_at <= today <= ends_at)
     * - target not exhausted (delivered < target_spots, or target_spots is null)
     * - at least one creative has active_dates including today
     * - the line targets this screen (directly via screen_id or via screen_group_id matching the screen's group_id)
     *
     * @return Collection<int, OrderLine>
     */
    public function filterActiveLines(Screen $screen): Collection
    {
        $today = Carbon::today()->toDateString();
        $screenId = $screen->id;
        $groupId = $screen->group_id;

        // Get order lines that target this screen (directly or via group)
        // Use withoutGlobalScopes on Order subquery to bypass tenant scoping
        // (PriorityEngine is a system-level service that operates across tenants)
        $query = OrderLine::query()
            ->whereHas('order', function ($q) use ($today) {
                $q->withoutGlobalScopes()
                    ->where('status', 'active')
                    ->where('starts_at', '<=', $today)
                    ->where('ends_at', '>=', $today);
            })
            ->where('status', 'active')
            ->where('starts_at', '<=', $today)
            ->where('ends_at', '>=', $today)
            ->where(function ($q) use ($screenId, $groupId) {
                $q->whereHas('targets', function ($tq) use ($screenId, $groupId) {
                    $tq->where(function ($inner) use ($screenId, $groupId) {
                        $inner->where('screen_id', $screenId);
                        if ($groupId) {
                            $inner->orWhere('screen_group_id', $groupId);
                        }
                    });
                });
            });

        $lines = $query->get();

        // Post-filter: per-screen exhaustion check and active_dates
        return $lines->filter(function (OrderLine $line) use ($today, $screenId) {
            // Check per-screen target exhaustion
            if (!is_null($line->target_spots)) {
                // Count impressions for THIS screen only
                $deliveredOnScreen = Impression::where('order_line_id', $line->id)
                    ->where('screen_id', $screenId)
                    ->where('result', 'success')
                    ->count();

                if ($deliveredOnScreen >= $line->target_spots) {
                    return false;
                }
            }

            // Check OrderLine active_dates: null/empty means active every day in range
            $activeDates = $line->active_dates;
            if (is_null($activeDates) || empty($activeDates)) {
                return true;
            }

            return in_array($today, $activeDates);
        })->values();
    }

    /**
     * Resolve the effective duration for a screen.
     *
     * Hierarchy: group.duration_seconds > tenant.default_duration_seconds > 10s (global default)
     */
    public function resolveEffectiveDuration(Screen $screen): int
    {
        // Check group duration
        if ($screen->screenGroup && $screen->screenGroup->duration_seconds) {
            return (int) $screen->screenGroup->duration_seconds;
        }

        // Check tenant duration
        $tenant = $screen->screenGroup?->tenant ?? $screen->tenant;
        if ($tenant && $tenant->default_duration_seconds) {
            return (int) $tenant->default_duration_seconds;
        }

        return self::DEFAULT_DURATION_SECONDS;
    }

    /**
     * Resolve the operating window for a screen in seconds.
     *
     * Hierarchy: screen.schedule > group.schedule > tenant.default_schedule > 24/7 (86400s)
     */
    public function resolveOperatingWindow(Screen $screen, ?Carbon $date = null): int
    {
        $schedule = $this->resolveSchedule($screen);

        if (is_null($schedule)) {
            return self::FULL_DAY_SECONDS;
        }

        return $this->calculateDayOperatingSeconds($schedule, $date);
    }

    /**
     * Resolve the effective schedule from the hierarchy.
     *
     * Hierarchy: screen.schedule > group.schedule > tenant.default_schedule > null (24/7)
     */
    public function resolveSchedule(Screen $screen): ?array
    {
        if (!empty($screen->schedule)) {
            return $screen->schedule;
        }

        if ($screen->screenGroup && !empty($screen->screenGroup->schedule)) {
            return $screen->screenGroup->schedule;
        }

        $tenant = $screen->screenGroup?->tenant ?? $screen->tenant;
        if ($tenant && !empty($tenant->default_schedule)) {
            return $tenant->default_schedule;
        }

        return null;
    }

    /**
     * Calculate operating seconds for a specific day from schedule rules.
     *
     * Schedule format is an array of rules, each with:
     * - days: array of day names (e.g., ['monday', 'tuesday', ...])
     * - start: "HH:MM" or "HH:MM:SS"
     * - end: "HH:MM" or "HH:MM:SS"
     *
     * Multiple rules can apply to the same day.
     */
    public function calculateDayOperatingSeconds(?array $schedule, ?Carbon $date = null): int
    {
        if (is_null($schedule) || empty($schedule)) {
            return self::FULL_DAY_SECONDS;
        }

        $date = $date ?? Carbon::today();
        $dayOfWeek = strtolower($date->format('l')); // e.g., 'monday'
        $dayNumber = (int) $date->format('N'); // 1=Monday, 7=Sunday

        $totalSeconds = 0;

        foreach ($schedule as $rule) {
            $days = $rule['days'] ?? [];

            // Support both numeric days (1-7 or 0-6) and string day names
            $matchesDay = false;
            foreach ($days as $day) {
                if (is_int($day) || is_numeric($day)) {
                    $d = (int) $day;
                    // Support both conventions: 1-7 (ISO) and 0-6 (JS where 0=Sunday)
                    if ($d === $dayNumber || ($d === 0 && $dayNumber === 7)) {
                        $matchesDay = true;
                        break;
                    }
                } else {
                    if (strtolower((string) $day) === $dayOfWeek) {
                        $matchesDay = true;
                        break;
                    }
                }
            }

            if (!$matchesDay) {
                continue;
            }

            $startSeconds = $this->timeToSeconds($rule['start'] ?? '00:00');
            $endSeconds = $this->timeToSeconds($rule['end'] ?? '24:00');

            $windowSeconds = $endSeconds - $startSeconds;
            if ($windowSeconds > 0) {
                $totalSeconds += $windowSeconds;
            }
        }

        // If no rules match this day, the screen doesn't operate today → 0 seconds
        return $totalSeconds;
    }

    /**
     * Get the count of successful impressions for an order line.
     * When screenId is provided, counts only impressions on that screen.
     */
    public function getDeliveredImpressions(OrderLine $line, ?string $screenId = null): int
    {
        $query = Impression::where('order_line_id', $line->id)
            ->where('result', 'success');

        if ($screenId) {
            $query->where('screen_id', $screenId);
        }

        return $query->count();
    }

    /**
     * Calculate remaining days between today and the line's ends_at (inclusive).
     */
    private function calculateRemainingDays(OrderLine $line): int
    {
        $today = Carbon::today();
        $endsAt = Carbon::parse($line->ends_at)->startOfDay();

        // Remaining days including today
        $days = $today->diffInDays($endsAt) + 1;

        return max(1, (int) $days);
    }

    /**
     * Convert a time string (HH:MM or HH:MM:SS) to seconds since midnight.
     */
    private function timeToSeconds(string $time): int
    {
        $parts = explode(':', $time);
        $hours = (int) ($parts[0] ?? 0);
        $minutes = (int) ($parts[1] ?? 0);
        $seconds = (int) ($parts[2] ?? 0);

        return ($hours * 3600) + ($minutes * 60) + $seconds;
    }
}
