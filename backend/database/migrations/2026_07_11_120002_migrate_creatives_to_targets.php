<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Distributes existing creatives (linked to order_line_id without order_line_target_id)
     * to the targets of their order line. The original creative is assigned to the first target,
     * and duplicates are created for the remaining targets.
     *
     * Idempotent: only processes creatives where order_line_target_id IS NULL.
     */
    public function up(): void
    {
        $processed = 0;
        $duplicated = 0;
        $errors = 0;
        $skipped = 0;

        // Only process creatives that have order_line_id but no order_line_target_id (idempotent)
        $creativesLegacy = DB::table('creatives')
            ->whereNotNull('order_line_id')
            ->whereNull('order_line_target_id')
            ->get();

        Log::info("[migrate_creatives_to_targets] Starting migration. Legacy creatives to process: {$creativesLegacy->count()}");

        foreach ($creativesLegacy as $creative) {
            try {
                // Find all targets for this creative's order line
                $targets = DB::table('order_line_targets')
                    ->where('order_line_id', $creative->order_line_id)
                    ->orderBy('created_at', 'asc')
                    ->get();

                if ($targets->isEmpty()) {
                    // No targets: keep the creative as-is (legacy without targets)
                    $skipped++;
                    continue;
                }

                // Assign the original creative to the first target
                DB::table('creatives')
                    ->where('id', $creative->id)
                    ->update(['order_line_target_id' => $targets->first()->id]);

                $processed++;

                // Duplicate for remaining targets
                foreach ($targets->skip(1) as $target) {
                    DB::table('creatives')->insert([
                        'id' => Str::uuid()->toString(),
                        'order_line_target_id' => $target->id,
                        'order_line_id' => $creative->order_line_id,
                        'content_id' => $creative->content_id,
                        'weight' => $creative->weight,
                        'active_dates' => $creative->active_dates,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);

                    $duplicated++;
                }
            } catch (\Exception $e) {
                $errors++;
                Log::error("[migrate_creatives_to_targets] Error processing creative {$creative->id}: {$e->getMessage()}");
            }
        }

        Log::info("[migrate_creatives_to_targets] Migration complete. Processed: {$processed}, Duplicated: {$duplicated}, Skipped (no targets): {$skipped}, Errors: {$errors}");
    }

    /**
     * Reverse the migrations.
     *
     * Remove the order_line_target_id assignment and delete duplicated creatives.
     * Duplicated creatives are identified by having a created_at after the original
     * and the same content_id + order_line_id combination.
     */
    public function down(): void
    {
        // Remove order_line_target_id from all creatives that were migrated
        // (reset them back to order_line_id-only state)
        DB::table('creatives')
            ->whereNotNull('order_line_target_id')
            ->whereNotNull('order_line_id')
            ->update(['order_line_target_id' => null]);

        Log::info("[migrate_creatives_to_targets] Rollback: cleared order_line_target_id from all migrated creatives. Note: duplicated creatives are NOT automatically deleted to prevent data loss.");
    }
};
