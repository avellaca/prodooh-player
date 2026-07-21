<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('creatives', function (Blueprint $table) {
            $table->integer('position')->nullable()->after('resolution_height');
            $table->index(['order_line_target_id', 'position'], 'idx_creatives_target_position');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('creatives', function (Blueprint $table) {
            $table->dropIndex('idx_creatives_target_position');
            $table->dropColumn('position');
        });
    }
};
