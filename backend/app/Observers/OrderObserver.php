<?php

namespace App\Observers;

use App\Models\Order;
use App\Services\DateContainmentValidator;

class OrderObserver
{
    public function __construct(private DateContainmentValidator $validator) {}

    public function updating(Order $order): void
    {
        if ($order->isDirty(['starts_at', 'ends_at'])) {
            $this->validator->validateOrderDateShrink($order);
        }
    }
}
