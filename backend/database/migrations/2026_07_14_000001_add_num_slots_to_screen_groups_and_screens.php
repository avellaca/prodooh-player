<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('screen_groups', function (Blueprint $table) {
            $table->unsignedSmallInteger('num_slots')->nullable()->after('schedule');
        });

        Schema::table('screens', function (Blueprint $table) {
            $table->unsignedSmallInteger('num_slots')->nullable()->after('manifest_version');
        });
    }

    public function down(): void
    {
        Schema::table('screen_groups', function (Blueprint $table) {
            $table->dropColumn('num_slots');
        });

        Schema::table('screens', function (Blueprint $table) {
            $table->dropColumn('num_slots');
        });
    }
};
