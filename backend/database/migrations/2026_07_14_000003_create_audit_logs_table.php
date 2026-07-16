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
        Schema::create('audit_logs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('auditable_type');
            $table->uuid('auditable_id');
            $table->uuid('user_id')->nullable();
            $table->string('event_type');
            $table->jsonb('diff')->nullable();
            $table->timestamp('created_at');

            $table->index(['auditable_type', 'auditable_id']);
            $table->index('user_id');
            $table->index('created_at');

            $table->foreign('user_id')->references('id')->on('users')->nullOnDelete();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('audit_logs');
    }
};
