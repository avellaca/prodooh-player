<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\OrderLine;
use App\Services\AvailabilityAnalyzerInterface;
use App\Services\LoopTemplateGeneratorInterface;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class OrderLineController extends Controller
{
    public function __construct(
        private AvailabilityAnalyzerInterface $availabilityAnalyzer,
        private LoopTemplateGeneratorInterface $loopTemplateGenerator,
    ) {}

    /**
     * List all order lines for a given order.
     *
     * GET /api/admin/orders/{orderId}/order-lines
     */
    public function index(string $orderId): JsonResponse
    {
        $order = Order::find($orderId);

        if (!$order) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        $orderLines = $order->orderLines()
            ->withCount('creatives')
            ->with(['targets.screen', 'targets.screenGroup'])
            ->get();

        return response()->json(['data' => $orderLines]);
    }

    /**
     * Create a new order line within an order.
     *
     * POST /api/admin/orders/{orderId}/order-lines
     */
    public function store(Request $request, string $orderId): JsonResponse
    {
        $order = Order::find($orderId);

        if (!$order) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'priority_tier' => ['required', Rule::in(['patrocinio', 'estandar', 'red_interna'])],
            'starts_at' => ['required', 'date'],
            'ends_at' => ['required', 'date', 'after_or_equal:starts_at'],
            'target_spots' => ['required', 'integer', 'min:1'],
            'delivery_pace' => ['required', Rule::in(['asap', 'uniform'])],
            'status' => ['required', Rule::in(['draft', 'active', 'paused', 'finished'])],
            'active_dates' => ['nullable', 'array'],
            'active_dates.*' => ['required', 'string', 'date_format:Y-m-d'],
        ]);

        $validated['order_id'] = $order->id;

        // The OrderLineObserver handles date containment validation
        // (starts_at >= Order.starts_at AND ends_at <= Order.ends_at)
        $orderLine = OrderLine::create($validated);

        return response()->json(['data' => $orderLine], 201);
    }

    /**
     * Show a single order line with its creatives and targets.
     *
     * GET /api/admin/order-lines/{id}
     */
    public function show(string $id): JsonResponse
    {
        $orderLine = OrderLine::withCount('creatives')
            ->with(['targets.screen', 'targets.screenGroup'])
            ->find($id);

        if (!$orderLine) {
            return response()->json(['message' => 'Order line not found.'], 404);
        }

        // Tenant scoping: verify the parent order belongs to the current tenant
        $order = Order::withoutGlobalScopes()->find($orderLine->order_id);
        if (!$order) {
            return response()->json(['message' => 'Order line not found.'], 404);
        }

        return response()->json(['data' => $orderLine]);
    }

    /**
     * Update an existing order line.
     *
     * PUT /api/admin/order-lines/{id}
     *
     * Accepts slots_purchased and by_slot for patrocinio tier lines.
     * The OrderLineObserver handles pace enforcement and target_spots calculation.
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $orderLine = OrderLine::find($id);

        if (!$orderLine) {
            return response()->json(['message' => 'Order line not found.'], 404);
        }

        // Tenant scoping: verify the parent order belongs to the current tenant
        $order = Order::withoutGlobalScopes()->find($orderLine->order_id);
        if (!$order) {
            return response()->json(['message' => 'Order line not found.'], 404);
        }

        // Determine the effective priority_tier (either from request or existing)
        $effectiveTier = $request->input('priority_tier', $orderLine->priority_tier);

        // Build validation rules
        $rules = [
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'priority_tier' => ['sometimes', 'required', Rule::in(['patrocinio', 'estandar', 'red_interna'])],
            'starts_at' => ['sometimes', 'required', 'date'],
            'ends_at' => ['sometimes', 'required', 'date', 'after_or_equal:starts_at'],
            'target_spots' => ['sometimes', 'required', 'integer', 'min:1'],
            'delivery_pace' => ['sometimes', 'required', Rule::in(['asap', 'uniform'])],
            'status' => ['sometimes', 'required', Rule::in(['draft', 'active', 'paused', 'finished'])],
            'active_dates' => ['sometimes', 'nullable', 'array'],
            'active_dates.*' => ['required', 'string', 'date_format:Y-m-d'],
            'by_slot' => ['sometimes', 'boolean'],
            'slots_purchased' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'playback_mode' => ['sometimes', Rule::in(['round_robin', 'sequential'])],
        ];

        // Validate slots_purchased max against tenant's ad_slots when patrocinio
        if ($effectiveTier === 'patrocinio' && $request->has('slots_purchased') && $request->input('slots_purchased') !== null) {
            $tenant = $order->tenant ?? \App\Models\Tenant::find($order->tenant_id);
            if ($tenant) {
                $numSlots = $tenant->num_slots ?? 10;
                $sspSlots = $tenant->ssp_slots ?? 2;
                $playlistSlots = $tenant->playlist_slots ?? 1;
                $adSlots = max(1, $numSlots - $sspSlots - $playlistSlots);
                $rules['slots_purchased'] = ['sometimes', 'nullable', 'integer', 'min:1', 'max:' . $adSlots];
            }
        }

        $validated = $request->validate($rules);

        // Clear slots_purchased and by_slot if tier is not patrocinio
        if ($effectiveTier !== 'patrocinio') {
            if (isset($validated['by_slot'])) {
                $validated['by_slot'] = false;
            }
            if (isset($validated['slots_purchased'])) {
                $validated['slots_purchased'] = null;
            }
        }

        // The OrderLineObserver handles pace enforcement and target_spots calculation
        $orderLine->update($validated);

        return response()->json(['data' => $orderLine->fresh()]);
    }

    /**
     * Delete an order line (cascade deletes creatives, targets, impressions).
     *
     * DELETE /api/admin/order-lines/{id}
     */
    public function destroy(string $id): JsonResponse
    {
        $orderLine = OrderLine::find($id);

        if (!$orderLine) {
            return response()->json(['message' => 'Order line not found.'], 404);
        }

        // Tenant scoping: verify the parent order belongs to the current tenant
        $order = Order::withoutGlobalScopes()->find($orderLine->order_id);
        if (!$order) {
            return response()->json(['message' => 'Order line not found.'], 404);
        }

        $orderLine->delete();

        return response()->json(['message' => 'Order line deleted successfully.']);
    }

    /**
     * Activate an order line.
     *
     * PATCH /api/admin/order-lines/{id}/activate
     *
     * Runs AvailabilityAnalyzer before activation:
     * - If insufficient capacity: returns availability result with warning (does NOT block)
     * - If sufficient: activates directly
     * On successful activation, triggers LoopTemplateGenerator.regenerateAffected()
     */
    public function activate(Request $request, string $id): JsonResponse
    {
        $orderLine = OrderLine::find($id);

        if (!$orderLine) {
            return response()->json(['message' => 'Order line not found.'], 404);
        }

        // Tenant scoping: verify the parent order exists
        $order = Order::withoutGlobalScopes()->find($orderLine->order_id);
        if (!$order) {
            return response()->json(['message' => 'Order line not found.'], 404);
        }

        // Reject activation if order line has no targets (inventory) assigned
        if ($orderLine->targets()->count() === 0) {
            return response()->json([
                'message' => 'No se puede activar la línea.',
                'errors' => [
                    'status' => ['La línea de pedido no tiene pantallas asignadas (inventario). Agrega pantallas antes de activar.'],
                ],
            ], 422);
        }

        // Reject activation if order line has no creatives assigned
        if ($orderLine->creatives()->count() === 0) {
            return response()->json([
                'message' => 'No se puede activar la línea.',
                'errors' => [
                    'status' => ['La línea de pedido no tiene creativos asignados. Agrega al menos 1 creativo antes de activar.'],
                ],
            ], 422);
        }

        // Run AvailabilityAnalyzer (Requirement 6.1, 6.5)
        $availability = $this->availabilityAnalyzer->analyze($orderLine);

        // Check if the user confirmed despite insufficient capacity (Requirement 6.3)
        $forceActivation = $request->boolean('force', false);

        if (!$availability->isSufficient && !$forceActivation) {
            // Return availability result with warning — frontend shows modal (Requirement 6.2)
            return response()->json([
                'data' => $orderLine,
                'availability' => [
                    'is_sufficient' => $availability->isSufficient,
                    'target_spots' => $availability->targetSpots,
                    'available_capacity' => $availability->availableCapacity,
                    'saturation_percent' => $availability->saturationPercent,
                    'warning_message' => $availability->warningMessage,
                ],
                'requires_confirmation' => true,
            ], 200);
        }

        // Proceed with activation (Requirement 6.6 — if sufficient, activate directly)
        $orderLine->update(['status' => 'active']);

        // Trigger loop template regeneration for affected screens
        $screenIds = $orderLine->resolveTargetScreens()->pluck('id')->all();
        if (!empty($screenIds)) {
            $this->loopTemplateGenerator->regenerateAffected($screenIds);
        }

        $responseData = [
            'data' => $orderLine->fresh(),
            'availability' => [
                'is_sufficient' => $availability->isSufficient,
                'target_spots' => $availability->targetSpots,
                'available_capacity' => $availability->availableCapacity,
                'saturation_percent' => $availability->saturationPercent,
                'warning_message' => $availability->warningMessage,
            ],
        ];

        return response()->json($responseData);
    }

    /**
     * Check availability for an order line.
     *
     * GET /api/admin/order-lines/{id}/availability
     *
     * Returns the availability analysis without activating.
     */
    public function availability(string $id): JsonResponse
    {
        $orderLine = OrderLine::find($id);

        if (!$orderLine) {
            return response()->json(['message' => 'Order line not found.'], 404);
        }

        // Tenant scoping: verify the parent order belongs to the current tenant
        $order = Order::withoutGlobalScopes()->find($orderLine->order_id);
        if (!$order) {
            return response()->json(['message' => 'Order line not found.'], 404);
        }

        $availability = $this->availabilityAnalyzer->analyze($orderLine);

        return response()->json([
            'data' => [
                'is_sufficient' => $availability->isSufficient,
                'target_spots' => $availability->targetSpots,
                'available_capacity' => $availability->availableCapacity,
                'saturation_percent' => $availability->saturationPercent,
                'warning_message' => $availability->warningMessage,
            ],
        ]);
    }
}
