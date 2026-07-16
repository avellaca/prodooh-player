<?php

namespace App\Services;

use App\Exceptions\InvitationExpiredException;
use App\Exceptions\ResetTokenExpiredException;
use App\Models\PasswordReset;
use App\Models\User;
use App\Models\UserInvitation;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

class UserInvitationService implements UserInvitationServiceInterface
{
    /**
     * Token length in characters.
     */
    private const TOKEN_LENGTH = 64;

    /**
     * Invitation token validity in hours.
     */
    private const INVITATION_EXPIRY_HOURS = 48;

    /**
     * Password reset token validity in hours.
     */
    private const RESET_EXPIRY_HOURS = 1;

    /**
     * Envía invitación por email via Resend. Token válido 48h.
     */
    public function invite(string $email, string $role, string $tenantId): void
    {
        $token = Str::random(self::TOKEN_LENGTH);

        $invitation = UserInvitation::create([
            'tenant_id' => $tenantId,
            'email' => $email,
            'role' => $role,
            'token' => $token,
            'expires_at' => Carbon::now()->addHours(self::INVITATION_EXPIRY_HOURS),
        ]);

        $registrationUrl = $this->buildRegistrationUrl($token);

        Mail::raw(
            "Has sido invitado a unirte a la plataforma ProDooh.\n\n"
            . "Usa el siguiente enlace para completar tu registro:\n"
            . $registrationUrl . "\n\n"
            . "Este enlace expira en 48 horas.",
            function ($message) use ($email) {
                $message->to($email)
                    ->subject('Invitación a ProDooh');
            }
        );
    }

    /**
     * Completa el registro con token válido.
     *
     * @throws InvitationExpiredException
     */
    public function completeRegistration(string $token, string $password): void
    {
        $invitation = UserInvitation::where('token', $token)
            ->whereNull('accepted_at')
            ->first();

        if (!$invitation) {
            throw new InvitationExpiredException('Invitación no encontrada o ya utilizada.');
        }

        if ($invitation->isExpired()) {
            throw new InvitationExpiredException();
        }

        User::create([
            'tenant_id' => $invitation->tenant_id,
            'email' => $invitation->email,
            'password_hash' => bcrypt($password),
            'role' => $invitation->role,
            'is_active' => true,
        ]);

        $invitation->update([
            'accepted_at' => Carbon::now(),
        ]);
    }

    /**
     * Inicia flujo de reset de contraseña. Enlace válido 1h.
     */
    public function requestPasswordReset(string $email): void
    {
        $user = User::where('email', $email)->first();

        if (!$user) {
            // Silently return to avoid leaking user existence
            return;
        }

        $token = Str::random(self::TOKEN_LENGTH);

        PasswordReset::create([
            'user_id' => $user->id,
            'token' => $token,
            'expires_at' => Carbon::now()->addHours(self::RESET_EXPIRY_HOURS),
        ]);

        $resetUrl = $this->buildResetUrl($token);

        Mail::raw(
            "Se ha solicitado un restablecimiento de contraseña para tu cuenta.\n\n"
            . "Usa el siguiente enlace para restablecer tu contraseña:\n"
            . $resetUrl . "\n\n"
            . "Este enlace expira en 1 hora.\n\n"
            . "Si no solicitaste este cambio, ignora este correo.",
            function ($message) use ($email) {
                $message->to($email)
                    ->subject('Restablecimiento de contraseña - ProDooh');
            }
        );
    }

    /**
     * Completa el reset de contraseña.
     *
     * @throws ResetTokenExpiredException
     */
    public function resetPassword(string $token, string $newPassword): void
    {
        $passwordReset = PasswordReset::where('token', $token)
            ->whereNull('used_at')
            ->first();

        if (!$passwordReset) {
            throw new ResetTokenExpiredException('Token de restablecimiento no encontrado o ya utilizado.');
        }

        if ($passwordReset->isExpired()) {
            throw new ResetTokenExpiredException();
        }

        $user = $passwordReset->user;
        $user->update([
            'password_hash' => bcrypt($newPassword),
        ]);

        $passwordReset->update([
            'used_at' => Carbon::now(),
        ]);
    }

    /**
     * Build the registration URL with the invitation token.
     */
    private function buildRegistrationUrl(string $token): string
    {
        $baseUrl = config('app.frontend_url', config('app.url', 'http://localhost:5173'));

        return rtrim($baseUrl, '/') . '/register?token=' . $token;
    }

    /**
     * Build the password reset URL with the token.
     */
    private function buildResetUrl(string $token): string
    {
        $baseUrl = config('app.frontend_url', config('app.url', 'http://localhost:5173'));

        return rtrim($baseUrl, '/') . '/reset-password?token=' . $token;
    }
}
