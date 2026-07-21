<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Str;

class ResolutionController extends Controller
{
    /**
     * GET /api/admin/order-lines/{orderLineId}/resolutions
     *
     * Returns screens grouped by resolution with creative coverage status.
     */
    public function index(string $orderLineId): JsonResponse
    {
        if (!Str::isUuid($orderLineId)) {
            return response()->json(['message' => 'Order line not found.'], 404);
        }

        $orderLine = OrderLine::find($orderLineId);

        if (!$orderLine) {
            return response()->json(['message' => 'Order line not found.'], 404);
        }

        // Load all targets of this order line
        $targets = OrderLineTarget::where('order_line_id', $orderLineId)->get();

        // Resolve all screens with their target_id association
        // Each entry: ['screen' => Screen, 'target_id' => string]
        $screenEntries = collect();

        foreach ($targets as $target) {
            if ($target->screen_id) {
                // Direct screen target
                $screen = Screen::withoutGlobalScopes()->find($target->screen_id);
                if ($screen) {
                    $screenEntries->push([
                        'screen' => $screen,
                        'target_id' => $target->id,
                    ]);
                }
            } elseif ($target->screen_group_id) {
                // Group target: resolve all screens in the group
                $groupScreens = Screen::withoutGlobalScopes()
                    ->where('group_id', $target->screen_group_id)
                    ->get();

                foreach ($groupScreens as $screen) {
                    $screenEntries->push([
                        'screen' => $screen,
                        'target_id' => $target->id,
                    ]);
                }
            }
        }

        // Deduplicate screens (a screen could appear via both direct and group targets)
        // Prefer screen-level targets over group targets (creatives live at screen level after bulk-assign)
        $screenMap = [];
        foreach ($screenEntries as $entry) {
            $screenId = $entry['screen']->id;
            if (!isset($screenMap[$screenId])) {
                $screenMap[$screenId] = $entry;
            } else {
                // If current entry is a direct screen target, prefer it over group target
                $existingTarget = OrderLineTarget::find($screenMap[$screenId]['target_id']);
                $newTarget = OrderLineTarget::find($entry['target_id']);
                if ($newTarget && $newTarget->screen_id !== null) {
                    $screenMap[$screenId] = $entry;
                }
            }
        }
        $uniqueScreenEntries = collect(array_values($screenMap));

        // Group by resolution (width x height)
        $grouped = $uniqueScreenEntries->groupBy(function ($entry) {
            $screen = $entry['screen'];
            return $screen->resolution_width . 'x' . $screen->resolution_height;
        });

        // Build response groups
        $groups = $grouped->map(function ($entries, $resolutionKey) use ($orderLineId) {
            $firstScreen = $entries->first()['screen'];
            $resolutionWidth = $firstScreen->resolution_width;
            $resolutionHeight = $firstScreen->resolution_height;

            $screens = $entries->map(function ($entry) {
                return [
                    'id' => $entry['screen']->id,
                    'name' => $entry['screen']->name,
                    'target_id' => $entry['target_id'],
                ];
            })->values()->all();

            // Collect unique target IDs for this resolution group
            $targetIds = $entries->pluck('target_id')->unique()->values()->all();

            // Check which targets have creatives matching THIS resolution
            // (resolution_width/height match OR are null for legacy creatives)
            $targetIdsWithMatchingCreatives = OrderLineTarget::whereIn('id', $targetIds)
                ->whereHas('creatives', function ($q) use ($resolutionWidth, $resolutionHeight) {
                    $q->where(function ($sub) use ($resolutionWidth, $resolutionHeight) {
                        $sub->where(function ($inner) use ($resolutionWidth, $resolutionHeight) {
                            $inner->where('resolution_width', $resolutionWidth)
                                  ->where('resolution_height', $resolutionHeight);
                        })->orWhere(function ($inner) {
                            $inner->whereNull('resolution_width')
                                  ->whereNull('resolution_height');
                        });
                    });
                })
                ->pluck('id')
                ->toArray();

            // Calculate coverage: count screens whose target has a matching creative
            $withCreative = $entries->filter(function ($entry) use ($targetIdsWithMatchingCreatives) {
                return in_array($entry['target_id'], $targetIdsWithMatchingCreatives);
            })->count();

            $total = count($screens);

            return [
                'resolution_width' => $resolutionWidth,
                'resolution_height' => $resolutionHeight,
                'screen_count' => $total,
                'screens' => $screens,
                'has_creative' => $withCreative > 0,
                'coverage' => [
                    'with_creative' => $withCreative,
                    'total' => $total,
                ],
            ];
        })->values();

        // Sort by screen_count descending
        $sorted = $groups->sortByDesc('screen_count')->values();

        return response()->json(['data' => $sorted]);
    }
}
