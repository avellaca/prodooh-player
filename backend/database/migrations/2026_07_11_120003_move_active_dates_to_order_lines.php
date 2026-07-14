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
        // Step 1: Add active_dates column to order_lines
        Schema::table('order_lines', function (Blueprint $table) {
            $table->jsonb('active_dates')->nullable()->default(null)->after('ends_at');
        });

        // Step 2: Migrate data — union of all creative active_dates per order line
        DB::statement("
            UPDATE order_lines
            SET active_dates = sub.merged_dates
            FROM (
                SELECT olt.order_line_id,
                       jsonb_agg(DISTINCT elem ORDER BY elem) AS merged_dates
                FROM order_line_targets olt
                JOIN creatives c ON c.order_line_target_id = olt.id
                CROSS JOIN LATERAL jsonb_array_elements_text(c.active_dates) AS elem
                WHERE c.active_dates IS NOT NULL
                  AND jsonb_array_length(c.active_dates) > 0
                GROUP BY olt.order_line_id
            ) sub
            WHERE order_lines.id = sub.order_line_id
        ");

        // Step 3: Remove active_dates column from creatives
        Schema::table('creatives', function (Blueprint $table) {
            $table->dropColumn('active_dates');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        // Restore active_dates column on creatives
        Schema::table('creatives', function (Blueprint $table) {
            $table->jsonb('active_dates')->nullable()->after('weight');
        });

        // Remove active_dates column from order_lines
        Schema::table('order_lines', function (Blueprint $table) {
            $table->dropColumn('active_dates');
        });
    }
};
