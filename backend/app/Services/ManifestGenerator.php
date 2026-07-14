<?php

namespace App\Services;

use App\Models\Creative;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\ScreenManifest;
use Illuminate\Support\Collection;

class ManifestGenerator implements ManifestGeneratorInterface
{
    private CreativeSelectorInterface $creativeSelector;

    public function __construct(CreativeSelectorInterface $creativeSelector)
    {
        $this->creativeSelector = $creativeSelector;
    }

    /**
     * {@inheritdoc}
     */
    public function generate(Screen $screen, array $sequence, int $sspSlots, int $playlistSlots): ScreenManifest
    {
        $durationSeconds = $this->resolveEffectiveDuration($screen);
        $totalPositions = count($sequence) + $sspSlots + $playlistSlots;

        // Step 1: Build order_line_creative items from the sequence
        $orderLineItems = $this->buildOrderLineItems($screen, $sequence, $durationSeconds);

        // Step 2: Get playlist items for the screen
        $playlistItemsPool = $this->getPlaylistItems($screen);

        // Step 3: Build SSP and playlist slot items
        $sspItems = $this->buildSspItems($sspSlots, $durationSeconds);
        $playlistManifestItems = $this->buildPlaylistManifestItems($playlistSlots, $playlistItemsPool, $durationSeconds);

        // Step 4: Merge all items and assign sequential positions
        $allItems = $this->mergeAndAssignPositions($orderLineItems, $sspItems, $playlistManifestItems, $totalPositions);

        // Step 5: Compute version hash
        $version = $this->computeVersion($allItems);

        // Step 6: Persist (upsert by screen_id)
        $manifest = ScreenManifest::updateOrCreate(
            ['screen_id' => $screen->id],
            [
                'version' => $version,
                'generated_at' => now(),
                'items' => $allItems,
                'total_spots' => $totalPositions,
                'remaining_spots' => $totalPositions - count($sequence),
            ]
        );

        return $manifest;
    }

    /**
     * {@inheritdoc}
     */
    public function computeVersion(array $items): string
    {
        return hash('sha256', json_encode($items));
    }

    /**
     * Build manifest items for order_line_creative entries from the sequence.
     *
     * Resolves creatives by screen: loads only creatives assigned to targets
     * that reference this specific screen (directly or via screen group).
     * Filters by OrderLine active_dates (null/empty = active every day in range,
     * non-empty = active only on listed dates).
     * Groups by order_line_id and applies anti-repetition per order line.
     *
     * @param Screen $screen
     * @param array<array{position: int, order_line_id: string}> $sequence
     * @param int $durationSeconds
     * @return array
     */
    private function buildOrderLineItems(Screen $screen, array $sequence, int $durationSeconds): array
    {
        $items = [];
        $recentHistory = []; // keyed by order_line_id

        // Resolve the target_ids for this screen (direct + via screen group)
        $screenTargetIds = $this->resolveTargetIdsForScreen($screen);

        if (empty($screenTargetIds)) {
            return $items;
        }

        $today = now()->toDateString();

        // Load order lines that are active today via their active_dates (or null = always active in range)
        $activeOrderLineIds = OrderLine::whereHas('targets', fn($q) => $q->whereIn('id', $screenTargetIds))
            ->where('status', 'active')
            ->where('starts_at', '<=', $today)
            ->where('ends_at', '>=', $today)
            ->where(function ($query) use ($today) {
                $query->whereNull('active_dates')
                      ->orWhereJsonLength('active_dates', 0)
                      ->orWhereJsonContains('active_dates', $today);
            })
            ->pluck('id')
            ->toArray();

        // Load creatives from active order lines' targets
        // Filter by resolution: only include creatives that match this screen's resolution
        // (or legacy creatives with null resolution fields)
        $creativesByOrderLine = Creative::with(['content', 'orderLineTarget'])
            ->whereIn('order_line_target_id', $screenTargetIds)
            ->whereHas('orderLineTarget', fn($q) => $q->whereIn('order_line_id', $activeOrderLineIds))
            ->where(function ($query) use ($screen) {
                $query->where(function ($q) use ($screen) {
                    $q->where('resolution_width', $screen->resolution_width)
                      ->where('resolution_height', $screen->resolution_height);
                })->orWhere(function ($q) {
                    $q->whereNull('resolution_width')
                      ->whereNull('resolution_height');
                });
            })
            ->get()
            ->groupBy(fn($creative) => $creative->orderLineTarget->order_line_id);

        foreach ($sequence as $entry) {
            $orderLineId = $entry['order_line_id'];
            $pool = $creativesByOrderLine->get($orderLineId, collect());

            // No creatives for this screen on this order line → skip
            if ($pool->isEmpty()) {
                continue;
            }

            // Initialize history for this order line if not set
            if (!isset($recentHistory[$orderLineId])) {
                $recentHistory[$orderLineId] = [];
            }

            // Select creative using weighted random with anti-repetition
            $creative = $this->creativeSelector->select($pool, $recentHistory[$orderLineId]);

            // Update recent history (most recent first)
            array_unshift($recentHistory[$orderLineId], $creative->id);

            // Build the item
            $content = $creative->content;
            $items[] = [
                'position' => $entry['position'], // temporary, will be reassigned
                'type' => 'order_line_creative',
                'asset_url' => $content ? url("/api/device/content/{$content->id}/file") : null,
                'checksum_sha256' => $content?->checksum_sha256,
                'duration_seconds' => $durationSeconds,
                'order_line_id' => $orderLineId,
                'creative_id' => $creative->id,
                'target_id' => $creative->order_line_target_id,
            ];
        }

        return $items;
    }

    /**
     * Resolve the target IDs that reference this screen (directly or via screen group).
     *
     * @param Screen $screen
     * @return array<string>
     */
    private function resolveTargetIdsForScreen(Screen $screen): array
    {
        return OrderLineTarget::where(function ($query) use ($screen) {
            $query->where('screen_id', $screen->id);
            if ($screen->group_id) {
                $query->orWhere('screen_group_id', $screen->group_id);
            }
        })->pluck('id')->toArray();
    }

    /**
     * Build SSP slot items.
     *
     * @param int $count Number of SSP slots
     * @param int $durationSeconds Duration per slot
     * @return array
     */
    private function buildSspItems(int $count, int $durationSeconds): array
    {
        $items = [];

        for ($i = 0; $i < $count; $i++) {
            $items[] = [
                'type' => 'prodooh_ssp_call',
                'duration_seconds' => $durationSeconds,
            ];
        }

        return $items;
    }

    /**
     * Build playlist slot items, cycling through available playlist items.
     *
     * @param int $count Number of playlist slots
     * @param Collection $playlistItemsPool Available playlist items
     * @param int $durationSeconds Duration per slot
     * @return array
     */
    private function buildPlaylistManifestItems(int $count, Collection $playlistItemsPool, int $durationSeconds): array
    {
        $items = [];

        if ($playlistItemsPool->isEmpty() || $count <= 0) {
            return $items;
        }

        $poolSize = $playlistItemsPool->count();

        for ($i = 0; $i < $count; $i++) {
            // Cycle through playlist items if more slots than items
            $playlistItem = $playlistItemsPool[$i % $poolSize];
            $content = $playlistItem->content;

            $items[] = [
                'type' => 'playlist_item',
                'asset_url' => $content ? url("/api/device/content/{$content->id}/file") : null,
                'checksum_sha256' => $content?->checksum_sha256,
                'duration_seconds' => $durationSeconds,
                'playlist_item_id' => $playlistItem->id,
            ];
        }

        return $items;
    }

    /**
     * Merge all item types and distribute them uniformly across the total positions.
     *
     * Order line items are evenly spaced throughout the manifest (not clustered at start).
     * SSP and playlist items fill the gaps between order line spots.
     * Priority is preserved: items appear in the sequence order but distributed evenly.
     *
     * @param array $orderLineItems Items from order lines
     * @param array $sspItems SSP slot items
     * @param array $playlistItems Playlist slot items
     * @param int $totalPositions Total number of positions in the manifest
     * @return array Final items array with sequential positions
     */
    private function mergeAndAssignPositions(array $orderLineItems, array $sspItems, array $playlistItems, int $totalPositions): array
    {
        if ($totalPositions <= 0) {
            return [];
        }

        $orderCount = count($orderLineItems);
        $fillerItems = $this->interleaveFillers($sspItems, $playlistItems);
        $fillerCount = count($fillerItems);

        // If no order items, just return fillers sequentially
        if ($orderCount === 0) {
            $result = [];
            foreach ($fillerItems as $idx => $item) {
                $item['position'] = $idx;
                $result[] = $item;
            }
            return $result;
        }

        // If no fillers, just return order items sequentially
        if ($fillerCount === 0) {
            $result = [];
            foreach ($orderLineItems as $idx => $item) {
                $item['position'] = $idx;
                $result[] = $item;
            }
            return $result;
        }

        // Distribute order_line items uniformly across totalPositions
        // Calculate the interval: one order_line item every N positions
        $interval = $totalPositions / $orderCount;

        // Assign target positions to order_line items (evenly spaced)
        $orderPositions = [];
        for ($i = 0; $i < $orderCount; $i++) {
            $orderPositions[] = (int) round($i * $interval);
        }

        // Build the final array: place order items at their calculated positions,
        // fill everything else with filler items
        $result = [];
        $orderIdx = 0;
        $fillerIdx = 0;

        for ($pos = 0; $pos < $totalPositions; $pos++) {
            if ($orderIdx < $orderCount && in_array($pos, $orderPositions)) {
                $item = $orderLineItems[$orderIdx];
                $item['position'] = $pos;
                $result[] = $item;
                $orderIdx++;
            } else {
                if ($fillerIdx < $fillerCount) {
                    $item = $fillerItems[$fillerIdx];
                    $item['position'] = $pos;
                    $result[] = $item;
                    $fillerIdx++;
                }
            }
        }

        return $result;
    }

    /**
     * Interleave SSP and playlist filler items for even distribution.
     *
     * @param array $sspItems
     * @param array $playlistItems
     * @return array
     */
    private function interleaveFillers(array $sspItems, array $playlistItems): array
    {
        $result = [];
        $sspCount = count($sspItems);
        $playlistCount = count($playlistItems);
        $total = $sspCount + $playlistCount;

        if ($total === 0) {
            return [];
        }

        // Use simple alternation: SSP then playlist, repeat
        $si = 0;
        $pi = 0;

        while ($si < $sspCount || $pi < $playlistCount) {
            if ($si < $sspCount) {
                $result[] = $sspItems[$si];
                $si++;
            }
            if ($pi < $playlistCount) {
                $result[] = $playlistItems[$pi];
                $pi++;
            }
        }

        return $result;
    }

    /**
     * Get all playlist items from the screen's assigned playlists.
     *
     * @param Screen $screen
     * @return Collection
     */
    private function getPlaylistItems(Screen $screen): Collection
    {
        $screen->loadMissing('playlists.playlistItems.content');

        $items = collect();

        foreach ($screen->playlists as $playlist) {
            foreach ($playlist->playlistItems->sortBy('position') as $playlistItem) {
                $items->push($playlistItem);
            }
        }

        return $items->values();
    }

    /**
     * Resolve the effective duration for a screen.
     *
     * Hierarchy: group.duration_seconds > tenant.default_duration_seconds > 10s default.
     *
     * @param Screen $screen
     * @return int
     */
    private function resolveEffectiveDuration(Screen $screen): int
    {
        $screen->loadMissing('screenGroup.tenant');

        // Check group duration
        if ($screen->screenGroup && $screen->screenGroup->duration_seconds) {
            return (int) $screen->screenGroup->duration_seconds;
        }

        // Check tenant duration
        $tenant = $screen->screenGroup?->tenant;
        if ($tenant && $tenant->default_duration_seconds) {
            return (int) $tenant->default_duration_seconds;
        }

        return 10; // Global default
    }
}
