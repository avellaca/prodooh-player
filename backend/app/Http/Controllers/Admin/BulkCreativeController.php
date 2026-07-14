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

class BulkCreativeController extends Controller
{
    /**
     * POST /api/admin/order-lines/{orderLineId}/creatives/bulk-by-resolution
     *
     * Creates a creative for each target of the order line whose screen
     * matches the requested resolution exactly.
     *
     * Request body:
     * {
     *   "content_id": "uuid",
     *   "resolution_width": 1920,
     *   "resolution_height": 1080,
     *   "weight": 100
     * }
     *
     * Validations:
     * - content_id: required, exists in content table, same tenant
     * - resolution_width/height: required, integer, min:1
     * - weight: required, integer, min:1
     * - Content.width === resolution_width AND Content.height === resolution_height
     * - At least one target with screen of the requested resolution exists (else 422)
     *
     * Creates in transaction. Dispatches ManifestRecalculation for each affected screen
     * (handled by CreativeObserver on creative creation).
     *
     * Response 201:
     * { "data": { "creatives_created": N, "affected_screens": ["uuid", ...] } }
     */
    public function bulkByResolution(Request $request, string $orderLineId): JsonResponse
    {
        // Validate order line exists and is accessible
        if (!Str::isUuid($orderLineId)) {
            return response()->json(['message' => 'Order line not found.'], 404);
        }

        $orderLine = OrderLine::with(['order' => fn($q) => $q->withoutGlobalScopes()])->find($orderLineId);

        if (!$orderLine) {
            return response()->json(['message' => 'Order line not found.'], 404);
        }

        // Validate request body
        $validated = $request->validate([
            'content_id' => ['required', 'string', 'exists:content,id'],
            'resolution_width' => ['required', 'integer', 'min:1'],
            'resolution_height' => ['required', 'integer', 'min:1'],
            'weight' => ['required', 'integer', 'min:1'],
        ], [
            'content_id.required' => 'El contenido es obligatorio.',
            'content_id.exists' => 'El contenido seleccionado no existe.',
            'weight.required' => 'El peso es obligatorio.',
            'weight.integer' => 'El peso debe ser un número entero.',
            'weight.min' => 'El peso debe ser al menos 1.',
        ]);

        // Validate content belongs to the same tenant
        $content = Content::withoutGlobalScopes()->find($validated['content_id']);

        if (!$content || $content->tenant_id !== $orderLine->order->tenant_id) {
            throw ValidationException::withMessages([
                'content_id' => ['The selected content does not belong to the same tenant.'],
            ]);
        }

        // Validate content has dimensions
        if (is_null($content->width) || is_null($content->height)) {
            throw ValidationException::withMessages([
                'content_id' => [
                    'El contenido no tiene dimensiones registradas. Requiere re-procesamiento para extraer sus dimensiones.',
                ],
            ]);
        }

        // Validate content resolution matches requested resolution exactly
        if ($content->width !== $validated['resolution_width'] || $content->height !== $validated['resolution_height']) {
            throw ValidationException::withMessages([
                'content_id' => [
                    "El contenido es {$content->width}×{$content->height} pero la resolución solicitada es {$validated['resolution_width']}×{$validated['resolution_height']}.",
                ],
            ]);
        }

        // Find targets whose screen matches the requested resolution
        $matchingTargets = $this->findMatchingTargets(
            $orderLineId,
            $validated['resolution_width'],
            $validated['resolution_height']
        );

        // Reject with 422 if no matching targets
        if ($matchingTargets->isEmpty()) {
            throw ValidationException::withMessages([
                'resolution_width' => [
                    "No hay pantallas con resolución {$validated['resolution_width']}×{$validated['resolution_height']} asignadas a esta línea de pedido.",
                ],
            ]);
        }

        // Create creatives in transaction (atomicity: if one fails, none are created)
        // The CreativeObserver will dispatch ManifestRecalculation for each created creative
        $creatives = DB::transaction(function () use ($matchingTargets, $validated) {
            $created = [];

            foreach ($matchingTargets as $entry) {
                $creative = Creative::create([
                    'order_line_target_id' => $entry['target_id'],
                    'content_id' => $validated['content_id'],
                    'weight' => $validated['weight'],
                    'resolution_width' => $validated['resolution_width'],
                    'resolution_height' => $validated['resolution_height'],
                ]);

                $created[] = $creative;
            }

            return $created;
        });

        // Collect affected screen IDs
        $affectedScreens = $matchingTargets->pluck('screen_id')->unique()->values()->all();

        return response()->json([
            'data' => [
                'creatives_created' => count($creatives),
                'affected_screens' => $affectedScreens,
            ],
        ], 201);
    }

    /**
     * Find targets of the order line whose screen matches the given resolution.
     *
     * For group targets, returns the group target_id — the creative will be stored
     * with resolution_width/height metadata to scope it to matching screens only.
     *
     * Returns a collection of ['target_id' => string, 'screen_id' => string].
     */
    private function findMatchingTargets(string $orderLineId, int $width, int $height): \Illuminate\Support\Collection
    {
        $targets = OrderLineTarget::where('order_line_id', $orderLineId)->get();

        $matchingEntries = collect();
        $seenTargetIds = [];

        foreach ($targets as $target) {
            if ($target->screen_id) {
                // Direct screen target
                $screen = Screen::withoutGlobalScopes()->find($target->screen_id);
                if ($screen && $screen->resolution_width === $width && $screen->resolution_height === $height) {
                    if (!in_array($target->id, $seenTargetIds)) {
                        $matchingEntries->push([
                            'target_id' => $target->id,
                            'screen_id' => $screen->id,
                        ]);
                        $seenTargetIds[] = $target->id;
                    }
                }
            } elseif ($target->screen_group_id) {
                // Group target: check if any screen in the group matches
                $hasMatch = Screen::withoutGlobalScopes()
                    ->where('group_id', $target->screen_group_id)
                    ->where('resolution_width', $width)
                    ->where('resolution_height', $height)
                    ->exists();

                if ($hasMatch && !in_array($target->id, $seenTargetIds)) {
                    $matchingEntries->push([
                        'target_id' => $target->id,
                        'screen_id' => null,
                    ]);
                    $seenTargetIds[] = $target->id;
                }
            }
        }

        return $matchingEntries;
    }
}
