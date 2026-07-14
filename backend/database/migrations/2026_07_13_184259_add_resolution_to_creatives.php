<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('creatives', function (Blueprint $table) {
            $table->integer('resolution_width')->nullable()->after('weight');
            $table->integer('resolution_height')->nullable()->after('resolution_width');
            $table->index(['resolution_width', 'resolution_height'], 'idx_creatives_resolution');
        });
    }

    public function down(): void
    {
        Schema::table('creatives', function (Blueprint $table) {
            $table->dropIndex('idx_creatives_resolution');
            $table->dropColumn(['resolution_width', 'resolution_height']);
        });
    }
};
