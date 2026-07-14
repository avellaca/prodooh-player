<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('screen_groups', function (Blueprint $table) {
            $table->dropColumn(['orientation', 'resolution_width', 'resolution_height']);
        });
    }

    public function down(): void
    {
        Schema::table('screen_groups', function (Blueprint $table) {
            $table->string('orientation')->nullable();
            $table->integer('resolution_width')->nullable();
            $table->integer('resolution_height')->nullable();
        });
    }
};
