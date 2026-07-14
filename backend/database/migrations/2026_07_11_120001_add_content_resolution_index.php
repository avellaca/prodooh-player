<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Makes width/height nullable (to support legacy content without dimensions)
     * and adds a composite index for resolution-based filtering.
     */
    public function up(): void
    {
        Schema::table('content', function (Blueprint $table) {
            // Make width and height nullable for legacy content without dimensions
            $table->integer('width')->nullable()->change();
            $table->integer('height')->nullable()->change();

            // Composite index to optimize content filtered by resolution
            $table->index(['width', 'height'], 'idx_content_resolution');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('content', function (Blueprint $table) {
            $table->dropIndex('idx_content_resolution');

            // Revert width and height to NOT NULL
            $table->integer('width')->nullable(false)->change();
            $table->integer('height')->nullable(false)->change();
        });
    }
};
