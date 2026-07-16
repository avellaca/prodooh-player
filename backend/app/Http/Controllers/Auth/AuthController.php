<?php

namespace App\Http\Controllers\Auth;

use App\Exceptions\InvitationExpiredException;
use App\Exceptions\ResetTokenExpiredException;
use App\Http\Controllers\Controller;
use App\Services\UserInvitationServiceInterface;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AuthController extends Controller
{
    public function __construct(
        private readonly UserInvitationServiceInterface $invitationService
    ) {}

    /**
     * POST /api/auth/register
     *
     * Complete registration with a valid invitation token.
     * Public endpoint — no authentication required.
     */
    public function register(Request $request): JsonResponse
    {
        $data = $request->validate([
            'token' => ['required', 'string', 'size:64'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        try {
            $this->invitationService->completeRegistration(
                token: $data['token'],
                password: $data['password']
            );
        } catch (InvitationExpiredException $e) {
            return response()->json([
                'error' => 'Invitation expired',
                'message' => $e->getMessage(),
            ], 422);
        }

        return response()->json([
            'message' => 'Registration completed successfully.',
        ], 201);
    }

    /**
     * POST /api/auth/forgot-password
     *
     * Request a password reset email.
     * Public endpoint — no authentication required.
     * Always returns 200 to avoid leaking user existence.
     */
    public function forgotPassword(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
        ]);

        $this->invitationService->requestPasswordReset($data['email']);

        return response()->json([
            'message' => 'If the email exists in our system, a password reset link has been sent.',
        ]);
    }

    /**
     * POST /api/auth/reset-password
     *
     * Complete a password reset with a valid token.
     * Public endpoint — no authentication required.
     */
    public function resetPassword(Request $request): JsonResponse
    {
        $data = $request->validate([
            'token' => ['required', 'string', 'size:64'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        try {
            $this->invitationService->resetPassword(
                token: $data['token'],
                newPassword: $data['password']
            );
        } catch (ResetTokenExpiredException $e) {
            return response()->json([
                'error' => 'Token expired',
                'message' => $e->getMessage(),
            ], 422);
        }

        return response()->json([
            'message' => 'Password reset successfully.',
        ]);
    }
}
