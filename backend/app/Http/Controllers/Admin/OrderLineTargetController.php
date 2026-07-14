<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use App\Models\ScreenGroup;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class OrderLineTargetController extends Controller
{
    /**
     * Assign a screen or screen group to an order line.
     *
     * POST /api/admin/order-lines/{orderLineId}/targets
     */
    public function store(Request $request, string $orderLineId): JsonResponse
    {
        if (!Str::isUuid($orderLineId)) {
            return response()->json(['message' => 'Order line not found.'], 404);
        }

        $orderLine = OrderLine::find($orderLineId);

        if (!$orderLine) {
            return response()->json(['message' => 'Order line not found.'], 404);
        }

        // XOR validation: exactly one of screen_id or screen_group_id must be present
        $hasScreenId = $request->has('screen_id') && !is_null($request->input('screen_id'));
        $hasScreenGroupId = $request->has('screen_group_id') && !is_null($request->input('screen_group_id'));

        if ($hasScreenId && $hasScreenGroupId) {
            throw ValidationException::withMessages([
                'screen_id' => ['Exactly one of screen_id or screen_group_id must be provided, not both.'],
                'screen_group_id' => ['Exactly one of screen_id or screen_group_id must be provided, not both.'],
            ]);
        }

        if (!$hasScreenId && !$hasScreenGroupId) {
            throw ValidationException::withMessages([
                'screen_id' => ['One of screen_id or screen_group_id is required.'],
                'screen_group_id' => ['One of screen_id or screen_group_id is required.'],
            ]);
        }

        // Resolve the tenant_id from the order line's parent order
        $order = $orderLine->order;
        if (!$order) {
            return response()->json(['message' => 'Parent order not found.'], 404);
        }
        $tenantId = $order->tenant_id;

        // Validate and check tenant ownership
        $data = ['order_line_id' => $orderLineId];

        if ($hasScreenId) {
            $screenId = $request->input('screen_id');

            if (!Str::isUuid($screenId)) {
                throw ValidationException::withMessages([
                    'screen_id' => ['The selected screen_id is invalid.'],
                ]);
            }

            $screen = Screen::withoutGlobalScopes()->where('id', $screenId)->first();

            if (!$screen) {
                throw ValidationException::withMessages([
                    'screen_id' => ['The selected screen_id is invalid.'],
                ]);
            }

            if ($screen->tenant_id !== $tenantId) {
                throw ValidationException::withMessages([
                    'screen_id' => ['The selected screen does not belong to the same tenant.'],
                ]);
            }

            $data['screen_id'] = $screenId;
            $data['screen_group_id'] = null;
        }

        if ($hasScreenGroupId) {
            $screenGroupId = $request->input('screen_group_id');

            if (!Str::isUuid($screenGroupId)) {
                throw ValidationException::withMessages([
                    'screen_group_id' => ['The selected screen_group_id is invalid.'],
                ]);
            }

            $screenGroup = ScreenGroup::withoutGlobalScopes()->where('id', $screenGroupId)->first();

            if (!$screenGroup) {
                throw ValidationException::withMessages([
                    'screen_group_id' => ['The selected screen_group_id is invalid.'],
                ]);
            }

            if ($screenGroup->tenant_id !== $tenantId) {
                throw ValidationException::withMessages([
                    'screen_group_id' => ['The selected screen group does not belong to the same tenant.'],
                ]);
            }

            $data['screen_group_id'] = $screenGroupId;
            $data['screen_id'] = null;
        }

        // Validate resolution: all creatives must match the target screen resolution
        $this->validateCreativeResolutions($orderLine, $data);

        $target = OrderLineTarget::create($data);

        $target->load(['screen', 'screenGroup']);

        return response()->json(['data' => $target], 201);
    }

    /**
     * Validate that all creatives in the order line have resolutions matching
     * the screen(s) being assigned.
     */
    private function validateCreativeResolutions(OrderLine $orderLine, array $data): void
    {
        $creatives = $orderLine->creatives()->with('content')->get();

        if ($creatives->isEmpty()) {
            return; // No creatives to validate
        }

        // Resolve the screen resolutions to check against
        $screens = collect();

        if (!empty($data['screen_id'])) {
            $screen = Screen::withoutGlobalScopes()->find($data['screen_id']);
            if ($screen) {
                $screens->push($screen);
            }
        } elseif (!empty($data['screen_group_id'])) {
            $groupScreens = Screen::withoutGlobalScopes()
                ->where('group_id', $data['screen_group_id'])
                ->get();
            $screens = $groupScreens;
        }

        if ($screens->isEmpty()) {
            return;
        }

        foreach ($creatives as $creative) {
            $content = $creative->content;
            if (!$content || ($content->width === 0 && $content->height === 0)) {
                continue; // Skip content without resolution info (e.g., videos)
            }

            foreach ($screens as $screen) {
                if ($content->width !== $screen->resolution_width || $content->height !== $screen->resolution_height) {
                    throw ValidationException::withMessages([
                        'resolution' => [
                            "El creativo \"{$content->filename}\" ({$content->width}×{$content->height}) no coincide con la resolución de la pantalla \"{$screen->name}\" ({$screen->resolution_width}×{$screen->resolution_height})."
                        ],
                    ]);
                }
            }
        }
    }

    /**
     * Remove a target (unassign screen/group from order line).
     *
     * DELETE /api/admin/order-line-targets/{id}
     */
    public function destroy(string $id): JsonResponse
    {
        if (!Str::isUuid($id)) {
            return response()->json(['message' => 'Order line target not found.'], 404);
        }

        $target = OrderLineTarget::find($id);

        if (!$target) {
            return response()->json(['message' => 'Order line target not found.'], 404);
        }

        $target->delete();

        return response()->json(['message' => 'Target removed successfully.']);
    }
}
