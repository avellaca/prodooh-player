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
            // Paso 1: Agregar nueva columna (nullable para migración gradual)
            $table->uuid('order_line_target_id')->nullable()->after('id');
            $table->foreign('order_line_target_id')
                  ->references('id')
                  ->on('order_line_targets')
                  ->onDelete('cascade');

            $table->index('order_line_target_id', 'idx_creatives_target_id');

            // Paso 2: Hacer order_line_id nullable (era NOT NULL)
            $table->uuid('order_line_id')->nullable()->change();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('creatives', function (Blueprint $table) {
            // Revertir order_line_id a NOT NULL
            $table->uuid('order_line_id')->nullable(false)->change();

            // Eliminar foreign key, índice y columna
            $table->dropForeign(['order_line_target_id']);
            $table->dropIndex('idx_creatives_target_id');
            $table->dropColumn('order_line_target_id');
        });
    }
};
