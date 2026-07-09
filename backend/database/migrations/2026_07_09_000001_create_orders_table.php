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
        Schema::create('orders', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->string('name');
            $table->string('advertiser_name')->nullable();
            $table->date('starts_at');
            $table->date('ends_at');
            $table->enum('status', ['draft', 'active', 'paused', 'finished'])->default('draft');
            $table->timestamps();

            $table->foreign('tenant_id')->references('id')->on('tenants')->onDelete('cascade');

            $table->index('tenant_id');
            $table->index('status');
            $table->index(['starts_at', 'ends_at']);
        });

        // Constraint: ends_at >= starts_at
        DB::statement('ALTER TABLE orders ADD CONSTRAINT orders_dates_check CHECK (ends_at >= starts_at)');
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        DB::statement('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_dates_check');
        Schema::dropIfExists('orders');
    }
};
