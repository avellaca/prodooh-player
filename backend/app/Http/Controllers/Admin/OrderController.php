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
        $orders = Order::withCount('orderLines')->get();

        return response()->json(['data' => $orders]);
    }

    /**
     * Create a new order.
     *
     * POST /api/admin/orders
     */
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();

        $rules = [
            'name' => ['required', 'string', 'max:255'],
            'advertiser_name' => ['nullable', 'string', 'max:255'],
            'starts_at' => ['required', 'date'],
            'ends_at' => ['required', 'date', 'after_or_equal:starts_at'],
            'status' => ['required', Rule::in(['draft', 'active', 'paused', 'finished'])],
        ];

        // Super-admin must provide tenant_id (via interceptor query param or body)
        if ($user->isSuperAdmin()) {
            if (!$request->input('tenant_id') && $request->query('tenant_id')) {
                $request->merge(['tenant_id' => $request->query('tenant_id')]);
            }
            $rules['tenant_id'] = ['required', 'string', 'exists:tenants,id'];
        }

        $validated = $request->validate($rules);

        // Tenant-admin: assign their own tenant_id implicitly
        if ($user->isTenantAdmin()) {
            $validated['tenant_id'] = $user->tenant_id;
        }

        $order = Order::create($validated);

        return response()->json(['data' => $order], 201);
    }

    /**
     * Show a single order with relationships.
     *
     * GET /api/admin/orders/{id}
     */
    public function show(string $id): JsonResponse
    {
        if (!Str::isUuid($id)) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        $order = Order::withCount('orderLines')->find($id);

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
            'starts_at' => ['sometimes', 'required', 'date'],
            'ends_at' => ['sometimes', 'required', 'date', 'after_or_equal:starts_at'],
            'status' => ['sometimes', 'required', Rule::in(['draft', 'active', 'paused', 'finished'])],
        ]);

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
}
