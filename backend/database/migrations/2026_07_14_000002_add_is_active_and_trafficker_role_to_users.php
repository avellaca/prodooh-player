<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Adds is_active boolean column and updates role enum to include 'trafficker'.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('is_active')->default(true)->after('role');
        });

        // Update the role enum to include 'trafficker'
        DB::statement("ALTER TABLE users DROP CONSTRAINT users_role_check");
        DB::statement("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role::text = ANY (ARRAY['super_admin'::text, 'tenant_admin'::text, 'trafficker'::text]))");
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        // Revert role enum to exclude 'trafficker'
        // First, update any trafficker users to tenant_admin to satisfy the constraint
        DB::table('users')->where('role', 'trafficker')->update(['role' => 'tenant_admin']);

        DB::statement("ALTER TABLE users DROP CONSTRAINT users_role_check");
        DB::statement("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role::text = ANY (ARRAY['super_admin'::text, 'tenant_admin'::text]))");

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('is_active');
        });
    }
};
