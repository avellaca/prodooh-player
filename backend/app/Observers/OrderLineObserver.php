<?php

namespace App\Observers;

use App\Models\OrderLine;
use App\Services\DateContainmentValidator;

class OrderLineObserver
{
    public function __construct(private DateContainmentValidator $validator) {}

    public function creating(OrderLine $orderLine): void
    {
        $this->validator->validateOrderLineDates($orderLine);
    }

    public function updating(OrderLine $orderLine): void
    {
        if ($orderLine->isDirty(['starts_at', 'ends_at'])) {
            $this->validator->validateOrderLineDates($orderLine);
        }
    }
}
