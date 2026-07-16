<?php

namespace App\Exceptions;

use Exception;

class ResetTokenExpiredException extends Exception
{
    public function __construct(string $message = 'El token de restablecimiento ha expirado o ya fue utilizado.')
    {
        parent::__construct($message);
    }
}
