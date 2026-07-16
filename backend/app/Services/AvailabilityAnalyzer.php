<?php

namespace App\Services;

use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use Carbon\Carbon;
use Illuminate\Support\Collection;

class AvailabilityAnalyzer implements AvailabilityAnalyzerInterface
{
    private const DEFAULT_OPERATING_WINDOW_SECONDS = 57600; // 16 hours
    private const DEFAULT_NUM_SLOTS = 10;
    private const DEFAULT_DURATION_SECONDS = 10;

    private LoopTemplateGeneratorInterface $loopTemplateGenerator;

    public function __construct(LoopTemplateGeneratorInterface $loopTemplateGenerator)
    {
        $this->loopTemplateGenerator = $loopTemplateGenerator;
    }

    /**
     * Analiza si el target_spots de la línea es alcanzable dado el inventario actual.
     *
     * Calcula: target_spots vs (loops_per_day × assignable_slots) considerando
     * las demás líneas activas en las mismas pantallas.
     */
    public function analyze(OrderLine $line): AvailabilityResult
    {
        $targetSpots = (int) $line->target_spots;

        // Resolve all screens targeted by this line
        $screens = $line->resolveTargetScreens();

        if ($screens->isEmpty()) {
            return new AvailabilityResult(
                isSufficient: $targetSpots <= 0,
                targetSpots: $targetSpots,
                availableCapacity: 0,
                saturationPercent: $targetSpots > 0 ? 100.0 : 0.0,
                warningMessage: $targetSpots > 0
                    ? 'La línea no tiene pantallas objetivo asignadas.'
                    : null,
            );
        }

        // Calculate total available capacity across all targeted screens
        $totalAvailableCapacity = 0;

        foreach ($screens as $screen) {
            $screenCapacity = $this->calculateScreenAvailableCapacity($screen, $line);
            $totalAvailableCapacity += $screenCapacity;
        }

        // Determine if capacity is sufficient
        $isSufficient = $targetSpots <= $totalAvailableCapacity;

        // Calculate saturation percent
        $saturationPercent = $totalAvailableCapacity > 0
            ? round(($targetSpots / $totalAvailableCapacity) * 100, 2)
            : ($targetSpots > 0 ? 100.0 : 0.0);

        // Build warning message if insufficient
        $warningMessage = null;
        if (! $isSufficient) {
            $warningMessage = sprintf(
                'Capacidad insuficiente: se solicitan %d spots pero solo hay %d disponibles (saturación: %.1f%%).',
                $targetSpots,
                $totalAvailableCapacity,
                $saturationPercent,
            );
        }

        return new AvailabilityResult(
            isSufficient: $isSufficient,
            targetSpots: $targetSpots,
            availableCapacity: $totalAvailableCapacity,
            saturationPercent: $saturationPercent,
            warningMessage: $warningMessage,
        );
    }

    /**
     * Calculate available capacity for a single screen, considering other active lines.
     *
     * Available capacity = loops_per_day × assignable_slots_for_this_line
     * Where assignable_slots = ad_slots - slots_already_consumed_by_other_active_lines
     */
    private function calculateScreenAvailableCapacity(Screen $screen, OrderLine $currentLine): int
    {
        $numSlots = $this->loopTemplateGenerator->resolveNumSlots($screen);
        $tenant = $screen->tenant;

        $sspSlots = (int) ($tenant->ssp_slots ?? 2);
        $playlistSlots = (int) ($tenant->playlist_slots ?? 1);
        $adSlots = max(0, $numSlots - $sspSlots - $playlistSlots);

        $loopsPerDay = $this->calculateLoopsPerDay($screen, $numSlots);

        if ($loopsPerDay <= 0 || $adSlots <= 0) {
            return 0;
        }

        // Count slots consumed by other active lines on this screen
        $consumedSlots = $this->countConsumedSlots($screen, $currentLine);

        // Assignable slots for this line = ad_slots - consumed by others
        $assignableSlots = max(0, $adSlots - $consumedSlots);

        return $loopsPerDay * $assignableSlots;
    }

    /**
     * Calculate loops_per_day for a given screen.
     */
    private function calculateLoopsPerDay(Screen $screen, int $numSlots): int
    {
        $slotDurationSeconds = $this->resolveSlotDuration($screen);
        $operatingWindowSeconds = $this->resolveOperatingWindow($screen);

        $loopDurationSeconds = $numSlots * $slotDurationSeconds;

        if ($loopDurationSeconds <= 0) {
            return 0;
        }

        return (int) floor($operatingWindowSeconds / $loopDurationSeconds);
    }

    /**
     * Count ad_slots consumed by other active lines on this screen.
     *
     * Patrocinio lines consume their slots_purchased count.
     * Other active lines (estandar, red_interna) each consume 1 slot
     * (unless they share via round-robin, but for availability we count
     * unique slot occupation optimistically: each line needs at least 1 slot).
     */
    private function countConsumedSlots(Screen $screen, OrderLine $currentLine): int
    {
        $screenId = $screen->id;
        $groupId = $screen->group_id;
        $today = Carbon::today()->toDateString();

        // Get other active lines targeting this screen (exclude current line)
        $otherActiveLines = OrderLine::query()
            ->where('status', 'active')
            ->where('id', '!=', $currentLine->id)
            ->where('starts_at', '<=', $today)
            ->where('ends_at', '>=', $today)
            ->whereHas('targets', function ($q) use ($screenId, $groupId) {
                $q->where(function ($inner) use ($screenId, $groupId) {
                    $inner->where('screen_id', $screenId);
                    if ($groupId) {
                        $inner->orWhere('screen_group_id', $groupId);
                    }
                });
            })
            ->get();

        $consumedSlots = 0;

        foreach ($otherActiveLines as $line) {
            if ($line->priority_tier === 'patrocinio') {
                // Patrocinio lines consume their guaranteed slots
                $consumedSlots += (int) ($line->slots_purchased ?? 1);
            } else {
                // Estandar and Red_Interna each need at least 1 slot
                $consumedSlots++;
            }
        }

        return $consumedSlots;
    }

    /**
     * Resolve slot_duration_seconds from hierarchy:
     * ScreenGroup.duration_seconds → Tenant.default_duration_seconds → 10s
     */
    private function resolveSlotDuration(Screen $screen): int
    {
        if ($screen->screenGroup && $screen->screenGroup->duration_seconds) {
            return (int) $screen->screenGroup->duration_seconds;
        }

        $tenant = $screen->tenant;
        if ($tenant && $tenant->default_duration_seconds) {
            return (int) $tenant->default_duration_seconds;
        }

        return self::DEFAULT_DURATION_SECONDS;
    }

    /**
     * Resolve the operating window for a screen in seconds.
     */
    private function resolveOperatingWindow(Screen $screen): int
    {
        $schedule = $this->resolveSchedule($screen);

        if (is_null($schedule) || empty($schedule)) {
            return self::DEFAULT_OPERATING_WINDOW_SECONDS;
        }

        return $this->calculateDayOperatingSeconds($schedule);
    }

    /**
     * Resolve the effective schedule from the hierarchy.
     */
    private function resolveSchedule(Screen $screen): ?array
    {
        if (!empty($screen->schedule)) {
            return $screen->schedule;
        }

        if ($screen->screenGroup && !empty($screen->screenGroup->schedule)) {
            return $screen->screenGroup->schedule;
        }

        $tenant = $screen->tenant;
        if ($tenant && !empty($tenant->default_schedule)) {
            return $tenant->default_schedule;
        }

        return null;
    }

    /**
     * Calculate operating seconds for today from schedule rules.
     */
    private function calculateDayOperatingSeconds(array $schedule): int
    {
        $totalSeconds = 0;

        foreach ($schedule as $rule) {
            $startSeconds = $this->timeToSeconds($rule['start'] ?? '00:00');
            $endSeconds = $this->timeToSeconds($rule['end'] ?? '24:00');

            $windowSeconds = $endSeconds - $startSeconds;
            if ($windowSeconds > 0) {
                $totalSeconds += $windowSeconds;
            }
        }

        return $totalSeconds > 0 ? $totalSeconds : self::DEFAULT_OPERATING_WINDOW_SECONDS;
    }

    /**
     * Convert time string to seconds since midnight.
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
