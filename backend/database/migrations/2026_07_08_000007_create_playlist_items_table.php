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
        Schema::create('playlist_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('playlist_id');
            $table->uuid('content_id')->nullable();
            $table->enum('type', ['image', 'video', 'url']);
            $table->string('url')->nullable();
            $table->integer('duration_seconds')->nullable();
            $table->integer('position');
            $table->integer('refresh_interval')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->foreign('playlist_id')
                ->references('id')
                ->on('playlists')
                ->onDelete('cascade');

            $table->foreign('content_id')
                ->references('id')
                ->on('content')
                ->onDelete('set null');

            $table->index('playlist_id');
            $table->index('content_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('playlist_items');
    }
};
