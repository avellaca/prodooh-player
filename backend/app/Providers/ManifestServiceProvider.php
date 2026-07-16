<?php

namespace App\Providers;

use App\Services\AuditService;
use App\Services\AuditServiceInterface;
use App\Services\AvailabilityAnalyzer;
use App\Services\AvailabilityAnalyzerInterface;
use App\Services\BresenhamInterleaver;
use App\Services\BresenhamInterleaverInterface;
use App\Services\CreativeSelector;
use App\Services\CreativeSelectorInterface;
use App\Services\LoopTemplateGenerator;
use App\Services\LoopTemplateGeneratorInterface;
use App\Services\ManifestGenerator;
use App\Services\ManifestGeneratorInterface;
use App\Services\PriorityEngine;
use App\Services\PriorityEngineInterface;
use App\Services\RotationScheduler;
use App\Services\RotationSchedulerInterface;
use App\Services\SlotAllocator;
use App\Services\SlotAllocatorInterface;
use App\Services\UserInvitationService;
use App\Services\UserInvitationServiceInterface;
use Illuminate\Support\ServiceProvider;

class ManifestServiceProvider extends ServiceProvider
{
    /**
     * Register manifest engine service bindings.
     */
    public function register(): void
    {
        $this->app->bind(AuditServiceInterface::class, AuditService::class);
        $this->app->bind(AvailabilityAnalyzerInterface::class, AvailabilityAnalyzer::class);
        $this->app->bind(BresenhamInterleaverInterface::class, BresenhamInterleaver::class);
        $this->app->bind(CreativeSelectorInterface::class, CreativeSelector::class);
        $this->app->bind(LoopTemplateGeneratorInterface::class, LoopTemplateGenerator::class);
        $this->app->bind(ManifestGeneratorInterface::class, ManifestGenerator::class);
        $this->app->bind(PriorityEngineInterface::class, PriorityEngine::class);
        $this->app->bind(RotationSchedulerInterface::class, RotationScheduler::class);
        $this->app->bind(SlotAllocatorInterface::class, SlotAllocator::class);
        $this->app->bind(UserInvitationServiceInterface::class, UserInvitationService::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}
