<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Extends the device_commands.type column to include
     * speed_override and preview_content for Modo Testigo.
     */
    public function up(): void
    {
        // Convert enum to VARCHAR and update CHECK constraint to include new types
        DB::statement("ALTER TABLE device_commands ALTER COLUMN type TYPE VARCHAR(20)");
        DB::statement("ALTER TABLE device_commands DROP CONSTRAINT IF EXISTS device_commands_type_check");
        DB::statement("ALTER TABLE device_commands ADD CONSTRAINT device_commands_type_check CHECK (type IN ('screenshot', 'config_update', 'playlist_update', 'speed_override', 'preview_content'))");
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        DB::statement("ALTER TABLE device_commands DROP CONSTRAINT IF EXISTS device_commands_type_check");
        DB::statement("ALTER TABLE device_commands ADD CONSTRAINT device_commands_type_check CHECK (type IN ('screenshot', 'config_update', 'playlist_update'))");
    }
};
