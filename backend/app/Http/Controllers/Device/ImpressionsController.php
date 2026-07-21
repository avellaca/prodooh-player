<?php

namespace App\Http\Controllers\Device;

use App\Http\Controllers\Controller;
use App\Jobs\FireTrackingPixelJob;
use App\Jobs\RecalculateManifestJob;
use App\Models\Creative;
use App\Models\Impression;
use App\Models\OrderLine;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class ImpressionsController extends Controller
{
    /**
     * POST /api/device/impressions
     *
     * Receive a batch of impression reports from the device.
     */
    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'impressions' => 'required|array|min:1',
            'impressions.*.order_line_id' => 'required|uuid',
            'impressions.*.creative_id' => 'nullable|uuid',
            'impressions.*.started_at' => 'required|date',
            'impressions.*.ended_at' => 'nullable|date',
            'impressions.*.duration_seconds' => 'required|numeric|min:0',
            'impressions.*.result' => 'required|in:success,failed',
            'impressions.*.failure_reason' => 'nullable|string',
            'impressions.*.mode' => 'nullable|string|in:normal,witness',
        ]);

        $screenId = $request->attributes->get('screen_id');
        $impressions = $request->input('impressions');
        $createdImpressions = [];

        foreach ($impressions as $impression) {
            // Deduplicate: skip if same screen + order_line + started_at already exists
            $exists = Impression::where('screen_id', $screenId)
                ->where('order_line_id', $impression['order_line_id'])
                ->where('started_at', $impression['started_at'])
                ->exists();

            if ($exists) {
                continue;
            }

            $created = Impression::create([
                'screen_id' => $screenId,
                'order_line_id' => $impression['order_line_id'],
                'creative_id' => $impression['creative_id'] ?? null,
                'source' => 'order_line',
                'started_at' => $impression['started_at'],
                'ended_at' => $impression['ended_at'] ?? null,
                'duration_seconds' => $impression['duration_seconds'],
                'result' => $impression['result'],
                'failure_reason' => $impression['failure_reason'] ?? null,
                'mode' => $impression['mode'] ?? 'normal',
            ]);

            $createdImpressions[] = $created;
        }

        // Dispatch tracking pixels for each newly created impression
        foreach ($createdImpressions as $createdImpression) {
            $this->dispatchTrackingPixels($createdImpression);
        }

        // Check if any order line just reached its per-screen target → recalculate manifest
        $orderLineIds = collect($impressions)->pluck('order_line_id')->unique();
        $needsRecalc = false;

        foreach ($orderLineIds as $orderLineId) {
            $line = OrderLine::find($orderLineId);
            if (!$line || is_null($line->target_spots)) continue;

            // Per-screen delivery check
            $deliveredOnScreen = Impression::where('order_line_id', $orderLineId)
                ->where('screen_id', $screenId)
                ->where('result', 'success')
                ->count();

            // Per-screen daily budget
            $remaining = max(0, $line->target_spots - $deliveredOnScreen);
            if ($line->delivery_pace === 'uniform') {
                $remainingDays = max(1, now()->diffInDays($line->ends_at) + 1);
                $dailyBudget = (int) ceil($remaining / $remainingDays);
            } else {
                $dailyBudget = $remaining;
            }

            // Today's delivery on this screen
            $todayOnScreen = Impression::where('order_line_id', $orderLineId)
                ->where('screen_id', $screenId)
                ->where('result', 'success')
                ->whereDate('started_at', now()->toDateString())
                ->count();

            // Trigger recalc if per-screen total exhausted OR daily budget on this screen exhausted
            if ($deliveredOnScreen >= $line->target_spots || $todayOnScreen >= $dailyBudget) {
                $needsRecalc = true;
                break;
            }
        }

        if ($needsRecalc) {
            RecalculateManifestJob::dispatch($screenId, true)->afterCommit();
        }

        Log::info('Impressions received', [
            'screen_id' => $screenId,
            'count' => count($impressions),
            'recalc_triggered' => $needsRecalc,
        ]);

        return response()->json(['ack' => true, 'count' => count($impressions)], 201);
    }

    /**
     * Collect tracking pixels from Order, OrderLine, and Creative levels,
     * filter by trigger_type 'impression', and dispatch a FireTrackingPixelJob for each.
     */
    private function dispatchTrackingPixels(Impression $impression): void
    {
        if (!$impression->creative_id) {
            return;
        }

        $creative = Creative::find($impression->creative_id);
        if (!$creative) {
            return;
        }

        $orderLine = OrderLine::find($impression->order_line_id);
        $order = $orderLine?->order;

        // Collect pixels from all three levels
        $pixels = collect();

        if ($order) {
            $pixels = $pixels->merge($order->trackingPixels);
        }
        if ($orderLine) {
            $pixels = $pixels->merge($orderLine->trackingPixels);
        }
        $pixels = $pixels->merge($creative->trackingPixels);

        // Filter by trigger_type matching the event
        $matchingPixels = $pixels->where('trigger_type', 'impression');

        foreach ($matchingPixels as $pixel) {
            FireTrackingPixelJob::dispatch(
                pixelUrl: $pixel->url,
                creativeId: $creative->id,
                impressionId: $impression->id,
                multiplier: $pixel->multiplier,
            );
        }
    }
}
