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
        Schema::create('tenants', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name');
            $table->string('api_credential')->unique();
            $table->jsonb('default_config')->nullable();
            $table->integer('default_duration_seconds')->default(10);
            $table->string('default_timezone')->default('UTC');
            $table->jsonb('default_schedule')->nullable();
            $table->string('transition_type')->default('cut');
            $table->integer('transition_duration_ms')->default(0);
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('tenants');
    }
};
