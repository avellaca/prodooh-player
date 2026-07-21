<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class FireTrackingPixelJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /**
     * Number of times the job may be attempted (1 initial + 3 retries).
     */
    public int $tries = 4;

    /**
     * Backoff intervals between retries (in seconds).
     */
    public array $backoff = [10, 60, 300];

    public function __construct(
        public readonly string $pixelUrl,
        public readonly string $creativeId,
        public readonly string $impressionId,
        public readonly int $multiplier = 1,
    ) {}

    /**
     * Execute the job.
     *
     * Fires the tracking pixel URL via HTTP GET, repeated `multiplier` times.
     */
    public function handle(): void
    {
        for ($i = 0; $i < $this->multiplier; $i++) {
            $response = Http::timeout(5)->get($this->pixelUrl);

            if (!$response->successful()) {
                throw new \RuntimeException("Pixel fire failed: HTTP {$response->status()}");
            }
        }
    }

    /**
     * Handle a job failure after all retries are exhausted.
     */
    public function failed(\Throwable $e): void
    {
        Log::error('TrackingPixel fire permanently failed', [
            'url' => $this->pixelUrl,
            'creative_id' => $this->creativeId,
            'impression_id' => $this->impressionId,
            'error' => $e->getMessage(),
        ]);
    }
}
