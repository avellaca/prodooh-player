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
        Schema::dropIfExists('playback_logs');

        Schema::create('impressions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('screen_id');
            $table->uuid('creative_id')->nullable();
            $table->uuid('order_line_id')->nullable();
            $table->enum('source', ['order_line', 'playlist', 'prodooh_ssp']);
            $table->timestamp('started_at');
            $table->timestamp('ended_at')->nullable();
            $table->decimal('duration_seconds', 10, 2)->nullable();
            $table->enum('result', ['success', 'failed']);
            $table->string('failure_reason')->nullable();
            $table->timestamp('synced_at')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->foreign('screen_id')->references('id')->on('screens')->onDelete('cascade');
            $table->foreign('creative_id')->references('id')->on('creatives')->onDelete('set null');
            $table->foreign('order_line_id')->references('id')->on('order_lines')->onDelete('set null');

            $table->index('screen_id');
            $table->index('creative_id');
            $table->index('order_line_id');
            $table->index('source');
            $table->index('started_at');
            $table->index('synced_at');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('impressions');

        // Recreate playback_logs with original structure
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

            $table->foreign('screen_id')->references('id')->on('screens')->onDelete('cascade');
            $table->foreign('tenant_id')->references('id')->on('tenants')->onDelete('cascade');

            $table->index('screen_id');
            $table->index('tenant_id');
            $table->index('started_at');
            $table->index('source');
        });
    }
};
