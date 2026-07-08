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
        Schema::create('device_commands', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('screen_id');
            $table->enum('type', ['screenshot', 'config_update', 'playlist_update']);
            $table->jsonb('payload')->nullable();
            $table->enum('status', ['pending', 'delivered', 'completed', 'failed'])->default('pending');
            $table->timestamp('created_at')->useCurrent();
            $table->timestamp('delivered_at')->nullable();

            $table->foreign('screen_id')
                ->references('id')
                ->on('screens')
                ->onDelete('cascade');

            $table->index('screen_id');
            $table->index('status');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('device_commands');
    }
};
