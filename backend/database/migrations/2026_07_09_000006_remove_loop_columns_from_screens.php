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
        Schema::table('screens', function (Blueprint $table) {
            $table->dropColumn(['loop_config', 'sources_config', 'duration_seconds']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('screens', function (Blueprint $table) {
            $table->jsonb('loop_config')->nullable();
            $table->jsonb('sources_config')->nullable();
            $table->integer('duration_seconds')->nullable();
        });
    }
};
