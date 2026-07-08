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
        Schema::create('screens', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->uuid('group_id')->nullable();
            $table->string('venue_id')->unique();
            $table->string('device_token_hash');
            $table->string('name');
            $table->enum('status', ['online', 'offline', 'unresponsive'])->default('offline');
            $table->string('orientation')->default('landscape'); // landscape | portrait
            $table->integer('resolution_width')->default(1920);
            $table->integer('resolution_height')->default(1080);
            $table->integer('duration_seconds')->nullable(); // nullable, override from group/tenant
            $table->jsonb('schedule')->nullable(); // nullable, override from group/tenant
            $table->jsonb('loop_config');
            $table->jsonb('sources_config');
            $table->string('transition_type')->nullable();
            $table->integer('transition_duration_ms')->nullable();
            $table->string('playlist_version')->default('');
            $table->timestamp('last_heartbeat')->nullable();
            $table->jsonb('last_storage_status')->nullable();
            $table->timestamps();

            $table->foreign('tenant_id')
                ->references('id')
                ->on('tenants')
                ->onDelete('cascade');

            $table->foreign('group_id')
                ->references('id')
                ->on('screen_groups')
                ->onDelete('set null');

            $table->index('tenant_id');
            $table->index('group_id');
            $table->index('status');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('screens');
    }
};
