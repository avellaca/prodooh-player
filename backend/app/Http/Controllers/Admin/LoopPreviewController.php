<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Creative;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Services\LoopTemplateGeneratorInterface;
use App\Services\PlaybackModeResolver;
use Illuminate\Http\JsonResponse;

class LoopPreviewController extends Controller
{
    public function __construct(
        private readonly LoopTemplateGeneratorInterface $loopGenerator,
    ) {}

    /**
     * GET /api/admin/screens/{id}/loop-preview
     *
     * Returns the manifest data enriched with metadata useful for rendering
     * a visual preview of the screen's loop (slot timing, positions, types,
     * creative info, and playback mode).
     */
    public function show(string $id): JsonResponse
    {
        $screen = Screen::with(['tenant', 'screenGroup', 'playlists'])->findOrFail($id);

        // Generate a fresh manifest for accurate preview
        $manifest = $this->loopGenerator->generate($screen);

        $items = $manifest->items ?? [];
        $loopConfig = $items['loop_config'] ?? [];
        $slots = $items['slots'] ?? [];

        // Resolve effective playback mode per active order line target
        $playbackModes = $this->resolvePlaybackModes($screen);

        // Enrich slots with creative metadata for preview rendering
        $enrichedSlots = $this->enrichSlotsForPreview($slots);

        return response()->json([
            'data' => [
                'screen' => [
                    'id' => $screen->id,
                    'name' => $screen->name,
                    'resolution_width' => $screen->resolution_width,
                    'resolution_height' => $screen->resolution_height,
                ],
                'loop_config' => [
                    'num_slots' => $loopConfig['num_slots'] ?? 0,
                    'slot_duration_seconds' => $loopConfig['slot_duration_seconds'] ?? 10,
                    'loop_duration_seconds' => $loopConfig['loop_duration_seconds'] ?? 0,
                    'loops_per_day' => $loopConfig['loops_per_day'] ?? 0,
                ],
                'slots' => $enrichedSlots,
                'playback_modes' => $playbackModes,
                'generated_at' => $items['generated_at'] ?? null,
            ],
        ]);
    }

    /**
     * Resolve effective playback modes for all order line targets assigned to this screen.
     *
     * @return array<string, string> Keyed by order_line_id => effective mode
     */
    private function resolvePlaybackModes(Screen $screen): array
    {
        $screenId = $screen->id;
        $groupId = $screen->group_id;

        $targets = OrderLineTarget::with('orderLine')
            ->where(function ($q) use ($screenId, $groupId) {
                $q->where('screen_id', $screenId);
                if ($groupId) {
                    $q->orWhere('screen_group_id', $groupId);
                }
            })
            ->whereHas('orderLine', fn ($q) => $q->where('status', 'active'))
            ->get();

        $modes = [];
        foreach ($targets as $target) {
            $orderLineId = $target->order_line_id;
            $modes[$orderLineId] = PlaybackModeResolver::resolve($target);
        }

        return $modes;
    }

    /**
     * Enrich manifest slots with additional creative metadata for preview rendering.
     *
     * Adds content_name, mime_type, duration_seconds, dimensions, and weight
     * to each candidate in ad slots.
     */
    private function enrichSlotsForPreview(array $slots): array
    {
        // Collect all creative_ids from ad slot candidates
        $creativeIds = [];
        foreach ($slots as $slot) {
            if (($slot['type'] ?? '') === 'ad') {
                foreach ($slot['candidates'] ?? [] as $candidate) {
                    if (!empty($candidate['creative_id'])) {
                        $creativeIds[] = $candidate['creative_id'];
                    }
                }
            }
        }

        // Batch load creatives with their content
        $creatives = Creative::with('content')
            ->whereIn('id', array_unique($creativeIds))
            ->get()
            ->keyBy('id');

        // Enrich each slot
        return array_map(function (array $slot) use ($creatives) {
            $enrichedSlot = [
                'position' => $slot['position'] ?? 0,
                'type' => $slot['type'] ?? 'ad',
                'strategy' => $slot['strategy'] ?? 'fixed',
            ];

            // Include provider/config for SSP slots
            if (($slot['type'] ?? '') === 'ssp') {
                $enrichedSlot['provider'] = $slot['provider'] ?? null;
            }

            // Enrich candidates with creative/content metadata
            $enrichedSlot['candidates'] = array_map(function (array $candidate) use ($creatives) {
                $enriched = [
                    'order_line_id' => $candidate['order_line_id'] ?? null,
                    'creative_id' => $candidate['creative_id'] ?? null,
                    'asset_url' => $candidate['asset_url'] ?? null,
                ];

                $creativeId = $candidate['creative_id'] ?? null;
                if ($creativeId && isset($creatives[$creativeId])) {
                    $creative = $creatives[$creativeId];
                    $content = $creative->content;

                    $enriched['weight'] = $creative->weight;
                    $enriched['position'] = $creative->position;

                    if ($content) {
                        $enriched['content'] = [
                            'id' => $content->id,
                            'name' => $content->filename,
                            'mime_type' => $content->mime_type,
                            'duration_seconds' => $content->duration_seconds,
                            'width' => $content->width,
                            'height' => $content->height,
                        ];
                    }
                }

                return $enriched;
            }, $slot['candidates'] ?? []);

            return $enrichedSlot;
        }, $slots);
    }
}
