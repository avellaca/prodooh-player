<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class TenantScopeMiddleware
{
    /**
     * Handle an incoming request.
     *
     * For tenant-admin users, this middleware binds the current tenant ID
     * into the application container so that tenant-aware models and services
     * can use it for row-level data isolation.
     *
     * Super-admin users bypass all tenant filtering — no tenant context is set.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (!$user) {
            return response()->json([
                'error' => 'Unauthenticated',
                'message' => 'Authentication is required.',
            ], 401);
        }

        if ($user->isTenantAdmin()) {
            // Bind the current tenant ID into the container for the request lifecycle.
            // This allows services and scopes to resolve the tenant context without
            // re-querying the authenticated user.
            app()->instance('current_tenant_id', $user->tenant_id);
        }

        // Super-admins pass through without any tenant context being set.
        // The BelongsToTenant trait's global scope checks auth()->user()->isSuperAdmin()
        // and skips filtering accordingly.

        return $next($request);
    }
}
