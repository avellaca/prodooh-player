<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('order_lines', function (Blueprint $table) {
            $table->string('playback_mode', 20)->default('round_robin')->after('status');
        });

        DB::statement("ALTER TABLE order_lines ADD CONSTRAINT order_lines_playback_mode_check CHECK (playback_mode IN ('round_robin', 'sequential'))");
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        DB::statement('ALTER TABLE order_lines DROP CONSTRAINT IF EXISTS order_lines_playback_mode_check');

        Schema::table('order_lines', function (Blueprint $table) {
            $table->dropColumn('playback_mode');
        });
    }
};
