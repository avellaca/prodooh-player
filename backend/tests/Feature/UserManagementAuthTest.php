<?php

namespace Tests\Feature;

use App\Models\PasswordReset;
use App\Models\Tenant;
use App\Models\User;
use App\Models\UserInvitation;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

class UserManagementAuthTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;
    private Tenant $otherTenant;
    private User $superAdmin;
    private User $tenantAdmin;
    private User $trafficker;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::factory()->create();
        $this->otherTenant = Tenant::factory()->create();

        $this->superAdmin = User::factory()->superAdmin()->create();
        $this->tenantAdmin = User::factory()->tenantAdmin()->create(['tenant_id' => $this->tenant->id]);
        $this->trafficker = User::factory()->trafficker()->create(['tenant_id' => $this->tenant->id]);
    }

    // ─── POST /api/admin/users/invite ─────────────────────────────────────

    public function test_tenant_admin_can_invite_user_to_own_tenant(): void
    {
        Mail::fake();

        $this->actingAs($this->tenantAdmin, 'sanctum');

        $response = $this->postJson('/api/admin/users/invite', [
            'email' => 'newuser@example.com',
            'role' => 'trafficker',
        ]);

        $response->assertCreated()
            ->assertJson([
                'message' => 'Invitation sent successfully.',
                'email' => 'newuser@example.com',
                'role' => 'trafficker',
                'tenant_id' => $this->tenant->id,
            ]);

        $this->assertDatabaseHas('user_invitations', [
            'email' => 'newuser@example.com',
            'role' => 'trafficker',
            'tenant_id' => $this->tenant->id,
        ]);
    }

    public function test_tenant_admin_cannot_invite_to_other_tenant(): void
    {
        $this->actingAs($this->tenantAdmin, 'sanctum');

        $response = $this->postJson('/api/admin/users/invite', [
            'email' => 'newuser@example.com',
            'role' => 'trafficker',
            'tenant_id' => $this->otherTenant->id,
        ]);

        $response->assertForbidden()
            ->assertJson([
                'error' => 'Forbidden',
                'message' => 'Tenant admin can only invite users within their own tenant.',
            ]);
    }

    public function test_super_admin_can_invite_to_any_tenant(): void
    {
        Mail::fake();

        $this->actingAs($this->superAdmin, 'sanctum');

        $response = $this->postJson('/api/admin/users/invite', [
            'email' => 'newuser@example.com',
            'role' => 'tenant_admin',
            'tenant_id' => $this->otherTenant->id,
        ]);

        $response->assertCreated()
            ->assertJson([
                'message' => 'Invitation sent successfully.',
                'email' => 'newuser@example.com',
                'role' => 'tenant_admin',
                'tenant_id' => $this->otherTenant->id,
            ]);

        $this->assertDatabaseHas('user_invitations', [
            'email' => 'newuser@example.com',
            'role' => 'tenant_admin',
            'tenant_id' => $this->otherTenant->id,
        ]);
    }

    public function test_super_admin_must_provide_tenant_id(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum');

        $response = $this->postJson('/api/admin/users/invite', [
            'email' => 'newuser@example.com',
            'role' => 'trafficker',
        ]);

        $response->assertUnprocessable()
            ->assertJson([
                'error' => 'Validation failed',
                'message' => 'Super admin must specify a tenant_id for the invitation.',
            ]);
    }

    public function test_trafficker_cannot_invite_users(): void
    {
        $this->actingAs($this->trafficker, 'sanctum');

        $response = $this->postJson('/api/admin/users/invite', [
            'email' => 'newuser@example.com',
            'role' => 'trafficker',
        ]);

        $response->assertForbidden();
    }

    public function test_invite_requires_valid_email(): void
    {
        $this->actingAs($this->tenantAdmin, 'sanctum');

        $response = $this->postJson('/api/admin/users/invite', [
            'email' => 'not-an-email',
            'role' => 'trafficker',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['email']);
    }

    public function test_invite_requires_valid_role(): void
    {
        $this->actingAs($this->tenantAdmin, 'sanctum');

        $response = $this->postJson('/api/admin/users/invite', [
            'email' => 'newuser@example.com',
            'role' => 'super_admin',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['role']);
    }

    public function test_invite_rejects_duplicate_email(): void
    {
        $this->actingAs($this->tenantAdmin, 'sanctum');

        $response = $this->postJson('/api/admin/users/invite', [
            'email' => $this->tenantAdmin->email,
            'role' => 'trafficker',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['email']);
    }

    // ─── POST /api/auth/register ──────────────────────────────────────────

    public function test_user_can_register_with_valid_token(): void
    {
        $token = Str::random(64);

        UserInvitation::create([
            'tenant_id' => $this->tenant->id,
            'email' => 'newuser@example.com',
            'role' => 'trafficker',
            'token' => $token,
            'expires_at' => Carbon::now()->addHours(48),
        ]);

        $response = $this->postJson('/api/auth/register', [
            'token' => $token,
            'password' => 'SecurePass123!',
            'password_confirmation' => 'SecurePass123!',
        ]);

        $response->assertCreated()
            ->assertJson([
                'message' => 'Registration completed successfully.',
            ]);

        $this->assertDatabaseHas('users', [
            'email' => 'newuser@example.com',
            'role' => 'trafficker',
            'tenant_id' => $this->tenant->id,
            'is_active' => true,
        ]);
    }

    public function test_register_rejects_expired_token(): void
    {
        $token = Str::random(64);

        UserInvitation::create([
            'tenant_id' => $this->tenant->id,
            'email' => 'newuser@example.com',
            'role' => 'trafficker',
            'token' => $token,
            'expires_at' => Carbon::now()->subHours(1),
        ]);

        $response = $this->postJson('/api/auth/register', [
            'token' => $token,
            'password' => 'SecurePass123!',
            'password_confirmation' => 'SecurePass123!',
        ]);

        $response->assertUnprocessable()
            ->assertJson([
                'error' => 'Invitation expired',
            ]);
    }

    public function test_register_rejects_invalid_token(): void
    {
        $response = $this->postJson('/api/auth/register', [
            'token' => Str::random(64),
            'password' => 'SecurePass123!',
            'password_confirmation' => 'SecurePass123!',
        ]);

        $response->assertUnprocessable()
            ->assertJson([
                'error' => 'Invitation expired',
            ]);
    }

    public function test_register_requires_password_confirmation(): void
    {
        $response = $this->postJson('/api/auth/register', [
            'token' => Str::random(64),
            'password' => 'SecurePass123!',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['password']);
    }

    public function test_register_requires_minimum_password_length(): void
    {
        $response = $this->postJson('/api/auth/register', [
            'token' => Str::random(64),
            'password' => 'short',
            'password_confirmation' => 'short',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['password']);
    }

    // ─── POST /api/auth/forgot-password ───────────────────────────────────

    public function test_forgot_password_sends_reset_email(): void
    {
        Mail::fake();

        $user = User::factory()->tenantAdmin()->create([
            'tenant_id' => $this->tenant->id,
            'email' => 'user@example.com',
        ]);

        $response = $this->postJson('/api/auth/forgot-password', [
            'email' => 'user@example.com',
        ]);

        $response->assertOk()
            ->assertJson([
                'message' => 'If the email exists in our system, a password reset link has been sent.',
            ]);

        $this->assertDatabaseHas('password_resets', [
            'user_id' => $user->id,
        ]);
    }

    public function test_forgot_password_does_not_leak_user_existence(): void
    {
        $response = $this->postJson('/api/auth/forgot-password', [
            'email' => 'nonexistent@example.com',
        ]);

        $response->assertOk()
            ->assertJson([
                'message' => 'If the email exists in our system, a password reset link has been sent.',
            ]);
    }

    public function test_forgot_password_requires_valid_email(): void
    {
        $response = $this->postJson('/api/auth/forgot-password', [
            'email' => 'not-an-email',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['email']);
    }

    // ─── POST /api/auth/reset-password ────────────────────────────────────

    public function test_user_can_reset_password_with_valid_token(): void
    {
        $user = User::factory()->tenantAdmin()->create([
            'tenant_id' => $this->tenant->id,
        ]);

        $token = Str::random(64);

        PasswordReset::create([
            'user_id' => $user->id,
            'token' => $token,
            'expires_at' => Carbon::now()->addHour(),
        ]);

        $response = $this->postJson('/api/auth/reset-password', [
            'token' => $token,
            'password' => 'NewSecurePass123!',
            'password_confirmation' => 'NewSecurePass123!',
        ]);

        $response->assertOk()
            ->assertJson([
                'message' => 'Password reset successfully.',
            ]);

        // Verify the password was updated
        $user->refresh();
        $this->assertTrue(
            \Illuminate\Support\Facades\Hash::check('NewSecurePass123!', $user->password_hash)
        );
    }

    public function test_reset_password_rejects_expired_token(): void
    {
        $user = User::factory()->tenantAdmin()->create([
            'tenant_id' => $this->tenant->id,
        ]);

        $token = Str::random(64);

        PasswordReset::create([
            'user_id' => $user->id,
            'token' => $token,
            'expires_at' => Carbon::now()->subHour(),
        ]);

        $response = $this->postJson('/api/auth/reset-password', [
            'token' => $token,
            'password' => 'NewSecurePass123!',
            'password_confirmation' => 'NewSecurePass123!',
        ]);

        $response->assertUnprocessable()
            ->assertJson([
                'error' => 'Token expired',
            ]);
    }

    public function test_reset_password_rejects_invalid_token(): void
    {
        $response = $this->postJson('/api/auth/reset-password', [
            'token' => Str::random(64),
            'password' => 'NewSecurePass123!',
            'password_confirmation' => 'NewSecurePass123!',
        ]);

        $response->assertUnprocessable()
            ->assertJson([
                'error' => 'Token expired',
            ]);
    }

    public function test_reset_password_requires_password_confirmation(): void
    {
        $response = $this->postJson('/api/auth/reset-password', [
            'token' => Str::random(64),
            'password' => 'NewSecurePass123!',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['password']);
    }
}
