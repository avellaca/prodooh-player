<?php

namespace App\Console\Commands;

use App\Jobs\RecalculateManifestJob;
use App\Models\Screen;
use Illuminate\Console\Command;

class MidnightRolloverCommand extends Command
{
    /**
     * The name and signature of the console command.
     */
    protected $signature = 'manifest:rollover';

    /**
     * The console command description.
     */
    protected $description = 'Recalculate manifests for all screens at midnight rollover';

    /**
     * Execute the console command.
     */
    public function handle(): int
    {
        $screens = Screen::all();
        $count = 0;

        foreach ($screens as $screen) {
            RecalculateManifestJob::dispatch($screen->id, false);
            $count++;
        }

        $this->info("Dispatched recalculation for {$count} screens.");

        return self::SUCCESS;
    }
}
