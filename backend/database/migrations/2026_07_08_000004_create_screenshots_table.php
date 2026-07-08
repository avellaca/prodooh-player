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
        Schema::create('screenshots', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('screen_id');
            $table->string('storage_path');
            $table->timestamp('captured_at');
            $table->timestamp('created_at')->useCurrent();

            $table->foreign('screen_id')
                ->references('id')
                ->on('screens')
                ->onDelete('cascade');

            $table->index('screen_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('screenshots');
    }
};
