<?php

namespace App\Http\Middleware;

use App\Models\Screen;
use Closure;
use Firebase\JWT\ExpiredException;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Firebase\JWT\SignatureInvalidException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class DeviceJwtAuth
{
    /**
     * Handle an incoming request.
     *
     * Validates the JWT token from the Authorization header and attaches
     * the authenticated screen to the request.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $token = $this->extractToken($request);

        if (!$token) {
            return response()->json([
                'error' => 'Unauthenticated',
                'message' => 'Authorization token is required.',
            ], 401);
        }

        try {
            $decoded = JWT::decode(
                $token,
                new Key(config('jwt.secret'), config('jwt.algorithm'))
            );
        } catch (ExpiredException $e) {
            return response()->json([
                'error' => 'Token expired',
                'message' => 'The authorization token has expired. Please re-authenticate.',
            ], 401);
        } catch (SignatureInvalidException $e) {
            return response()->json([
                'error' => 'Invalid token',
                'message' => 'The authorization token signature is invalid.',
            ], 401);
        } catch (\Exception $e) {
            return response()->json([
                'error' => 'Invalid token',
                'message' => 'The authorization token is invalid.',
            ], 401);
        }

        // Attach decoded claims to the request for downstream use
        $request->attributes->set('device_claims', $decoded);
        $request->attributes->set('screen_id', $decoded->sub);
        $request->attributes->set('tenant_id', $decoded->tenant_id);
        $request->attributes->set('venue_id', $decoded->venue_id);

        return $next($request);
    }

    /**
     * Extract the Bearer token from the Authorization header or query param.
     */
    private function extractToken(Request $request): ?string
    {
        // Try Authorization header first
        $header = $request->header('Authorization');
        if ($header && str_starts_with($header, 'Bearer ')) {
            return substr($header, 7);
        }

        // Fallback: query param (for <img>/<video> tags that can't send headers)
        $queryToken = $request->query('token');
        if ($queryToken) {
            return $queryToken;
        }

        return null;
    }
}
