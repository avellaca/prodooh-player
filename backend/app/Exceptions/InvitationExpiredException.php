<?php

namespace App\Exceptions;

use Exception;

class InvitationExpiredException extends Exception
{
    public function __construct(string $message = 'La invitación ha expirado.')
    {
        parent::__construct($message);
    }
}
