<?php

namespace App\Services;

use App\Models\OrderLine;
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
     * Tracks recentHistory per order_line_id to maintain anti-repetition across the manifest.
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

        // Pre-load order lines with creatives and content
        $orderLineIds = array_unique(array_column($sequence, 'order_line_id'));
        $orderLines = OrderLine::with(['creatives.content'])
            ->whereIn('id', $orderLineIds)
            ->get()
            ->keyBy('id');

        foreach ($sequence as $entry) {
            $orderLineId = $entry['order_line_id'];
            $line = $orderLines->get($orderLineId);

            if (!$line) {
                continue;
            }

            // Initialize history for this order line if not set
            if (!isset($recentHistory[$orderLineId])) {
                $recentHistory[$orderLineId] = [];
            }

            // Select creative using anti-repetition
            $creative = $this->creativeSelector->select($line, $recentHistory[$orderLineId]);

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
            ];
        }

        return $items;
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
     * Merge all item types and assign sequential 0-based positions.
     *
     * Order line items occupy their original positions from the sequence.
     * SSP and playlist items fill the remaining positions, distributed evenly.
     *
     * @param array $orderLineItems Items from order lines (with original positions)
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

        // Determine which positions are taken by order_line items
        $occupiedPositions = [];
        foreach ($orderLineItems as $item) {
            $occupiedPositions[] = $item['position'];
        }

        // Find free positions for SSP and playlist items
        $freePositions = [];
        for ($i = 0; $i < $totalPositions; $i++) {
            if (!in_array($i, $occupiedPositions)) {
                $freePositions[] = $i;
            }
        }

        // Distribute SSP and playlist items across free positions
        // Interleave them: alternate SSP and playlist in the free positions
        $fillerItems = $this->interleaveFillers($sspItems, $playlistItems);

        // Assign free positions to filler items
        $allItems = [];

        // Add order_line items (keep their positions)
        foreach ($orderLineItems as $item) {
            $allItems[] = $item;
        }

        // Assign free positions to filler items
        foreach ($fillerItems as $index => $item) {
            if ($index < count($freePositions)) {
                $item['position'] = $freePositions[$index];
                $allItems[] = $item;
            }
        }

        // Sort by position for final output
        usort($allItems, fn($a, $b) => $a['position'] <=> $b['position']);

        // Reassign sequential positions (0-based) to ensure contiguity
        $result = [];
        foreach (array_values($allItems) as $idx => $item) {
            $item['position'] = $idx;
            $result[] = $item;
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
