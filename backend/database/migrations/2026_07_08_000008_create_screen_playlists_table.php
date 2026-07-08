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
        Schema::create('screen_playlists', function (Blueprint $table) {
            $table->uuid('screen_id');
            $table->uuid('playlist_id');
            $table->timestamp('assigned_at')->useCurrent();

            $table->primary(['screen_id', 'playlist_id']);

            $table->foreign('screen_id')
                ->references('id')
                ->on('screens')
                ->onDelete('cascade');

            $table->foreign('playlist_id')
                ->references('id')
                ->on('playlists')
                ->onDelete('cascade');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('screen_playlists');
    }
};
