<?php

namespace App\Services;

use App\Models\Order;
use App\Models\OrderLine;
use App\Models\Creative;
use Illuminate\Validation\ValidationException;

class DateContainmentValidator
{
    /**
     * Validate that an OrderLine's dates are within its parent Order's range.
     */
    public function validateOrderLineDates(OrderLine $orderLine): void
    {
        $order = $orderLine->order ?? Order::findOrFail($orderLine->order_id);

        if ($orderLine->starts_at->lt($order->starts_at) || $orderLine->ends_at->gt($order->ends_at)) {
            throw ValidationException::withMessages([
                'starts_at' => "Order line dates must be within the parent order range ({$order->starts_at->toDateString()} to {$order->ends_at->toDateString()}).",
            ]);
        }
    }

    /**
     * Validate that a Creative's active_dates are within its parent OrderLine's range.
     */
    public function validateCreativeActiveDates(Creative $creative): void
    {
        $orderLine = $creative->orderLine ?? OrderLine::findOrFail($creative->order_line_id);

        $invalidDates = collect($creative->active_dates)->filter(function ($dateStr) use ($orderLine) {
            $date = \Carbon\Carbon::parse($dateStr);
            return $date->lt($orderLine->starts_at) || $date->gt($orderLine->ends_at);
        });

        if ($invalidDates->isNotEmpty()) {
            throw ValidationException::withMessages([
                'active_dates' => "Creative active dates must be within the parent order line range ({$orderLine->starts_at->toDateString()} to {$orderLine->ends_at->toDateString()}). Invalid: " . $invalidDates->implode(', '),
            ]);
        }
    }

    /**
     * Validate that an Order's date range change doesn't orphan children.
     */
    public function validateOrderDateShrink(Order $order): void
    {
        $orphanedLines = $order->orderLines()
            ->where(function ($q) use ($order) {
                $q->where('starts_at', '<', $order->starts_at)
                  ->orWhere('ends_at', '>', $order->ends_at);
            })
            ->exists();

        if ($orphanedLines) {
            throw ValidationException::withMessages([
                'starts_at' => 'Cannot shrink order date range: some order lines have dates outside the new range.',
            ]);
        }
    }
}
