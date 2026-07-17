<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ssp_definitions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name');             // e.g., "Prodooh", "Hivestack"
            $table->string('slug')->unique();   // e.g., "prodooh", "hivestack"
            $table->string('logo_url')->nullable();
            $table->string('base_url');         // API base URL
            $table->string('description')->nullable();
            $table->json('credential_fields');  // Schema: [{key, label, type}]
            $table->boolean('active')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ssp_definitions');
    }
};
