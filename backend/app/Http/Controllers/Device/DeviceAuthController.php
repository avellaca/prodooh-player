<?php

namespace App\Http\Controllers\Device;

use App\Http\Controllers\Controller;
use App\Models\Screen;
use Firebase\JWT\JWT;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class DeviceAuthController extends Controller
{
    /**
     * Authenticate a device and issue a JWT token.
     *
     * Accepts venue_id + device_token, validates against the screens table,
     * and returns a signed JWT with screen_id, tenant_id, and venue_id claims.
     */
    public function auth(Request $request): JsonResponse
    {
        $request->validate([
            'venue_id' => 'required|string',
            'device_token' => 'required|string',
        ]);

        $venueId = $request->input('venue_id');
        $deviceToken = $request->input('device_token');

        // Look up the screen by venue_id
        $screen = Screen::where('venue_id', $venueId)->first();

        if (!$screen) {
            return response()->json([
                'error' => 'Device not found',
                'message' => 'No screen registered with the provided venue_id.',
            ], 404);
        }

        // Verify the device_token against the stored hash
        if (!Hash::check($deviceToken, $screen->device_token_hash)) {
            return response()->json([
                'error' => 'Invalid credentials',
                'message' => 'The provided device_token is invalid.',
            ], 401);
        }

        // Issue JWT token
        $token = $this->issueToken($screen);

        return response()->json([
            'token' => $token,
            'token_type' => 'Bearer',
            'expires_in' => config('jwt.ttl') * 60, // seconds
        ]);
    }

    /**
     * Generate a signed JWT token for the given screen.
     */
    private function issueToken(Screen $screen): string
    {
        $now = time();
        $ttlSeconds = config('jwt.ttl') * 60;

        $payload = [
            'sub' => $screen->id,
            'tenant_id' => $screen->tenant_id,
            'venue_id' => $screen->venue_id,
            'iat' => $now,
            'exp' => $now + $ttlSeconds,
        ];

        return JWT::encode(
            $payload,
            config('jwt.secret'),
            config('jwt.algorithm')
        );
    }
}
