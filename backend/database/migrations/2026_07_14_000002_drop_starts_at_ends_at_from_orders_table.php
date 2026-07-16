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
        // Drop the check constraint first
        DB::statement('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_dates_check');

        // Drop the index on date columns
        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex(['starts_at', 'ends_at']);
        });

        // Drop the columns
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn(['starts_at', 'ends_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->date('starts_at')->nullable();
            $table->date('ends_at')->nullable();
            $table->index(['starts_at', 'ends_at']);
        });

        DB::statement('ALTER TABLE orders ADD CONSTRAINT orders_dates_check CHECK (ends_at >= starts_at)');
    }
};
