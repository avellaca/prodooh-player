<?php

namespace App\Services;

use App\Models\Order;
use App\Models\OrderLine;
use Illuminate\Validation\ValidationException;

class DateContainmentValidator
{
    /**
     * Validate that an OrderLine's dates are within its parent Order's range.
     */
    public function validateOrderLineDates(OrderLine $orderLine): void
    {
        $order = $orderLine->order ?? Order::withoutGlobalScopes()->findOrFail($orderLine->order_id);

        if ($orderLine->starts_at->lt($order->starts_at) || $orderLine->ends_at->gt($order->ends_at)) {
            throw ValidationException::withMessages([
                'starts_at' => "Order line dates must be within the parent order range ({$order->starts_at->toDateString()} to {$order->ends_at->toDateString()}).",
            ]);
        }
    }

    /**
     * Validate that an OrderLine's active_dates are within its parent Order's range.
     */
    public function validateOrderLineActiveDates(OrderLine $orderLine): void
    {
        if (empty($orderLine->active_dates)) {
            return; // null or empty is valid (means "all days in range")
        }

        $order = $orderLine->order ?? Order::withoutGlobalScopes()->findOrFail($orderLine->order_id);
        $startsAt = $order->starts_at->toDateString();
        $endsAt = $order->ends_at->toDateString();

        $invalidDates = collect($orderLine->active_dates)->filter(
            fn(string $date) => $date < $startsAt || $date > $endsAt
        );

        if ($invalidDates->isNotEmpty()) {
            throw ValidationException::withMessages([
                'active_dates' => "Las fechas activas deben estar dentro del rango del pedido ({$startsAt} a {$endsAt}). Inválidas: " . $invalidDates->implode(', '),
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
