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
        Schema::table('tenants', function (Blueprint $table) {
            $table->unsignedSmallInteger('num_slots')->default(10);
            $table->unsignedSmallInteger('ssp_slots')->default(2);
            $table->unsignedSmallInteger('playlist_slots')->default(1);
            $table->unsignedSmallInteger('sync_interval_seconds')->default(240);
            $table->unsignedSmallInteger('cache_flush_interval_hours')->default(24);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('tenants', function (Blueprint $table) {
            $table->dropColumn([
                'num_slots',
                'ssp_slots',
                'playlist_slots',
                'sync_interval_seconds',
                'cache_flush_interval_hours',
            ]);
        });
    }
};
