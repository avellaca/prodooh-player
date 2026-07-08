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
        Schema::create('playback_logs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('screen_id');
            $table->uuid('tenant_id');
            $table->string('content_id');
            $table->enum('source', ['prodooh', 'gam', 'url', 'playlist']);
            $table->timestamp('started_at');
            $table->timestamp('ended_at')->nullable();
            $table->decimal('duration_seconds', 10, 2)->nullable();
            $table->enum('result', ['success', 'failed']);
            $table->string('failure_reason')->nullable();
            $table->timestamp('synced_at')->nullable();
            $table->timestamps();

            $table->foreign('screen_id')
                ->references('id')
                ->on('screens')
                ->onDelete('cascade');

            $table->foreign('tenant_id')
                ->references('id')
                ->on('tenants')
                ->onDelete('cascade');

            $table->index('screen_id');
            $table->index('tenant_id');
            $table->index('started_at');
            $table->index('source');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('playback_logs');
    }
};
