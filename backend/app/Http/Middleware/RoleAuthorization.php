<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Role-based authorization middleware that enforces the permission matrix:
 *
 * - super_admin: full access to everything
 * - tenant_admin: full access within own tenant
 * - trafficker: CRUD on orders, order_lines, creatives ONLY
 *   (no activation, no configuration, no user management)
 *
 * Usage in routes:
 *   ->middleware('authorize:orders')        // trafficker + tenant_admin + super_admin
 *   ->middleware('authorize:activation')    // tenant_admin + super_admin only
 *   ->middleware('authorize:config')        // tenant_admin + super_admin only
 *   ->middleware('authorize:users')         // tenant_admin + super_admin only
 */
class RoleAuthorization
{
    /**
     * Resource groups that trafficker is allowed to access.
     */
    private const TRAFFICKER_ALLOWED_RESOURCES = [
        'orders',
        'order_lines',
        'creatives',
    ];

    /**
     * Resource groups that require at least tenant_admin.
     */
    private const ADMIN_ONLY_RESOURCES = [
        'activation',
        'config',
        'users',
        'screens',
        'screen_groups',
        'playlists',
        'content',
        'analytics',
    ];

    /**
     * Handle an incoming request.
     *
     * @param  string  $resource  The resource group being accessed
     */
    public function handle(Request $request, Closure $next, string $resource): Response
    {
        $user = $request->user();

        if (!$user) {
            return response()->json([
                'error' => 'Unauthenticated',
                'message' => 'Authentication is required.',
            ], 401);
        }

        // super_admin has full access to everything
        if ($user->isSuperAdmin()) {
            return $next($request);
        }

        // tenant_admin has full access within own tenant
        if ($user->isTenantAdmin()) {
            return $next($request);
        }

        // trafficker: check if the resource is in allowed list
        if ($user->isTrafficker()) {
            if (in_array($resource, self::TRAFFICKER_ALLOWED_RESOURCES, true)) {
                return $next($request);
            }

            return $this->denyAccess($resource);
        }

        // Unknown role — deny by default
        return $this->denyAccess($resource);
    }

    /**
     * Return a 403 response with a descriptive error message.
     */
    private function denyAccess(string $resource): Response
    {
        $messages = [
            'activation' => 'Trafficker users are not authorized to activate orders or order lines.',
            'config' => 'Trafficker users are not authorized to access configuration settings.',
            'users' => 'Trafficker users are not authorized to manage users.',
            'screens' => 'Trafficker users are not authorized to manage screens.',
            'screen_groups' => 'Trafficker users are not authorized to manage screen groups.',
            'playlists' => 'Trafficker users are not authorized to manage playlists.',
            'content' => 'Trafficker users are not authorized to manage content.',
            'analytics' => 'Trafficker users are not authorized to access analytics.',
        ];

        $message = $messages[$resource] ?? 'You do not have permission to perform this action.';

        return response()->json([
            'error' => 'Forbidden',
            'message' => $message,
        ], 403);
    }
}
