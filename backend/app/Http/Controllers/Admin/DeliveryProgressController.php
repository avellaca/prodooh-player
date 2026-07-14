<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Impression;
use App\Models\Order;
use App\Models\OrderLine;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;

class DeliveryProgressController extends Controller
{
    /**
     * GET /api/admin/orders/{orderId}/delivery-progress
     *
     * Returns delivery progress for each order line in the order.
     */
    public function show(string $orderId): JsonResponse
    {
        $order = Order::with('orderLines')->find($orderId);

        if (!$order) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        $today = Carbon::today()->toDateString();

        $lines = $order->orderLines->map(function (OrderLine $line) use ($today) {
            // Get all screens targeted by this line
            $screenIds = $this->getTargetedScreenIds($line);
            $screenCount = max(1, count($screenIds));

            // Per-screen average delivery
            $totalDeliveredAllScreens = Impression::where('order_line_id', $line->id)
                ->where('result', 'success')
                ->count();

            $todayDeliveredAllScreens = Impression::where('order_line_id', $line->id)
                ->where('result', 'success')
                ->whereDate('started_at', $today)
                ->count();

            // Average per screen
            $avgDeliveredPerScreen = $screenCount > 0 ? round($totalDeliveredAllScreens / $screenCount) : 0;
            $avgTodayPerScreen = $screenCount > 0 ? round($todayDeliveredAllScreens / $screenCount) : 0;

            // Calculate daily budget (per-screen)
            $dailyBudget = null;
            if (!is_null($line->target_spots)) {
                $remaining = max(0, $line->target_spots - $avgDeliveredPerScreen);
                if ($line->delivery_pace === 'asap') {
                    $dailyBudget = $remaining;
                } else {
                    $endsAt = Carbon::parse($line->ends_at)->startOfDay();
                    $remainingDays = max(1, Carbon::today()->diffInDays($endsAt) + 1);
                    $dailyBudget = (int) ceil($remaining / $remainingDays);
                }
            }

            return [
                'order_line_id' => $line->id,
                'name' => $line->name,
                'target_spots' => $line->target_spots,
                'screen_count' => $screenCount,
                'total_delivered' => $totalDeliveredAllScreens,
                'avg_delivered_per_screen' => $avgDeliveredPerScreen,
                'today_delivered' => $todayDeliveredAllScreens,
                'avg_today_per_screen' => $avgTodayPerScreen,
                'daily_budget' => $dailyBudget,
                'total_progress' => $line->target_spots
                    ? min(100, round(($avgDeliveredPerScreen / $line->target_spots) * 100, 1))
                    : null,
                'today_progress' => $dailyBudget && $dailyBudget > 0
                    ? min(100, round(($avgTodayPerScreen / $dailyBudget) * 100, 1))
                    : null,
            ];
        });

        // Order-level totals
        $totalTarget = $order->orderLines->sum('target_spots');
        $totalDelivered = $lines->sum('total_delivered');

        return response()->json([
            'data' => [
                'order_id' => $order->id,
                'total_target' => $totalTarget,
                'total_delivered' => $totalDelivered,
                'total_progress' => $totalTarget > 0
                    ? min(100, round(($totalDelivered / $totalTarget) * 100, 1))
                    : null,
                'lines' => $lines->values()->all(),
            ],
        ]);
    }

    /**
     * Get all screen IDs targeted by an order line (direct + via groups).
     */
    private function getTargetedScreenIds(OrderLine $line): array
    {
        $screenIds = [];
        $targets = $line->targets()->get();

        foreach ($targets as $target) {
            if ($target->screen_id) {
                $screenIds[] = $target->screen_id;
            } elseif ($target->screen_group_id) {
                $groupScreenIds = \App\Models\Screen::withoutGlobalScopes()
                    ->where('group_id', $target->screen_group_id)
                    ->pluck('id')
                    ->all();
                $screenIds = array_merge($screenIds, $groupScreenIds);
            }
        }

        return array_unique($screenIds);
    }
}
