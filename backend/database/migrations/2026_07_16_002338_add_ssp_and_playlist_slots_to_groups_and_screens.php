<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('screen_groups', function (Blueprint $table) {
            $table->unsignedSmallInteger('ssp_slots')->nullable()->after('num_slots');
            $table->unsignedSmallInteger('playlist_slots')->nullable()->after('ssp_slots');
        });

        Schema::table('screens', function (Blueprint $table) {
            $table->unsignedSmallInteger('ssp_slots')->nullable()->after('num_slots');
            $table->unsignedSmallInteger('playlist_slots')->nullable()->after('ssp_slots');
        });
    }

    public function down(): void
    {
        Schema::table('screen_groups', function (Blueprint $table) {
            $table->dropColumn(['ssp_slots', 'playlist_slots']);
        });

        Schema::table('screens', function (Blueprint $table) {
            $table->dropColumn(['ssp_slots', 'playlist_slots']);
        });
    }
};
