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
            app()->instance('current_tenant_id', $user->tenant_id);
        }

        // Super-admin with tenant_id query parameter: scope data to that tenant
        if ($user->isSuperAdmin() && $request->query('tenant_id')) {
            app()->instance('current_tenant_id', $request->query('tenant_id'));
        }

        return $next($request);
    }
}
