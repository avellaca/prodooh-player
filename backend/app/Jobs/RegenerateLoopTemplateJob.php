<?php

namespace App\Jobs;

use App\Models\Screen;
use App\Services\LoopTemplateGeneratorInterface;
use Illuminate\Bus\Batchable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class RegenerateLoopTemplateJob implements ShouldQueue, ShouldBeUnique
{
    use Batchable, Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /**
     * Maximum time in seconds this job can run before timing out.
     */
    public int $timeout = 30;

    /**
     * Number of times the job may be attempted.
     */
    public int $tries = 2;

    public function __construct(
        public readonly string $screenId,
    ) {}

    /**
     * The unique ID used for deduplication.
     * Prevents concurrent jobs for the same screen.
     */
    public function uniqueId(): string
    {
        return $this->screenId;
    }

    /**
     * Execute the job.
     *
     * Generates a new Loop Template for the given screen using the LoopTemplateGenerator.
     * If the screen is not found (deleted), the job silently completes.
     */
    public function handle(LoopTemplateGeneratorInterface $generator): void
    {
        if ($this->batch()?->cancelled()) {
            return;
        }

        $screen = Screen::withoutGlobalScopes()->find($this->screenId);

        if (! $screen) {
            return;
        }

        $generator->generate($screen);
    }
}
