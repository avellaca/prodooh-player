<?php

namespace App\Providers;

use App\Models\Order;
use App\Models\OrderLine;
use App\Models\Creative;
use App\Observers\OrderObserver;
use App\Observers\OrderLineObserver;
use App\Observers\CreativeObserver;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        Order::observe(OrderObserver::class);
        OrderLine::observe(OrderLineObserver::class);
        Creative::observe(CreativeObserver::class);
    }
}
