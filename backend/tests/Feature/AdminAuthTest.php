<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AdminAuthTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_login_with_valid_credentials(): void
    {
        $user = User::factory()->superAdmin()->create([
            'email' => 'admin@prodooh.com',
            'password_hash' => 'password',
        ]);

        $response = $this->postJson('/api/admin/login', [
            'email' => 'admin@prodooh.com',
            'password' => 'password',
        ]);

        $response->assertOk()
            ->assertJsonStructure([
                'access_token',
                'token_type',
                'user' => ['id', 'email', 'role', 'tenant_id'],
            ])
            ->assertJson([
                'token_type' => 'Bearer',
                'user' => [
                    'email' => 'admin@prodooh.com',
                    'role' => 'super_admin',
                    'tenant_id' => null,
                ],
            ]);
    }

    public function test_login_fails_with_invalid_password(): void
    {
        User::factory()->superAdmin()->create([
            'email' => 'admin@prodooh.com',
            'password_hash' => 'password',
        ]);

        $response = $this->postJson('/api/admin/login', [
            'email' => 'admin@prodooh.com',
            'password' => 'wrong-password',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['email']);
    }

    public function test_login_fails_with_nonexistent_email(): void
    {
        $response = $this->postJson('/api/admin/login', [
            'email' => 'nonexistent@prodooh.com',
            'password' => 'password',
        ]);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['email']);
    }

    public function test_login_requires_email_and_password(): void
    {
        $response = $this->postJson('/api/admin/login', []);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['email', 'password']);
    }

    public function test_authenticated_admin_can_logout(): void
    {
        $user = User::factory()->superAdmin()->create();
        $token = $user->createToken('admin-token');

        $response = $this->withHeader('Authorization', 'Bearer ' . $token->plainTextToken)
            ->postJson('/api/admin/logout');

        $response->assertOk()
            ->assertJson(['message' => 'Successfully logged out.']);

        // Token should be revoked
        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_logout_requires_authentication(): void
    {
        $response = $this->postJson('/api/admin/logout');

        $response->assertUnauthorized();
    }
}
