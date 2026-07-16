<?php

namespace App\Services;

interface UserInvitationServiceInterface
{
    /**
     * Envía invitación por email via Resend. Token válido 48h.
     */
    public function invite(string $email, string $role, string $tenantId): void;

    /**
     * Completa el registro con token válido.
     *
     * @throws \App\Exceptions\InvitationExpiredException
     */
    public function completeRegistration(string $token, string $password): void;

    /**
     * Inicia flujo de reset de contraseña. Enlace válido 1h.
     */
    public function requestPasswordReset(string $email): void;

    /**
     * Completa el reset de contraseña.
     *
     * @throws \App\Exceptions\ResetTokenExpiredException
     */
    public function resetPassword(string $token, string $newPassword): void;
}
