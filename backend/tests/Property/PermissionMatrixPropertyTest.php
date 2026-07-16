<?php

namespace Tests\Property;

use App\Http\Middleware\RoleAuthorization;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Tests\TestCase;

/**
 * Property-based tests for the Permission Matrix (Property 19).
 *
 * Uses randomized combinations of (user role, resource, tenant ownership)
 * across 100 iterations to verify that the permission matrix holds universally:
 *
 * - super_admin: full access to everything
 * - tenant_admin: full access within own tenant
 * - trafficker: CRUD on orders, order_lines, creatives ONLY
 *   (no activation, no configuration, no user management)
 *
 * **Validates: Requirements 9.1, 12.2**
 */
class PermissionMatrixPropertyTest extends TestCase
{
    private RoleAuthorization $middleware;

    /**
     * All possible resource groups used by the authorize middleware.
     */
    private const ALL_RESOURCES = [
        'orders',
        'order_lines',
        'creatives',
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
     * Resources that trafficker IS allowed to access.
     */
    private const TRAFFICKER_ALLOWED = [
        'orders',
        'order_lines',
        'creatives',
    ];

    /**
     * Resources that require at least tenant_admin (trafficker denied).
     */
    private const ADMIN_ONLY = [
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
     * All valid roles in the system.
     */
    private const ALL_ROLES = [
        'super_admin',
        'tenant_admin',
        'trafficker',
    ];

    protected function setUp(): void
    {
        parent::setUp();
        $this->middleware = new RoleAuthorization();
    }

    /**
     * Helper to create a mock request with an authenticated user of a given role.
     */
    private function makeAuthenticatedRequest(string $role, ?string $tenantId = null): Request
    {
        $user = new User();
        $user->role = $role;
        $user->tenant_id = $tenantId;
        $user->id = fake()->uuid();

        $request = Request::create('/test', 'GET');
        $request->setUserResolver(fn () => $user);

        return $request;
    }

    /**
     * Helper to create a mock request without authentication.
     */
    private function makeUnauthenticatedRequest(): Request
    {
        $request = Request::create('/test', 'GET');
        $request->setUserResolver(fn () => null);

        return $request;
    }

    /**
     * Run the middleware and return the HTTP status code.
     */
    private function getMiddlewareResponseStatus(Request $request, string $resource): int
    {
        $next = fn () => new Response('OK', 200);

        $response = $this->middleware->handle($request, $next, $resource);

        return $response->getStatusCode();
    }

    /**
     * Pick a random element from an array.
     */
    private function randomFrom(array $items): string
    {
        return $items[array_rand($items)];
    }

    // ─── Property 19a: super_admin always granted access ────────────────────

    /**
     * Property 19a: For any resource, super_admin must always be granted access.
     *
     * For any randomly selected resource from the complete resource list,
     * a super_admin user must always receive HTTP 200 (access granted).
     *
     * **Validates: Requirements 12.1**
     */
    public function test_super_admin_always_granted_access_to_any_resource(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $resource = $this->randomFrom(self::ALL_RESOURCES);
            $tenantId = fake()->uuid();

            $request = $this->makeAuthenticatedRequest('super_admin', null);
            $status = $this->getMiddlewareResponseStatus($request, $resource);

            $this->assertEquals(
                200,
                $status,
                "Property 19a (iter {$i}): super_admin must have access to '{$resource}', got HTTP {$status}"
            );
        }
    }

    // ─── Property 19b: tenant_admin always granted within own tenant ────────

    /**
     * Property 19b: For any resource, tenant_admin must always be granted access.
     *
     * The RoleAuthorization middleware grants tenant_admin full access to all
     * resources (tenant scoping is enforced at the controller/query level, not middleware).
     * For any randomly selected resource, a tenant_admin user must receive HTTP 200.
     *
     * **Validates: Requirements 12.2**
     */
    public function test_tenant_admin_always_granted_access_to_any_resource(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $resource = $this->randomFrom(self::ALL_RESOURCES);
            $tenantId = fake()->uuid();

            $request = $this->makeAuthenticatedRequest('tenant_admin', $tenantId);
            $status = $this->getMiddlewareResponseStatus($request, $resource);

            $this->assertEquals(
                200,
                $status,
                "Property 19b (iter {$i}): tenant_admin must have access to '{$resource}', got HTTP {$status}"
            );
        }
    }

    // ─── Property 19c: trafficker granted only CRUD resources ───────────────

    /**
     * Property 19c: Trafficker must be granted access ONLY to orders, order_lines, creatives.
     *
     * For any randomly selected resource from the TRAFFICKER_ALLOWED list,
     * a trafficker user must receive HTTP 200 (access granted).
     *
     * **Validates: Requirements 9.1**
     */
    public function test_trafficker_granted_access_to_crud_resources(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $resource = $this->randomFrom(self::TRAFFICKER_ALLOWED);
            $tenantId = fake()->uuid();

            $request = $this->makeAuthenticatedRequest('trafficker', $tenantId);
            $status = $this->getMiddlewareResponseStatus($request, $resource);

            $this->assertEquals(
                200,
                $status,
                "Property 19c (iter {$i}): trafficker must have access to '{$resource}', got HTTP {$status}"
            );
        }
    }

    // ─── Property 19d: trafficker denied admin-only resources ───────────────

    /**
     * Property 19d: Trafficker must be denied access to activation, config, users, and other admin resources.
     *
     * For any randomly selected resource from the ADMIN_ONLY list,
     * a trafficker user must receive HTTP 403 (Forbidden).
     *
     * **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
     */
    public function test_trafficker_denied_access_to_admin_only_resources(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $resource = $this->randomFrom(self::ADMIN_ONLY);
            $tenantId = fake()->uuid();

            $request = $this->makeAuthenticatedRequest('trafficker', $tenantId);
            $status = $this->getMiddlewareResponseStatus($request, $resource);

            $this->assertEquals(
                403,
                $status,
                "Property 19d (iter {$i}): trafficker must be denied access to '{$resource}', got HTTP {$status}"
            );
        }
    }

    // ─── Property 19e: Complete permission matrix holds for any random combination ──

    /**
     * Property 19e: For any random combination of (role, resource), access is granted
     * if and only if the permission matrix is satisfied.
     *
     * This is the comprehensive property that tests all possible combinations randomly:
     * - super_admin → always granted (any resource)
     * - tenant_admin → always granted (any resource, middleware level)
     * - trafficker → granted IFF resource ∈ {orders, order_lines, creatives}
     *
     * **Validates: Requirements 9.1, 12.2**
     */
    public function test_permission_matrix_holds_for_random_role_resource_combinations(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $role = $this->randomFrom(self::ALL_ROLES);
            $resource = $this->randomFrom(self::ALL_RESOURCES);
            $tenantId = fake()->uuid();

            $request = $this->makeAuthenticatedRequest($role, $role === 'super_admin' ? null : $tenantId);
            $status = $this->getMiddlewareResponseStatus($request, $resource);

            // Determine expected outcome based on the permission matrix
            $shouldBeGranted = match ($role) {
                'super_admin' => true,
                'tenant_admin' => true,
                'trafficker' => in_array($resource, self::TRAFFICKER_ALLOWED, true),
                default => false,
            };

            $expectedStatus = $shouldBeGranted ? 200 : 403;

            $this->assertEquals(
                $expectedStatus,
                $status,
                "Property 19e (iter {$i}): role='{$role}', resource='{$resource}' — " .
                "expected HTTP {$expectedStatus} (" . ($shouldBeGranted ? 'granted' : 'denied') . "), got HTTP {$status}"
            );
        }
    }

    // ─── Property 19f: Unauthenticated users always denied ──────────────────

    /**
     * Property 19f: Unauthenticated requests must always receive HTTP 401.
     *
     * For any randomly selected resource, an unauthenticated request must be denied
     * with HTTP 401 (Unauthorized), regardless of the resource being accessed.
     *
     * **Validates: Requirements 12.6**
     */
    public function test_unauthenticated_always_denied(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $resource = $this->randomFrom(self::ALL_RESOURCES);

            $request = $this->makeUnauthenticatedRequest();
            $status = $this->getMiddlewareResponseStatus($request, $resource);

            $this->assertEquals(
                401,
                $status,
                "Property 19f (iter {$i}): unauthenticated request to '{$resource}' must get HTTP 401, got HTTP {$status}"
            );
        }
    }

    // ─── Property 19g: Trafficker exclusion set is complete ─────────────────

    /**
     * Property 19g: The set of denied resources for trafficker must include ALL
     * resources that are not in the allowed set.
     *
     * For any resource NOT in TRAFFICKER_ALLOWED, trafficker must be denied.
     * This ensures the allowed set is exactly {orders, order_lines, creatives}
     * and nothing else leaks through.
     *
     * **Validates: Requirements 9.1, 12.3**
     */
    public function test_trafficker_denied_set_is_complement_of_allowed(): void
    {
        for ($i = 0; $i < 100; $i++) {
            // Pick a random resource from ALL_RESOURCES
            $resource = $this->randomFrom(self::ALL_RESOURCES);
            $tenantId = fake()->uuid();
            $isAllowed = in_array($resource, self::TRAFFICKER_ALLOWED, true);

            $request = $this->makeAuthenticatedRequest('trafficker', $tenantId);
            $status = $this->getMiddlewareResponseStatus($request, $resource);

            if ($isAllowed) {
                $this->assertEquals(
                    200,
                    $status,
                    "Property 19g (iter {$i}): trafficker should be ALLOWED for '{$resource}'"
                );
            } else {
                $this->assertEquals(
                    403,
                    $status,
                    "Property 19g (iter {$i}): trafficker should be DENIED for '{$resource}'"
                );
            }
        }
    }
}
