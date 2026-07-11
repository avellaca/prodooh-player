<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Simplifies the `source` column in `impressions` from an enum
     * ('order_line', 'playlist', 'prodooh_ssp') to VARCHAR(20) with a
     * CHECK constraint limited to 'order_line' only.
     *
     * Requirements: 14.1
     */
    public function up(): void
    {
        // Convert enum column to VARCHAR(20)
        DB::statement("ALTER TABLE impressions ALTER COLUMN source TYPE VARCHAR(20)");

        // Drop existing enum constraint if present
        DB::statement("ALTER TABLE impressions DROP CONSTRAINT IF EXISTS impressions_source_check");

        // Add new CHECK constraint allowing only 'order_line'
        DB::statement("ALTER TABLE impressions ADD CONSTRAINT impressions_source_check CHECK (source IN ('order_line'))");
    }

    /**
     * Reverse the migrations.
     *
     * Restores the original enum type with all three values.
     */
    public function down(): void
    {
        // Drop the simplified CHECK constraint
        DB::statement("ALTER TABLE impressions DROP CONSTRAINT IF EXISTS impressions_source_check");

        // Recreate as enum type with original values
        DB::statement("DROP TYPE IF EXISTS impressions_source_enum");
        DB::statement("CREATE TYPE impressions_source_enum AS ENUM ('order_line', 'playlist', 'prodooh_ssp')");
        DB::statement("ALTER TABLE impressions ALTER COLUMN source TYPE impressions_source_enum USING source::impressions_source_enum");
    }
};
