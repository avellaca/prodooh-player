<?php

namespace App\Providers;

use App\Services\BresenhamInterleaver;
use App\Services\BresenhamInterleaverInterface;
use App\Services\CreativeSelector;
use App\Services\CreativeSelectorInterface;
use App\Services\ManifestGenerator;
use App\Services\ManifestGeneratorInterface;
use App\Services\PriorityEngine;
use App\Services\PriorityEngineInterface;
use Illuminate\Support\ServiceProvider;

class ManifestServiceProvider extends ServiceProvider
{
    /**
     * Register manifest engine service bindings.
     */
    public function register(): void
    {
        $this->app->bind(BresenhamInterleaverInterface::class, BresenhamInterleaver::class);
        $this->app->bind(CreativeSelectorInterface::class, CreativeSelector::class);
        $this->app->bind(ManifestGeneratorInterface::class, ManifestGenerator::class);
        $this->app->bind(PriorityEngineInterface::class, PriorityEngine::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}
