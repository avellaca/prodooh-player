<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Order;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class OrderController extends Controller
{
    /**
     * List all orders for the current tenant scope.
     *
     * GET /api/admin/orders
     */
    public function index(): JsonResponse
    {
        $orders = Order::with('advertiser')->withCount('orderLines')->get();

        return response()->json(['data' => $orders]);
    }

    /**
     * Create a new order.
     *
     * POST /api/admin/orders
     *
     * Only accepts: name, advertiser_name.
     * Dates (starts_at, ends_at) are computed dynamically from order_lines.
     * Status is auto-assigned as "draft".
     */
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();

        $rules = [
            'name' => ['required', 'string', 'max:255'],
            'advertiser_id' => ['nullable', 'uuid', 'exists:advertisers,id'],
            'advertiser_name' => ['nullable', 'string', 'max:255'],
        ];

        // Super-admin must provide tenant_id (via interceptor query param or body)
        if ($user->isSuperAdmin()) {
            if (!$request->input('tenant_id') && $request->query('tenant_id')) {
                $request->merge(['tenant_id' => $request->query('tenant_id')]);
            }
            $rules['tenant_id'] = ['required', 'string', 'exists:tenants,id'];
        }

        $validated = $request->validate($rules);

        // Tenant-admin or trafficker: assign their own tenant_id implicitly
        if ($user->isTenantAdmin() || $user->isTrafficker()) {
            $validated['tenant_id'] = $user->tenant_id;
        }

        // Status defaults to 'draft' via the Order model's booted() method.
        // starts_at and ends_at are computed accessors (not stored columns).
        $order = Order::create($validated);

        return response()->json(['data' => $order], 201);
    }

    /**
     * Show a single order with relationships.
     *
     * GET /api/admin/orders/{id}
     *
     * starts_at and ends_at are computed dynamically as MIN/MAX from order_lines.
     */
    public function show(string $id): JsonResponse
    {
        if (!Str::isUuid($id)) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        $order = Order::with(['orderLines', 'advertiser'])
            ->withCount('orderLines')
            ->find($id);

        if (!$order) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        return response()->json(['data' => $order]);
    }

    /**
     * Update an existing order.
     *
     * PUT /api/admin/orders/{id}
     */
    public function update(Request $request, string $id): JsonResponse
    {
        if (!Str::isUuid($id)) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        $order = Order::find($id);

        if (!$order) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        $validated = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'advertiser_name' => ['nullable', 'string', 'max:255'],
            'status' => ['sometimes', 'required', Rule::in(['draft', 'active', 'paused', 'finished'])],
        ]);

        // Reject activation if order has no OrderLine with at least 1 Creative assigned
        if (isset($validated['status']) && $validated['status'] === 'active') {
            $hasLineWithCreative = $order->orderLines()
                ->whereHas('creatives')
                ->exists();

            if (!$hasLineWithCreative) {
                return response()->json([
                    'message' => 'No se puede activar el pedido.',
                    'errors' => [
                        'status' => ['El pedido no tiene al menos 1 línea de pedido con al menos 1 creativo asignado. Agrega creativos antes de activar.'],
                    ],
                ], 422);
            }
        }

        $order->update($validated);

        return response()->json(['data' => $order->fresh()]);
    }

    /**
     * Delete an order (cascade deletes order lines, creatives, targets).
     *
     * DELETE /api/admin/orders/{id}
     */
    public function destroy(string $id): JsonResponse
    {
        if (!Str::isUuid($id)) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        $order = Order::find($id);

        if (!$order) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        $order->delete();

        return response()->json(['message' => 'Order deleted successfully.']);
    }

    /**
     * Activate an order.
     *
     * PATCH /api/admin/orders/{id}/activate
     */
    public function activate(Request $request, string $id): JsonResponse
    {
        if (!Str::isUuid($id)) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        $order = Order::find($id);

        if (!$order) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        // Reject activation if order has no OrderLine with at least 1 Creative assigned
        $hasLineWithCreative = $order->orderLines()
            ->whereHas('creatives')
            ->exists();

        if (!$hasLineWithCreative) {
            return response()->json([
                'message' => 'No se puede activar el pedido.',
                'errors' => [
                    'status' => ['El pedido no tiene al menos 1 línea de pedido con al menos 1 creativo asignado. Agrega creativos antes de activar.'],
                ],
            ], 422);
        }

        $order->update(['status' => 'active']);

        return response()->json(['data' => $order->fresh()]);
    }
}
