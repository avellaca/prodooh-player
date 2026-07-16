<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\UserInvitationServiceInterface;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class UserController extends Controller
{
    public function __construct(
        private readonly UserInvitationServiceInterface $invitationService
    ) {}

    /**
     * POST /api/admin/users/invite
     *
     * Send an invitation email to a new user.
     * - tenant_admin can only invite within own tenant
     * - super_admin can invite to any tenant
     */
    public function invite(Request $request): JsonResponse
    {
        $user = $request->user();

        $data = $request->validate([
            'email' => ['required', 'email', 'unique:users,email'],
            'role' => ['required', 'string', 'in:tenant_admin,trafficker'],
            'tenant_id' => ['sometimes', 'required', 'uuid', 'exists:tenants,id'],
        ]);

        // Determine the target tenant_id
        $targetTenantId = $data['tenant_id'] ?? $user->tenant_id;

        // Authorization: tenant_admin can only invite within own tenant
        if ($user->isTenantAdmin()) {
            if ($targetTenantId !== $user->tenant_id) {
                return response()->json([
                    'error' => 'Forbidden',
                    'message' => 'Tenant admin can only invite users within their own tenant.',
                ], 403);
            }
        }

        // super_admin must provide a tenant_id (they have no tenant_id of their own)
        if ($user->isSuperAdmin() && !isset($data['tenant_id'])) {
            return response()->json([
                'error' => 'Validation failed',
                'message' => 'Super admin must specify a tenant_id for the invitation.',
                'errors' => ['tenant_id' => ['The tenant_id field is required for super admin.']],
            ], 422);
        }

        $this->invitationService->invite(
            email: $data['email'],
            role: $data['role'],
            tenantId: $targetTenantId
        );

        return response()->json([
            'message' => 'Invitation sent successfully.',
            'email' => $data['email'],
            'role' => $data['role'],
            'tenant_id' => $targetTenantId,
        ], 201);
    }
}
