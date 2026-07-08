<?php

namespace App\Console\Commands;

use App\Services\DeviceStatusService;
use Illuminate\Console\Command;

class CheckDeviceStatus extends Command
{
    /**
     * The name and signature of the console command.
     */
    protected $signature = 'devices:check-status';

    /**
     * The console command description.
     */
    protected $description = 'Check all online devices and mark those past heartbeat threshold + grace period as unresponsive';

    /**
     * Execute the console command.
     */
    public function handle(DeviceStatusService $service): int
    {
        $count = $service->evaluateAllScreens();

        $this->info("Device status check complete. {$count} screen(s) marked as unresponsive.");

        return self::SUCCESS;
    }
}
