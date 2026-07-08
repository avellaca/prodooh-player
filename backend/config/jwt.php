<?php

return [

    /*
    |--------------------------------------------------------------------------
    | JWT Secret Key
    |--------------------------------------------------------------------------
    |
    | The secret key used to sign device JWT tokens. This should be a
    | sufficiently long random string, separate from the APP_KEY.
    |
    */

    'secret' => env('JWT_SECRET'),

    /*
    |--------------------------------------------------------------------------
    | JWT Token TTL (Time To Live)
    |--------------------------------------------------------------------------
    |
    | Token lifetime in minutes. After this time, the device must
    | re-authenticate to get a new token.
    |
    */

    'ttl' => env('JWT_TTL', 1440), // 24 hours default

    /*
    |--------------------------------------------------------------------------
    | JWT Algorithm
    |--------------------------------------------------------------------------
    |
    | The algorithm used for signing tokens.
    |
    */

    'algorithm' => env('JWT_ALGORITHM', 'HS256'),

];
