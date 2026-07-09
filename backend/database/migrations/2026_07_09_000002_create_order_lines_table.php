<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('order_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('order_id');
            $table->string('name');
            $table->enum('priority_tier', ['patrocinio', 'estandar', 'red_interna']);
            $table->date('starts_at');
            $table->date('ends_at');
            $table->integer('target_spots')->nullable();
            $table->enum('delivery_pace', ['asap', 'uniform'])->default('uniform');
            $table->integer('share_weight')->default(100);
            $table->jsonb('time_window')->nullable();
            $table->enum('status', ['draft', 'active', 'paused', 'finished'])->default('draft');
            $table->timestamps();

            $table->foreign('order_id')->references('id')->on('orders')->onDelete('cascade');

            $table->index('order_id');
            $table->index('priority_tier');
            $table->index('status');
            $table->index(['starts_at', 'ends_at']);
        });

        DB::statement('ALTER TABLE order_lines ADD CONSTRAINT order_lines_dates_check CHECK (ends_at >= starts_at)');
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        DB::statement('ALTER TABLE order_lines DROP CONSTRAINT IF EXISTS order_lines_dates_check');
        Schema::dropIfExists('order_lines');
    }
};
