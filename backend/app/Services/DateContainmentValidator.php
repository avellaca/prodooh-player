<?php

namespace App\Services;

use App\Models\Order;
use App\Models\OrderLine;
use Illuminate\Validation\ValidationException;

class DateContainmentValidator
{
    /**
     * @deprecated Order dates are now computed from order lines (MIN/MAX of starts_at/ends_at).
     * Validation of order line dates against the parent order is no longer applicable.
     */
    public function validateOrderLineDates(OrderLine $orderLine): void
    {
        // No-op: Order dates are now dynamically derived from order_lines.
        // Order lines define the order range, not the other way around.
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

        // Order dates are now computed from order_lines (MIN/MAX). During creation of
        // the first order line, the order may not yet have computed dates. Skip validation
        // in that case — dates will be validated on subsequent updates.
        if ($order->starts_at === null || $order->ends_at === null) {
            return;
        }

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
     * @deprecated Order dates are now computed from order lines (MIN/MAX).
     * This method is kept for backward compatibility but is a no-op.
     */
    public function validateOrderDateShrink(Order $order): void
    {
        // No-op: Order dates are now dynamically computed from order_lines.
        // There's no stored date range to shrink.
    }
}
