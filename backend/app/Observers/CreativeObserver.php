<?php

namespace App\Observers;

use App\Models\Creative;
use App\Services\DateContainmentValidator;

class CreativeObserver
{
    public function __construct(private DateContainmentValidator $validator) {}

    public function creating(Creative $creative): void
    {
        $this->validator->validateCreativeActiveDates($creative);
    }

    public function updating(Creative $creative): void
    {
        if ($creative->isDirty('active_dates')) {
            $this->validator->validateCreativeActiveDates($creative);
        }
    }
}
