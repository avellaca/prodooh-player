<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RoleGuard
{
    /**
     * Handle an incoming request.
     *
     * Checks that the authenticated user has one of the allowed roles.
     * Usage: RoleGuard:super_admin or RoleGuard:super_admin,tenant_admin
     *
     * @param  string  ...$roles  Allowed roles for this route
     */
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $user = $request->user();

        if (!$user) {
            return response()->json([
                'error' => 'Unauthenticated',
                'message' => 'Authentication is required.',
            ], 401);
        }

        if (!in_array($user->role, $roles, true)) {
            return response()->json([
                'error' => 'Forbidden',
                'message' => 'You do not have permission to access this resource.',
            ], 403);
        }

        return $next($request);
    }
}
