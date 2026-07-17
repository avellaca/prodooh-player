<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\UserInvitationServiceInterface;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class UserController extends Controller
{
    public function __construct(
        private readonly UserInvitationServiceInterface $invitationService
    ) {}

    /**
     * GET /api/admin/users
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $query = User::query()->with('tenant:id,name')->orderBy('created_at', 'desc');

        if ($user->isTenantAdmin()) {
            $query->where('tenant_id', $user->tenant_id);
        }

        $users = $query->get(['id', 'name', 'email', 'role', 'tenant_id', 'is_active', 'password_hash', 'created_at']);

        // Add status field: active / inactive / pending
        $users->each(function ($user) {
            if (empty($user->password_hash)) {
                $user->status = 'pending';
            } elseif ($user->is_active) {
                $user->status = 'active';
            } else {
                $user->status = 'inactive';
            }
            // Hide password_hash from response
            unset($user->password_hash);
        });

        return response()->json(['data' => $users]);
    }

    /**
     * POST /api/admin/users/invite
     */
    public function invite(Request $request): JsonResponse
    {
        $user = $request->user();

        $data = $request->validate([
            'name' => ['nullable', 'string', 'max:255'],
            'email' => ['required', 'email', 'unique:users,email'],
            'role' => ['required', 'string', 'in:tenant_admin,trafficker'],
            'tenant_id' => ['sometimes', 'required', 'uuid', 'exists:tenants,id'],
        ]);

        $targetTenantId = $data['tenant_id'] ?? $user->tenant_id;

        if ($user->isTenantAdmin() && $targetTenantId !== $user->tenant_id) {
            return response()->json([
                'error' => 'Forbidden',
                'message' => 'Tenant admin can only invite users within their own tenant.',
            ], 403);
        }

        if ($user->isSuperAdmin() && !isset($data['tenant_id'])) {
            return response()->json([
                'error' => 'Validation failed',
                'message' => 'Super admin must specify a tenant_id for the invitation.',
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

    /**
     * PUT /api/admin/users/{id}
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $targetUser = User::findOrFail($id);
        $currentUser = $request->user();

        // Tenant admin can only edit users in own tenant
        if ($currentUser->isTenantAdmin() && $targetUser->tenant_id !== $currentUser->tenant_id) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'name' => ['nullable', 'string', 'max:255'],
            'email' => ['sometimes', 'email', 'unique:users,email,' . $id],
            'role' => ['sometimes', 'string', 'in:tenant_admin,trafficker'],
        ]);

        $targetUser->update($data);

        return response()->json(['data' => $targetUser->fresh()]);
    }

    /**
     * PATCH /api/admin/users/{id}/toggle-active
     */
    public function toggleActive(Request $request, string $id): JsonResponse
    {
        $targetUser = User::findOrFail($id);
        $currentUser = $request->user();

        if ($currentUser->isTenantAdmin() && $targetUser->tenant_id !== $currentUser->tenant_id) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        // Don't allow deactivating yourself
        if ($targetUser->id === $currentUser->id) {
            return response()->json(['error' => 'No puedes desactivarte a ti mismo.'], 422);
        }

        $targetUser->update(['is_active' => !$targetUser->is_active]);

        return response()->json(['data' => $targetUser->fresh()]);
    }

    /**
     * DELETE /api/admin/users/{id}
     */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $targetUser = User::findOrFail($id);
        $currentUser = $request->user();

        if ($currentUser->isTenantAdmin() && $targetUser->tenant_id !== $currentUser->tenant_id) {
            return response()->json(['error' => 'Forbidden'], 403);
        }

        if ($targetUser->id === $currentUser->id) {
            return response()->json(['error' => 'No puedes eliminarte a ti mismo.'], 422);
        }

        $targetUser->delete();

        return response()->json(['message' => 'Usuario eliminado.']);
    }

    /**
     * POST /api/admin/users/{id}/resend-invite
     */
    public function resendInvite(Request $request, string $id): JsonResponse
    {
        $targetUser = User::findOrFail($id);

        $this->invitationService->invite(
            email: $targetUser->email,
            role: $targetUser->role,
            tenantId: $targetUser->tenant_id
        );

        return response()->json(['message' => 'Invitación reenviada.']);
    }

    /**
     * POST /api/admin/users/{id}/send-reset
     */
    public function sendReset(Request $request, string $id): JsonResponse
    {
        $targetUser = User::findOrFail($id);

        $this->invitationService->requestPasswordReset($targetUser->email);

        return response()->json(['message' => 'Email de restablecimiento enviado.']);
    }
}
