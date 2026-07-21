<?php

namespace App\Console\Commands;

use App\Models\Creative;
use App\Models\OrderLineTarget;
use App\Models\Screen;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class MigrateGroupCreativesCommand extends Command
{
    /**
     * The name and signature of the console command.
     */
    protected $signature = 'creatives:migrate-groups {--dry-run : Show what would be migrated without making changes}';

    /**
     * The console command description.
     */
    protected $description = 'Migrate group-level creatives to individual screen-level creatives';

    /**
     * Execute the console command.
     */
    public function handle(): int
    {
        $dryRun = $this->option('dry-run');

        if ($dryRun) {
            $this->info('Running in DRY-RUN mode. No changes will be made.');
        }

        // Find all creatives linked to OrderLineTargets with screen_group_id (not screen_id)
        $groupCreatives = Creative::whereHas('orderLineTarget', function ($query) {
            $query->whereNotNull('screen_group_id');
        })->with(['orderLineTarget.screenGroup.screens', 'content'])->get();

        if ($groupCreatives->isEmpty()) {
            $this->info('No group-level creatives found. Nothing to migrate.');

            return self::SUCCESS;
        }

        $this->info("Found {$groupCreatives->count()} group-level creative(s) to migrate.");

        $created = 0;
        $deleted = 0;
        $failed = 0;

        $bar = $this->output->createProgressBar($groupCreatives->count());
        $bar->start();

        foreach ($groupCreatives as $creative) {
            try {
                $this->migrateCreative($creative, $dryRun, $created, $deleted);
            } catch (\Throwable $e) {
                $failed++;
                $this->newLine();
                $this->error("Failed to migrate creative {$creative->id}: {$e->getMessage()}");
                Log::error('creatives:migrate-groups failed for creative', [
                    'creative_id' => $creative->id,
                    'order_line_target_id' => $creative->order_line_target_id,
                    'error' => $e->getMessage(),
                ]);
            }

            $bar->advance();
        }

        $bar->finish();
        $this->newLine(2);

        $this->info("Migration complete.");
        $this->table(
            ['Metric', 'Count'],
            [
                ['Group creatives processed', $groupCreatives->count()],
                ['Individual creatives created', $created],
                ['Group creatives deleted', $deleted],
                ['Failures', $failed],
            ]
        );

        if ($dryRun) {
            $this->warn('DRY-RUN: No actual changes were made.');
        }

        return self::SUCCESS;
    }

    /**
     * Migrate a single group-level creative to individual screen-level creatives.
     */
    private function migrateCreative(Creative $creative, bool $dryRun, int &$created, int &$deleted): void
    {
        $orderLineTarget = $creative->orderLineTarget;

        if (!$orderLineTarget || !$orderLineTarget->screenGroup) {
            throw new \RuntimeException("OrderLineTarget or ScreenGroup not found for creative {$creative->id}");
        }

        $screenGroup = $orderLineTarget->screenGroup;
        $screens = $screenGroup->screens;

        if ($screens->isEmpty()) {
            $this->newLine();
            $this->warn("ScreenGroup '{$screenGroup->name}' (ID: {$screenGroup->id}) has no screens. Skipping creative {$creative->id}.");

            return;
        }

        // Resolve resolution_width and resolution_height — fix nulls from Content
        $resolutionWidth = $creative->resolution_width;
        $resolutionHeight = $creative->resolution_height;

        if (($resolutionWidth === null || $resolutionHeight === null) && $creative->content) {
            $resolutionWidth = $creative->content->width;
            $resolutionHeight = $creative->content->height;
        }

        if ($dryRun) {
            $this->newLine();
            $this->line("  [DRY-RUN] Would create {$screens->count()} individual creative(s) from creative {$creative->id} (group: {$screenGroup->name})");
            $created += $screens->count();
            $deleted++;

            return;
        }

        DB::transaction(function () use ($creative, $screens, $orderLineTarget, $resolutionWidth, $resolutionHeight, &$created, &$deleted) {
            foreach ($screens as $screen) {
                // Find or create an OrderLineTarget for this individual screen
                $screenTarget = OrderLineTarget::firstOrCreate(
                    [
                        'order_line_id' => $orderLineTarget->order_line_id,
                        'screen_id' => $screen->id,
                    ],
                    [
                        'screen_group_id' => null,
                        'playback_mode_override' => $orderLineTarget->playback_mode_override,
                    ]
                );

                // Create individual Creative for this screen
                Creative::create([
                    'order_line_target_id' => $screenTarget->id,
                    'content_id' => $creative->content_id,
                    'weight' => $creative->weight,
                    'resolution_width' => $resolutionWidth,
                    'resolution_height' => $resolutionHeight,
                    'position' => $creative->position,
                ]);

                $created++;
            }

            // Delete the original group creative
            $creative->delete();
            $deleted++;
        });
    }
}
