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
        Schema::table('order_line_targets', function (Blueprint $table) {
            $table->string('playback_mode_override', 20)->nullable()->after('screen_group_id');
        });

        DB::statement("ALTER TABLE order_line_targets ADD CONSTRAINT order_line_targets_playback_mode_override_check CHECK (playback_mode_override IS NULL OR playback_mode_override IN ('round_robin', 'sequential'))");
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        DB::statement('ALTER TABLE order_line_targets DROP CONSTRAINT IF EXISTS order_line_targets_playback_mode_override_check');

        Schema::table('order_line_targets', function (Blueprint $table) {
            $table->dropColumn('playback_mode_override');
        });
    }
};
