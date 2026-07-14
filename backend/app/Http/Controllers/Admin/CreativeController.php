<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Content;
use App\Models\Creative;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class CreativeController extends Controller
{
    /**
     * List all creatives for a given order line target, including content relation.
     *
     * GET /api/admin/order-line-targets/{targetId}/creatives
     */
    public function index(string $targetId): JsonResponse
    {
        $target = $this->findTargetOrFail($targetId);

        if (!$target) {
            return response()->json(['message' => 'Order line target not found.'], 404);
        }

        $creatives = $target->creatives()->with('content')->get();

        return response()->json(['data' => $creatives]);
    }

    /**
     * Create a new creative for an order line target.
     *
     * POST /api/admin/order-line-targets/{targetId}/creatives
     *
     * Validates:
     * - content_id exists and belongs to same tenant
     * - content resolution matches the target's screen resolution exactly
     * - weight is integer >= 1
     */
    public function store(Request $request, string $targetId): JsonResponse
    {
        $target = $this->findTargetOrFail($targetId);

        if (!$target) {
            return response()->json(['message' => 'Order line target not found.'], 404);
        }

        $target->load('orderLine.order');

        $validated = $request->validate([
            'content_id' => ['required', 'string', 'exists:content,id'],
            'weight' => ['required', 'integer', 'min:1'],
        ], [
            'content_id.required' => 'El contenido es obligatorio.',
            'content_id.exists' => 'El contenido seleccionado no existe.',
            'weight.required' => 'El peso es obligatorio.',
            'weight.integer' => 'El peso debe ser un número entero.',
            'weight.min' => 'El peso debe ser al menos 1.',
        ]);

        // Validate content belongs to the same tenant
        $this->validateContentTenant($validated['content_id'], $target);

        // Validate content resolution matches the target's screen(s) resolution
        $this->validateContentResolution($validated['content_id'], $target);

        $validated['order_line_target_id'] = $target->id;

        // Creative creation triggers CreativeObserver which dispatches ManifestRecalculation
        $creative = Creative::create($validated);

        return response()->json(['data' => $creative->load('content')], 201);
    }

    /**
     * Update an existing creative.
     *
     * PUT /api/admin/creatives/{id}
     *
     * Validates same rules as store when content_id changes.
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $creative = $this->findCreativeOrFail($id);

        if (!$creative) {
            return response()->json(['message' => 'Creative not found.'], 404);
        }

        $validated = $request->validate([
            'content_id' => ['sometimes', 'required', 'string', 'exists:content,id'],
            'weight' => ['sometimes', 'required', 'integer', 'min:1'],
        ]);

        // If content_id is being updated, validate tenant and resolution
        if (isset($validated['content_id'])) {
            $creative->load('orderLineTarget.orderLine.order');
            $target = $creative->orderLineTarget;

            if ($target) {
                $this->validateContentTenant($validated['content_id'], $target);
                $this->validateContentResolution($validated['content_id'], $target);
            }
        }

        // Creative update triggers CreativeObserver which dispatches ManifestRecalculation
        // if relevant fields changed
        $creative->update($validated);

        return response()->json(['data' => $creative->fresh()->load('content')]);
    }

    /**
     * Delete a creative.
     *
     * DELETE /api/admin/creatives/{id}
     *
     * CreativeObserver dispatches ManifestRecalculation on delete.
     */
    public function destroy(string $id): JsonResponse
    {
        $creative = $this->findCreativeOrFail($id);

        if (!$creative) {
            return response()->json(['message' => 'Creative not found.'], 404);
        }

        $creative->delete();

        return response()->json(['message' => 'Creative deleted successfully.']);
    }

    /**
     * Find an order line target ensuring it belongs to a tenant-scoped order.
     */
    private function findTargetOrFail(string $targetId): ?OrderLineTarget
    {
        return OrderLineTarget::whereHas('orderLine.order', function ($query) {
            // Order has BelongsToTenant, so its global scope applies here
        })->find($targetId);
    }

    /**
     * Find a creative ensuring its order line target belongs to a tenant-scoped order.
     */
    private function findCreativeOrFail(string $id): ?Creative
    {
        return Creative::whereHas('orderLineTarget.orderLine.order', function ($query) {
            // Order has BelongsToTenant, so its global scope applies here
        })->find($id);
    }

    /**
     * Validate that the content belongs to the same tenant as the target's order.
     *
     * @throws ValidationException
     */
    private function validateContentTenant(string $contentId, OrderLineTarget $target): void
    {
        $order = $target->orderLine->order ?? $target->load('orderLine.order')->orderLine->order;
        $content = Content::withoutGlobalScopes()->find($contentId);

        if (!$content || $content->tenant_id !== $order->tenant_id) {
            throw ValidationException::withMessages([
                'content_id' => ['The selected content does not belong to the same tenant.'],
            ]);
        }
    }

    /**
     * Validate that the content resolution matches the target's screen resolution exactly.
     *
     * For targets with screen_id: validates against that single screen.
     * For targets with screen_group_id: validates against all screens in the group.
     *
     * @throws ValidationException
     */
    private function validateContentResolution(string $contentId, OrderLineTarget $target): void
    {
        $content = Content::withoutGlobalScopes()->find($contentId);

        if (!$content) {
            return;
        }

        // Reject content without dimensions (legacy content needing re-processing)
        if (is_null($content->width) || is_null($content->height)) {
            throw ValidationException::withMessages([
                'content_id' => [
                    'El contenido no tiene dimensiones registradas. Requiere re-procesamiento para extraer sus dimensiones.',
                ],
            ]);
        }

        if ($target->screen_id) {
            $screen = Screen::withoutGlobalScopes()->find($target->screen_id);
            if ($screen) {
                $this->assertResolutionMatch($content, $screen);
            }
        } elseif ($target->screen_group_id) {
            $screens = Screen::withoutGlobalScopes()
                ->where('group_id', $target->screen_group_id)
                ->get();

            foreach ($screens as $screen) {
                $this->assertResolutionMatch($content, $screen);
            }
        }
    }

    /**
     * Assert that content dimensions match screen resolution exactly.
     *
     * @throws ValidationException
     */
    private function assertResolutionMatch(Content $content, Screen $screen): void
    {
        if ($content->width !== $screen->resolution_width || $content->height !== $screen->resolution_height) {
            throw ValidationException::withMessages([
                'content_id' => [
                    "El contenido es {$content->width}×{$content->height} pero la pantalla \"{$screen->name}\" requiere {$screen->resolution_width}×{$screen->resolution_height}.",
                ],
            ]);
        }
    }
}
