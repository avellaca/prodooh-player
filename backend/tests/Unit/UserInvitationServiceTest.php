<?php

namespace Tests\Unit;

use App\Exceptions\InvitationExpiredException;
use App\Exceptions\ResetTokenExpiredException;
use App\Models\PasswordReset;
use App\Models\Tenant;
use App\Models\User;
use App\Models\UserInvitation;
use App\Services\UserInvitationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class UserInvitationServiceTest extends TestCase
{
    use RefreshDatabase;

    private UserInvitationService $service;
    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->service = new UserInvitationService();
        $this->tenant = Tenant::factory()->create();
    }

    // ─── Invitation: expired token rejection ──────────────────────────────

    public function test_expired_invitation_token_is_rejected(): void
    {
        $invitation = UserInvitation::create([
            'tenant_id' => $this->tenant->id,
            'email' => 'user@example.com',
            'role' => 'tenant_admin',
            'token' => str_repeat('a', 64),
            'expires_at' => Carbon::now()->subHours(49), // Expired (>48h)
        ]);

        $this->expectException(InvitationExpiredException::class);

        $this->service->completeRegistration($invitation->token, 'SecurePassword123!');
    }

    public function test_invitation_token_not_found_throws_exception(): void
    {
        $this->expectException(InvitationExpiredException::class);
        $this->expectExceptionMessage('Invitación no encontrada o ya utilizada.');

        $this->service->completeRegistration('nonexistent-token', 'SecurePassword123!');
    }

    public function test_already_used_invitation_token_is_rejected(): void
    {
        $invitation = UserInvitation::create([
            'tenant_id' => $this->tenant->id,
            'email' => 'user@example.com',
            'role' => 'tenant_admin',
            'token' => str_repeat('b', 64),
            'expires_at' => Carbon::now()->addHours(24),
            'accepted_at' => Carbon::now()->subHours(1), // Already accepted
        ]);

        $this->expectException(InvitationExpiredException::class);
        $this->expectExceptionMessage('Invitación no encontrada o ya utilizada.');

        $this->service->completeRegistration($invitation->token, 'SecurePassword123!');
    }

    // ─── Invitation: successful registration with valid token ─────────────

    public function test_successful_registration_with_valid_token(): void
    {
        $invitation = UserInvitation::create([
            'tenant_id' => $this->tenant->id,
            'email' => 'newuser@example.com',
            'role' => 'trafficker',
            'token' => str_repeat('c', 64),
            'expires_at' => Carbon::now()->addHours(24),
        ]);

        $this->service->completeRegistration($invitation->token, 'MyPassword123!');

        // User was created with correct attributes
        $this->assertDatabaseHas('users', [
            'tenant_id' => $this->tenant->id,
            'email' => 'newuser@example.com',
            'role' => 'trafficker',
            'is_active' => true,
        ]);

        // Password is hashed with bcrypt
        $user = User::where('email', 'newuser@example.com')->first();
        $this->assertNotNull($user);
        $this->assertTrue(password_verify('MyPassword123!', $user->password_hash));

        // Invitation is marked as accepted
        $invitation->refresh();
        $this->assertNotNull($invitation->accepted_at);
    }

    public function test_registration_creates_user_with_correct_tenant_and_role(): void
    {
        $invitation = UserInvitation::create([
            'tenant_id' => $this->tenant->id,
            'email' => 'admin@example.com',
            'role' => 'tenant_admin',
            'token' => str_repeat('d', 64),
            'expires_at' => Carbon::now()->addHours(47), // Still valid (< 48h)
        ]);

        $this->service->completeRegistration($invitation->token, 'StrongPass456!');

        $user = User::where('email', 'admin@example.com')->first();
        $this->assertNotNull($user);
        $this->assertEquals($this->tenant->id, $user->tenant_id);
        $this->assertEquals('tenant_admin', $user->role);
        $this->assertTrue($user->is_active);
    }

    // ─── Password Reset: expired token rejection ──────────────────────────

    public function test_expired_reset_token_is_rejected(): void
    {
        $user = User::factory()->create(['tenant_id' => $this->tenant->id]);

        $passwordReset = PasswordReset::create([
            'user_id' => $user->id,
            'token' => str_repeat('e', 64),
            'expires_at' => Carbon::now()->subHours(2), // Expired (>1h)
        ]);

        $this->expectException(ResetTokenExpiredException::class);

        $this->service->resetPassword($passwordReset->token, 'NewPassword789!');
    }

    public function test_reset_token_not_found_throws_exception(): void
    {
        $this->expectException(ResetTokenExpiredException::class);
        $this->expectExceptionMessage('Token de restablecimiento no encontrado o ya utilizado.');

        $this->service->resetPassword('nonexistent-token', 'NewPassword789!');
    }

    public function test_already_used_reset_token_is_rejected(): void
    {
        $user = User::factory()->create(['tenant_id' => $this->tenant->id]);

        $passwordReset = PasswordReset::create([
            'user_id' => $user->id,
            'token' => str_repeat('f', 64),
            'expires_at' => Carbon::now()->addMinutes(30),
            'used_at' => Carbon::now()->subMinutes(10), // Already used
        ]);

        $this->expectException(ResetTokenExpiredException::class);
        $this->expectExceptionMessage('Token de restablecimiento no encontrado o ya utilizado.');

        $this->service->resetPassword($passwordReset->token, 'NewPassword789!');
    }

    // ─── Password Reset: successful reset with valid token ────────────────

    public function test_successful_password_reset_with_valid_token(): void
    {
        $user = User::factory()->create([
            'tenant_id' => $this->tenant->id,
            'password_hash' => bcrypt('OldPassword123!'),
        ]);

        $passwordReset = PasswordReset::create([
            'user_id' => $user->id,
            'token' => str_repeat('g', 64),
            'expires_at' => Carbon::now()->addMinutes(30), // Still valid (< 1h)
        ]);

        $this->service->resetPassword($passwordReset->token, 'NewSecurePassword!');

        // Password was updated
        $user->refresh();
        $this->assertTrue(password_verify('NewSecurePassword!', $user->password_hash));

        // Token is marked as used
        $passwordReset->refresh();
        $this->assertNotNull($passwordReset->used_at);
    }
}
