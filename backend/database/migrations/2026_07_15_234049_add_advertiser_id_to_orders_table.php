<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->uuid('advertiser_id')->nullable()->after('tenant_id');
            $table->foreign('advertiser_id')->references('id')->on('advertisers')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropForeign(['advertiser_id']);
            $table->dropColumn('advertiser_id');
        });
    }
};
