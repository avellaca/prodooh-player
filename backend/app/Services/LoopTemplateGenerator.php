<?php

namespace App\Services;

use App\Jobs\RegenerateLoopTemplateJob;
use App\Models\Creative;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\ScreenManifest;
use App\Services\PlaybackModeResolver;
use Carbon\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Bus;

class LoopTemplateGenerator implements LoopTemplateGeneratorInterface
{
    private const DEFAULT_NUM_SLOTS = 10;
    private const DEFAULT_DURATION_SECONDS = 10;
    private const DEFAULT_OPERATING_WINDOW_SECONDS = 57600; // 16 hours
    private const FULL_DAY_SECONDS = 86400;

    private SlotAllocatorInterface $slotAllocator;
    private RotationSchedulerInterface $rotationScheduler;

    public function __construct(
        SlotAllocatorInterface $slotAllocator,
        RotationSchedulerInterface $rotationScheduler,
    ) {
        $this->slotAllocator = $slotAllocator;
        $this->rotationScheduler = $rotationScheduler;
    }

    /**
     * Genera el Loop Template completo para una pantalla.
     *
     * Orchestration:
     * 1. Resolve num_slots, ssp_slots, playlist_slots by hierarchy
     * 2. Calculate loops_per_day
     * 3. Fetch active order lines for this screen
     * 4. Call SlotAllocator for ad_slots
     * 5. Apply RotationScheduler for round_robin slots
     * 6. Build complete Loop Template JSON
     * 7. Compute version hash
     * 8. Upsert into screen_manifests
     */
    public function generate(Screen $screen): ScreenManifest
    {
        // ─── 1. Resolve configuration by hierarchy ──────────────────────────
        $numSlots = $this->resolveNumSlots($screen);
        $tenant = $screen->tenant;
        $sspSlots = (int) ($tenant->ssp_slots ?? 2);
        $playlistSlots = (int) ($tenant->playlist_slots ?? 1);
        $adSlots = $numSlots - $sspSlots - $playlistSlots;

        // Ensure ad_slots is at least 0 (validation should prevent this, but be safe)
        $adSlots = max(0, $adSlots);

        // ─── 2. Calculate loops_per_day ─────────────────────────────────────
        $slotDurationSeconds = $this->resolveSlotDuration($screen);
        $operatingWindowSeconds = $this->resolveOperatingWindow($screen);
        $loopDurationSeconds = $numSlots * $slotDurationSeconds;
        $loopsPerDay = $loopDurationSeconds > 0
            ? (int) floor($operatingWindowSeconds / $loopDurationSeconds)
            : 0;

        // ─── 3. Get active order lines for this screen ──────────────────────
        $activeLines = $this->getActiveOrderLines($screen);

        // ─── 4. Call SlotAllocator to assign ad_slots ───────────────────────
        $adAssignments = [];
        if ($adSlots > 0 && $activeLines->isNotEmpty()) {
            $adAssignments = $this->slotAllocator->allocate($activeLines, $adSlots, $loopsPerDay);
        }

        // ─── 5. Apply RotationScheduler for round_robin slots ───────────────
        $totalActiveCreatives = $this->countTotalActiveCreatives($activeLines, $screen);
        $adAssignments = $this->applyRotationScheduler($adAssignments, $activeLines, $totalActiveCreatives);

        // ─── 6. Build the slots array ───────────────────────────────────────
        $slots = $this->buildSlotsArray(
            $adAssignments,
            $adSlots,
            $sspSlots,
            $playlistSlots,
            $slotDurationSeconds,
            $screen,
            $activeLines,
        );

        // ─── 7. Build complete Loop Template JSON ───────────────────────────
        $syncIntervalSeconds = (int) ($tenant->sync_interval_seconds ?? 240);
        $cacheFlushIntervalHours = (int) ($tenant->cache_flush_interval_hours ?? 24);

        $templateContent = [
            'generated_at' => Carbon::now()->toIso8601String(),
            'loop_config' => [
                'num_slots' => $numSlots,
                'slot_duration_seconds' => $slotDurationSeconds,
                'loop_duration_seconds' => $loopDurationSeconds,
                'loops_per_day' => $loopsPerDay,
            ],
            'slots' => $slots,
            'sync_interval_seconds' => $syncIntervalSeconds,
            'cache_flush_interval_hours' => $cacheFlushIntervalHours,
        ];

        // ─── 8. Compute version as SHA-256 hash ────────────────────────────
        $version = hash('sha256', json_encode($templateContent));

        // Add version to the final template (with prefix for JSON/API)
        $loopTemplate = array_merge(['version' => "sha256:{$version}"], $templateContent);

        // ─── 9. Upsert into screen_manifests table ──────────────────────────
        $manifest = ScreenManifest::updateOrCreate(
            ['screen_id' => $screen->id],
            [
                'version' => $version,
                'generated_at' => Carbon::now(),
                'items' => $loopTemplate,
                'total_spots' => $loopsPerDay * $numSlots,
                'remaining_spots' => $loopsPerDay * $adSlots,
            ],
        );

        return $manifest;
    }

    /**
     * Regenera templates para todas las pantallas afectadas por un cambio.
     *
     * Dispatches a batch of queue jobs for each screen, ensuring processing
     * completes within 30 seconds. Uses Bus::batch for efficient batch processing
     * and ShouldBeUnique on jobs to deduplicate concurrent regenerations for the same screen.
     *
     * @param array $screenIds Array of screen UUIDs to regenerate
     */
    public function regenerateAffected(array $screenIds): void
    {
        if (empty($screenIds)) {
            return;
        }

        // Deduplicate screen IDs
        $uniqueScreenIds = array_values(array_unique($screenIds));

        // Verify screens exist (filter out deleted screens)
        $existingScreenIds = Screen::withoutGlobalScopes()
            ->whereIn('id', $uniqueScreenIds)
            ->pluck('id')
            ->all();

        if (empty($existingScreenIds)) {
            return;
        }

        // Build queue jobs for each screen
        $jobs = array_map(
            fn (string $screenId) => new RegenerateLoopTemplateJob($screenId),
            $existingScreenIds,
        );

        // Dispatch as a batch for efficient processing
        // The batch allows monitoring and ensures all jobs are processed together
        Bus::batch($jobs)
            ->name('regenerate-loop-templates')
            ->allowFailures()
            ->dispatch();
    }

    /**
     * Resuelve num_slots efectivo por herencia:
     * Screen.num_slots → ScreenGroup.num_slots → Tenant.num_slots → 10.
     */
    public function resolveNumSlots(Screen $screen): int
    {
        // 1. Screen override
        if ($screen->num_slots !== null) {
            return (int) $screen->num_slots;
        }

        // 2. ScreenGroup override
        $screenGroup = $screen->screenGroup;
        if ($screenGroup !== null && $screenGroup->num_slots !== null) {
            return (int) $screenGroup->num_slots;
        }

        // 3. Tenant value
        $tenant = $screen->tenant;
        if ($tenant !== null && $tenant->num_slots !== null) {
            return (int) $tenant->num_slots;
        }

        // 4. Global fallback
        return self::DEFAULT_NUM_SLOTS;
    }

    /**
     * Resolve slot_duration_seconds from hierarchy:
     * ScreenGroup.duration_seconds → Tenant.default_duration_seconds → 10s
     */
    private function resolveSlotDuration(Screen $screen): int
    {
        // Check group duration
        if ($screen->screenGroup && $screen->screenGroup->duration_seconds) {
            return (int) $screen->screenGroup->duration_seconds;
        }

        // Check tenant duration
        $tenant = $screen->tenant;
        if ($tenant && $tenant->default_duration_seconds) {
            return (int) $tenant->default_duration_seconds;
        }

        return self::DEFAULT_DURATION_SECONDS;
    }

    /**
     * Resolve the operating window for a screen in seconds.
     *
     * Uses the screen's schedule (hierarchy: screen > group > tenant > default 16h).
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
     *
     * Hierarchy: screen.schedule > group.schedule > tenant.default_schedule > null
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
    private function calculateDayOperatingSeconds(array $schedule, ?Carbon $date = null): int
    {
        $date = $date ?? Carbon::today();
        $dayOfWeek = strtolower($date->format('l'));
        $dayNumber = (int) $date->format('N');

        $totalSeconds = 0;

        foreach ($schedule as $rule) {
            $days = $rule['days'] ?? [];

            $matchesDay = false;
            foreach ($days as $day) {
                if (is_int($day) || is_numeric($day)) {
                    $d = (int) $day;
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

        // If no rules match today, use default operating window
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

    /**
     * Get active order lines targeting this screen.
     *
     * Active lines must have:
     * - OrderLine status = 'active'
     * - Today within starts_at..ends_at
     * - Target this screen (directly or via screen group)
     */
    private function getActiveOrderLines(Screen $screen): Collection
    {
        $today = Carbon::today()->toDateString();
        $screenId = $screen->id;
        $groupId = $screen->group_id;

        return OrderLine::query()
            ->where('status', 'active')
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
    }

    /**
     * Count total active creatives across all active lines for this screen.
     * Used to determine the ASAP:Uniform ratio threshold.
     */
    private function countTotalActiveCreatives(Collection $activeLines, Screen $screen): int
    {
        if ($activeLines->isEmpty()) {
            return 0;
        }

        $screenId = $screen->id;
        $groupId = $screen->group_id;

        // Get all target IDs for this screen
        $targetIds = OrderLineTarget::where(function ($q) use ($screenId, $groupId) {
            $q->where('screen_id', $screenId);
            if ($groupId) {
                $q->orWhere('screen_group_id', $groupId);
            }
        })
            ->whereIn('order_line_id', $activeLines->pluck('id'))
            ->pluck('id');

        return Creative::whereIn('order_line_target_id', $targetIds)->count();
    }

    /**
     * Apply RotationScheduler to slots with round_robin strategy.
     *
     * For each slot assignment with 'round_robin' strategy, call the RotationScheduler
     * to determine rotation frequencies and update the candidates.
     *
     * @param array $adAssignments Current slot assignments from SlotAllocator
     * @param Collection $activeLines Active order lines
     * @param int $totalActiveCreatives Total number of active creatives
     * @return array Updated assignments with rotation info
     */
    private function applyRotationScheduler(array $adAssignments, Collection $activeLines, int $totalActiveCreatives): array
    {
        foreach ($adAssignments as $position => $assignment) {
            if ($assignment->strategy !== 'round_robin') {
                continue;
            }

            // Build candidates collection with delivery_pace and share_weight for RotationScheduler
            $candidatesForRotation = collect($assignment->candidates)->map(function ($candidate) use ($activeLines) {
                $lineId = $candidate['order_line_id'] ?? '';
                $line = $activeLines->firstWhere('id', $lineId);

                return [
                    'order_line_id' => $lineId,
                    'delivery_pace' => $line->delivery_pace ?? 'uniform',
                    'share_weight' => $line->share_weight ?? 1,
                ];
            });

            $rotationResult = $this->rotationScheduler->calculateRotation(
                $candidatesForRotation,
                $totalActiveCreatives,
            );

            // Merge frequency back into candidates
            $updatedCandidates = collect($assignment->candidates)->map(function ($candidate) use ($rotationResult) {
                $lineId = $candidate['order_line_id'] ?? '';
                $rotation = collect($rotationResult)->firstWhere('order_line_id', $lineId);

                if ($rotation) {
                    $candidate['frequency'] = $rotation['frequency'];
                }

                return $candidate;
            })->all();

            $adAssignments[$position] = new SlotAssignment(
                position: $assignment->position,
                type: $assignment->type,
                strategy: $assignment->strategy,
                candidates: $updatedCandidates,
            );
        }

        return $adAssignments;
    }

    /**
     * Build the complete slots array for the Loop Template.
     *
     * Positions are organized in predictable ranges:
     * - [0 .. ad_slots-1]               → ad slots
     * - [ad_slots .. ad_slots+ssp-1]    → ssp slots
     * - [ad_slots+ssp .. num_slots-1]   → playlist slots
     */
    private function buildSlotsArray(
        array $adAssignments,
        int $adSlots,
        int $sspSlots,
        int $playlistSlots,
        int $slotDurationSeconds,
        Screen $screen,
        Collection $activeLines,
    ): array {
        $slots = [];

        // ─── Ad slots (positions 0..ad_slots-1) ────────────────────────────
        for ($i = 0; $i < $adSlots; $i++) {
            if (isset($adAssignments[$i])) {
                $assignment = $adAssignments[$i];

                // Resolve the effective playback mode for this slot's target
                $effectiveMode = $this->resolveSlotPlaybackMode($assignment->candidates, $screen);

                if ($effectiveMode === 'sequential') {
                    $candidates = $this->enrichAdCandidatesSequential($assignment->candidates, $screen);
                    $slots[] = [
                        'position' => $i,
                        'type' => 'ad',
                        'strategy' => 'sequential',
                        'candidates' => $candidates,
                    ];
                } else {
                    $candidates = $this->enrichAdCandidates($assignment->candidates, $screen);
                    $slots[] = [
                        'position' => $i,
                        'type' => 'ad',
                        'strategy' => $assignment->strategy,
                        'candidates' => $candidates,
                    ];
                }
            } else {
                // Empty ad slot (no lines assigned to this position)
                $slots[] = [
                    'position' => $i,
                    'type' => 'ad',
                    'strategy' => 'fixed',
                    'candidates' => [],
                ];
            }
        }

        // ─── SSP slots (positions ad_slots..ad_slots+ssp_slots-1) ──────────
        $tenant = $screen->tenant;
        for ($i = 0; $i < $sspSlots; $i++) {
            $position = $adSlots + $i;
            $slots[] = [
                'position' => $position,
                'type' => 'ssp',
                'strategy' => 'fixed',
                'provider' => 'prodooh',
                'config' => [
                    'api_key' => $tenant->api_credential ?? '',
                    'network_id' => $tenant->id,
                    'venue_id' => $screen->venue_id ?? '',
                ],
                'candidates' => [],
            ];
        }

        // ─── Playlist slots (positions ad_slots+ssp_slots..num_slots-1) ────
        $playlistCandidates = $this->buildPlaylistCandidates($screen);
        for ($i = 0; $i < $playlistSlots; $i++) {
            $position = $adSlots + $sspSlots + $i;
            $strategy = count($playlistCandidates) > 1 ? 'round_robin' : 'fixed';

            $slots[] = [
                'position' => $position,
                'type' => 'playlist',
                'strategy' => $strategy,
                'candidates' => $playlistCandidates,
            ];
        }

        return $slots;
    }

    /**
     * Resolve the effective playback mode for a slot based on its candidates.
     *
     * Looks at the first candidate's order line target to determine the playback mode.
     * Returns 'sequential' if the target's effective mode is sequential, otherwise 'round_robin'.
     */
    private function resolveSlotPlaybackMode(array $candidates, Screen $screen): string
    {
        if (empty($candidates)) {
            return 'round_robin';
        }

        $screenId = $screen->id;
        $groupId = $screen->group_id;

        // Use the first candidate's order line to find the target
        $lineId = $candidates[0]['order_line_id'] ?? '';
        if (empty($lineId)) {
            return 'round_robin';
        }

        $target = OrderLineTarget::where('order_line_id', $lineId)
            ->where(function ($q) use ($screenId, $groupId) {
                $q->where('screen_id', $screenId);
                if ($groupId) {
                    $q->orWhere('screen_group_id', $groupId);
                }
            })
            ->first();

        if (!$target) {
            return 'round_robin';
        }

        return PlaybackModeResolver::resolve($target);
    }

    /**
     * Enrich ad slot candidates for sequential mode.
     *
     * In sequential mode, ALL creatives for the target are included, ordered by position ASC (nulls last).
     * No weight-based selection is applied — all candidates are returned in their defined order.
     */
    private function enrichAdCandidatesSequential(array $candidates, Screen $screen): array
    {
        $screenId = $screen->id;
        $groupId = $screen->group_id;

        $allCandidates = [];

        foreach ($candidates as $candidate) {
            $lineId = $candidate['order_line_id'] ?? '';

            $target = OrderLineTarget::where('order_line_id', $lineId)
                ->where(function ($q) use ($screenId, $groupId) {
                    $q->where('screen_id', $screenId);
                    if ($groupId) {
                        $q->orWhere('screen_group_id', $groupId);
                    }
                })
                ->first();

            if (!$target) {
                continue;
            }

            // Fetch ALL creatives for this target, ordered by position ASC (nulls last)
            $creatives = Creative::where('order_line_target_id', $target->id)
                ->whereHas('content')
                ->with('content')
                ->orderByRaw('position IS NULL, position ASC')
                ->get();

            foreach ($creatives as $creative) {
                $content = $creative->content;
                $allCandidates[] = [
                    'order_line_id' => $lineId,
                    'creative_id' => $creative->id,
                    'asset_url' => $content
                        ? url("/api/device/content/{$content->id}/file")
                        : '',
                    'checksum_sha256' => $content->checksum_sha256 ?? '',
                ];
            }
        }

        return $allCandidates;
    }

    /**
     * Enrich ad slot candidates with creative details (asset_url, checksum_sha256, creative_id).
     *
     * Each candidate from SlotAllocator only has order_line_id.
     * We resolve the first active creative (with content) for each line targeting this screen.
     */
    private function enrichAdCandidates(array $candidates, Screen $screen): array
    {
        $screenId = $screen->id;
        $groupId = $screen->group_id;

        return array_map(function ($candidate) use ($screenId, $groupId) {
            $lineId = $candidate['order_line_id'] ?? '';

            // Find creatives for this order line targeting this screen
            $target = OrderLineTarget::where('order_line_id', $lineId)
                ->where(function ($q) use ($screenId, $groupId) {
                    $q->where('screen_id', $screenId);
                    if ($groupId) {
                        $q->orWhere('screen_group_id', $groupId);
                    }
                })
                ->first();

            $creative = null;
            $content = null;

            if ($target) {
                $creative = Creative::where('order_line_target_id', $target->id)
                    ->whereHas('content')
                    ->with('content')
                    ->first();
                $content = $creative?->content;
            }

            $enriched = [
                'order_line_id' => $lineId,
                'creative_id' => $creative?->id ?? '',
                'asset_url' => $content
                    ? url("/api/device/content/{$content->id}/file")
                    : '',
                'checksum_sha256' => $content?->checksum_sha256 ?? '',
            ];

            // Preserve frequency if set by RotationScheduler
            if (isset($candidate['frequency'])) {
                $enriched['frequency'] = $candidate['frequency'];
            }

            return $enriched;
        }, $candidates);
    }

    /**
     * Build playlist candidates from the screen's assigned playlists.
     */
    private function buildPlaylistCandidates(Screen $screen): array
    {
        $playlists = $screen->playlists()->with('playlistItems.content')->get();

        if ($playlists->isEmpty()) {
            return [];
        }

        $candidates = [];

        foreach ($playlists as $playlist) {
            foreach ($playlist->playlistItems->sortBy('position') as $item) {
                $content = $item->content;
                $candidates[] = [
                    'playlist_item_id' => $item->id,
                    'asset_url' => $content
                        ? url("/api/device/content/{$content->id}/file")
                        : ($item->url ?? ''),
                    'checksum_sha256' => $content?->checksum_sha256 ?? '',
                ];
            }
        }

        return $candidates;
    }
}
