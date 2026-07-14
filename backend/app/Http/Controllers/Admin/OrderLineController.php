<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\OrderLine;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class OrderLineController extends Controller
{
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
            'share_weight' => ['required', 'integer', 'min:1'],
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
        $order = Order::find($orderLine->order_id);
        if (!$order) {
            return response()->json(['message' => 'Order line not found.'], 404);
        }

        return response()->json(['data' => $orderLine]);
    }

    /**
     * Update an existing order line.
     *
     * PUT /api/admin/order-lines/{id}
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $orderLine = OrderLine::find($id);

        if (!$orderLine) {
            return response()->json(['message' => 'Order line not found.'], 404);
        }

        // Tenant scoping: verify the parent order belongs to the current tenant
        $order = Order::find($orderLine->order_id);
        if (!$order) {
            return response()->json(['message' => 'Order line not found.'], 404);
        }

        $validated = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'priority_tier' => ['sometimes', 'required', Rule::in(['patrocinio', 'estandar', 'red_interna'])],
            'starts_at' => ['sometimes', 'required', 'date'],
            'ends_at' => ['sometimes', 'required', 'date', 'after_or_equal:starts_at'],
            'target_spots' => ['sometimes', 'required', 'integer', 'min:1'],
            'delivery_pace' => ['sometimes', 'required', Rule::in(['asap', 'uniform'])],
            'share_weight' => ['sometimes', 'required', 'integer', 'min:1'],
            'status' => ['sometimes', 'required', Rule::in(['draft', 'active', 'paused', 'finished'])],
            'active_dates' => ['sometimes', 'nullable', 'array'],
            'active_dates.*' => ['required', 'string', 'date_format:Y-m-d'],
        ]);

        // The OrderLineObserver handles date containment validation on update
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
        $order = Order::find($orderLine->order_id);
        if (!$order) {
            return response()->json(['message' => 'Order line not found.'], 404);
        }

        $orderLine->delete();

        return response()->json(['message' => 'Order line deleted successfully.']);
    }
}
