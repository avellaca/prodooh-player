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
        Schema::create('tracking_pixels', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('trackable_type', 50);
            $table->uuid('trackable_id');
            $table->string('url', 2048);
            $table->string('trigger_type', 20);
            $table->integer('multiplier')->default(1);
            $table->timestamps();

            $table->index(['trackable_type', 'trackable_id']);
        });

        DB::statement("ALTER TABLE tracking_pixels ADD CONSTRAINT tracking_pixels_trigger_type_check CHECK (trigger_type IN ('play', 'impression'))");
        DB::statement("ALTER TABLE tracking_pixels ADD CONSTRAINT tracking_pixels_multiplier_check CHECK (multiplier >= 1)");
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('tracking_pixels');
    }
};
