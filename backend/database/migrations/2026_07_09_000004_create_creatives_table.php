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
        Schema::create('creatives', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('order_line_id');
            $table->uuid('content_id');
            $table->integer('weight')->default(100);
            $table->jsonb('active_dates');
            $table->timestamps();

            $table->foreign('order_line_id')->references('id')->on('order_lines')->onDelete('cascade');
            $table->foreign('content_id')->references('id')->on('content')->onDelete('restrict');

            $table->index('order_line_id');
            $table->index('content_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('creatives');
    }
};
