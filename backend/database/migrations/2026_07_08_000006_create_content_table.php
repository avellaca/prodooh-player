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
        Schema::create('content', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->string('filename');
            $table->string('mime_type');
            $table->string('storage_path');
            $table->integer('file_size_bytes');
            $table->integer('width');
            $table->integer('height');
            $table->integer('duration_seconds')->nullable();
            $table->string('orientation');
            $table->integer('rotation')->default(0);
            $table->string('checksum_sha256');
            $table->timestamp('created_at')->useCurrent();

            $table->foreign('tenant_id')
                ->references('id')
                ->on('tenants')
                ->onDelete('cascade');

            $table->index('tenant_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('content');
    }
};
