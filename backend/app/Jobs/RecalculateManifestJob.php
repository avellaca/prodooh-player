<?php

namespace App\Jobs;

use App\Models\Screen;
use App\Services\ManifestGeneratorInterface;
use App\Services\PriorityEngineInterface;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class RecalculateManifestJob implements ShouldQueue, ShouldBeUnique
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public readonly string $screenId,
        public readonly bool $isIntraDay = false,
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
     * Orchestrates:
     * 1. PriorityEngine::recalculate() — computes allocations and sequence
     * 2. ManifestGenerator::generate() — persists the manifest with creative selection
     */
    public function handle(PriorityEngineInterface $engine, ManifestGeneratorInterface $generator): void
    {
        $result = $engine->recalculate($this->screenId, $this->isIntraDay);

        $screen = Screen::findOrFail($this->screenId);

        $generator->generate(
            $screen,
            $result['sequence'],
            $result['ssp_slots'],
            $result['playlist_slots'],
        );
    }
}
