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
        Schema::create('order_line_targets', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('order_line_id');
            $table->uuid('screen_id')->nullable();
            $table->uuid('screen_group_id')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->foreign('order_line_id')->references('id')->on('order_lines')->onDelete('cascade');
            $table->foreign('screen_id')->references('id')->on('screens')->onDelete('cascade');
            $table->foreign('screen_group_id')->references('id')->on('screen_groups')->onDelete('cascade');

            $table->index('order_line_id');
            $table->index('screen_id');
            $table->index('screen_group_id');
        });

        // XOR constraint: exactly one of screen_id/screen_group_id must be non-null
        DB::statement('ALTER TABLE order_line_targets ADD CONSTRAINT order_line_targets_xor_check CHECK ((screen_id IS NOT NULL AND screen_group_id IS NULL) OR (screen_id IS NULL AND screen_group_id IS NOT NULL))');
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        DB::statement('ALTER TABLE order_line_targets DROP CONSTRAINT IF EXISTS order_line_targets_xor_check');
        Schema::dropIfExists('order_line_targets');
    }
};
