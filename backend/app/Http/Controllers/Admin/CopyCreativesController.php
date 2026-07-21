<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Content;
use App\Models\Creative;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class CopyCreativesController extends Controller
{
    /**
     * POST /api/admin/order-lines/{sourceId}/copy-creatives
     *
     * Copies creatives from a source order line to a target order line,
     * matching content dimensions against target screen resolutions.
     *
     * Request body:
     * {
     *   "target_order_line_id": "uuid"
     * }
     *
     * Logic:
     * 1. Get source creatives' Content (unique by content_id)
     * 2. Resolve target screens by resolution (buildResolutionMap)
     * 3. For each unique content, create matching Creatives in target screens
     * 4. Skip content that doesn't match any target screen resolution
     *
     * Response 201:
     * {
     *   "data": {
     *     "created": N,
     *     "skipped": N,
     *     "covered_screens": ["uuid", ...]
     *   }
     * }
     */
    public function copy(Request $request, string $sourceId): JsonResponse
    {
        if (!Str::isUuid($sourceId)) {
            return response()->json(['message' => 'Order line not found.'], 404);
        }

        $sourceOrderLine = OrderLine::with(['order' => fn ($q) => $q->withoutGlobalScopes()])->find($sourceId);

        if (!$sourceOrderLine) {
            return response()->json(['message' => 'Order line not found.'], 404);
        }

        $validated = $request->validate([
            'target_order_line_id' => ['required', 'string', 'uuid'],
        ], [
            'target_order_line_id.required' => 'La línea de pedido destino es obligatoria.',
            'target_order_line_id.uuid' => 'La línea de pedido destino debe ser un UUID válido.',
        ]);

        // Validate target order line exists and belongs to the same tenant
        $targetOrderLine = OrderLine::with(['order' => fn ($q) => $q->withoutGlobalScopes()])->find($validated['target_order_line_id']);

        if (!$targetOrderLine) {
            throw ValidationException::withMessages([
                'target_order_line_id' => ['La línea de pedido destino no existe.'],
            ]);
        }

        $sourceTenantId = $sourceOrderLine->order->tenant_id;
        $targetTenantId = $targetOrderLine->order->tenant_id;

        if ($sourceTenantId !== $targetTenantId) {
            throw ValidationException::withMessages([
                'target_order_line_id' => ['La línea de pedido destino no pertenece al mismo tenant.'],
            ]);
        }

        // Prevent copying to the same order line
        if ($sourceId === $validated['target_order_line_id']) {
            throw ValidationException::withMessages([
                'target_order_line_id' => ['No se puede copiar creativos a la misma línea de pedido.'],
            ]);
        }

        // 1. Get unique contents from source creatives
        $sourceCreatives = Creative::whereHas('orderLineTarget', function ($q) use ($sourceId) {
            $q->where('order_line_id', $sourceId);
        })->with('content')->get();

        $uniqueContents = $sourceCreatives
            ->pluck('content')
            ->filter() // remove nulls
            ->unique('id');

        if ($uniqueContents->isEmpty()) {
            return response()->json([
                'data' => [
                    'created' => 0,
                    'skipped' => 0,
                    'covered_screens' => [],
                ],
            ], 201);
        }

        // 2. Build resolution map for target order line
        $resolutionMap = $this->buildResolutionMap($validated['target_order_line_id']);

        // 3. For each unique content, match against target resolution map
        $created = 0;
        $skipped = 0;
        $coveredScreens = collect();

        DB::transaction(function () use ($uniqueContents, $resolutionMap, &$created, &$skipped, &$coveredScreens) {
            foreach ($uniqueContents as $content) {
                if (is_null($content->width) || is_null($content->height)) {
                    $skipped++;
                    continue;
                }

                $resolutionKey = $content->width . 'x' . $content->height;

                if (!isset($resolutionMap[$resolutionKey])) {
                    $skipped++;
                    continue;
                }

                // Create a Creative per matching screen in target
                foreach ($resolutionMap[$resolutionKey] as $entry) {
                    // Skip if a creative with the same content already exists on this target
                    $exists = Creative::where('order_line_target_id', $entry['target_id'])
                        ->where('content_id', $content->id)
                        ->exists();

                    if ($exists) {
                        continue;
                    }

                    Creative::create([
                        'order_line_target_id' => $entry['target_id'],
                        'content_id' => $content->id,
                        'weight' => 100,
                        'resolution_width' => $content->width,
                        'resolution_height' => $content->height,
                    ]);

                    $created++;
                    $coveredScreens->push($entry['screen_id']);
                }
            }
        });

        return response()->json([
            'data' => [
                'created' => $created,
                'skipped' => $skipped,
                'covered_screens' => $coveredScreens->unique()->values()->all(),
            ],
        ], 201);
    }

    /**
     * Build a resolution map from the order line's targets.
     *
     * For each target (direct screen or screen group), resolves individual screens
     * and groups them by resolution key "WxH".
     *
     * Returns: ['1920x1080' => [['target_id' => ..., 'screen_id' => ...], ...], ...]
     */
    private function buildResolutionMap(string $orderLineId): array
    {
        $targets = OrderLineTarget::where('order_line_id', $orderLineId)->get();

        $resolutionMap = [];
        $seenScreenIds = [];

        foreach ($targets as $target) {
            if ($target->screen_id) {
                // Direct screen target
                $screen = Screen::withoutGlobalScopes()->find($target->screen_id);
                if ($screen && !in_array($screen->id, $seenScreenIds)) {
                    $key = $screen->resolution_width . 'x' . $screen->resolution_height;
                    $resolutionMap[$key][] = [
                        'target_id' => $target->id,
                        'screen_id' => $screen->id,
                    ];
                    $seenScreenIds[] = $screen->id;
                }
            } elseif ($target->screen_group_id) {
                // Group target: resolve all screens in the group
                $screens = Screen::withoutGlobalScopes()
                    ->where('group_id', $target->screen_group_id)
                    ->get();

                foreach ($screens as $screen) {
                    if (!in_array($screen->id, $seenScreenIds)) {
                        $key = $screen->resolution_width . 'x' . $screen->resolution_height;
                        $resolutionMap[$key][] = [
                            'target_id' => $target->id,
                            'screen_id' => $screen->id,
                        ];
                        $seenScreenIds[] = $screen->id;
                    }
                }
            }
        }

        return $resolutionMap;
    }
}
