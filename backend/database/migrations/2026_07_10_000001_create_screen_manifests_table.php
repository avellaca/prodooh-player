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
        Schema::create('screen_manifests', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('screen_id')->unique();
            $table->string('version', 64);
            $table->timestamp('generated_at');
            $table->jsonb('items');
            $table->integer('total_spots');
            $table->integer('remaining_spots');
            $table->timestamp('created_at')->useCurrent();

            $table->foreign('screen_id')
                ->references('id')
                ->on('screens')
                ->onDelete('cascade');

            $table->index('screen_id', 'idx_screen_manifests_screen_id');
            $table->index('version', 'idx_screen_manifests_version');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('screen_manifests');
    }
};
