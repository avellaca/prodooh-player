<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

class SuperAdminSeeder extends Seeder
{
    /**
     * Seed a default super-admin user.
     */
    public function run(): void
    {
        User::updateOrCreate(
            ['email' => 'admin@prodooh.com'],
            [
                'tenant_id' => null,
                'password_hash' => 'password',
                'role' => 'super_admin',
            ]
        );
    }
}
