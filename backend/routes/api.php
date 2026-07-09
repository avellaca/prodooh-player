<?php

use App\Http\Controllers\Admin\AdminAuthController;
use App\Http\Controllers\Admin\ContentController;
use App\Http\Controllers\Admin\ContentPreviewController;
use App\Http\Controllers\Admin\LoopConfigController;
use App\Http\Controllers\Admin\PlaybackAnalyticsController;
use App\Http\Controllers\Admin\PlaylistController;
use App\Http\Controllers\Admin\ScreenController;
use App\Http\Controllers\Admin\ScreenGroupController;
use App\Http\Controllers\Admin\ScreenshotViewController;
use App\Http\Controllers\Admin\SourceToggleController;
use App\Http\Controllers\Admin\TenantController;
use App\Http\Controllers\Device\ConfigSyncController;
use App\Http\Controllers\Device\DeviceAuthController;
use App\Http\Controllers\Device\HeartbeatController;
use App\Http\Controllers\Device\PlaybackLogController;
use App\Http\Controllers\Device\PlaylistSyncController;
use App\Http\Controllers\Device\ScreenshotController;
use App\Http\Middleware\DeviceJwtAuth;
use App\Http\Middleware\TenantScopeMiddleware;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Device API Routes
|--------------------------------------------------------------------------
|
| Routes for device-facing endpoints. These use JWT-based
| authentication for player devices.
|
*/

Route::prefix('device')->group(function () {
    // Public device routes (auth)
    Route::post('/auth', [DeviceAuthController::class, 'auth'])->name('device.auth');

    // Protected device routes (JWT auth)
    Route::middleware([DeviceJwtAuth::class])->group(function () {
        Route::get('/config', ConfigSyncController::class)->name('device.config');

        Route::post('/heartbeat', HeartbeatController::class)->name('device.heartbeat');

        Route::get('/playlist', [PlaylistSyncController::class, 'index'])->name('device.playlist');

        Route::post('/playlist/confirm', [PlaylistSyncController::class, 'confirm'])->name('device.playlist.confirm');

        Route::get('/content/{id}/file', [PlaylistSyncController::class, 'serveContentFile'])->name('device.content.file');

        Route::post('/playback-logs', [PlaybackLogController::class, 'store'])->name('device.playback-logs');

        Route::post('/screenshot', [ScreenshotController::class, 'store'])->name('device.screenshot');

        Route::post('/prodooh/ad', [\App\Http\Controllers\Device\ProDoohProxyController::class, 'fetchAd'])->name('device.prodooh.ad');
    });
});

/*
|--------------------------------------------------------------------------
| Admin API Routes
|--------------------------------------------------------------------------
|
| Routes for admin panel endpoints. These use Laravel Sanctum
| for SPA/token-based authentication.
|
*/

Route::prefix('admin')->group(function () {
    // Public admin routes (login)
    Route::post('/login', [AdminAuthController::class, 'login'])->name('admin.login');

    // Protected admin routes (Sanctum auth + tenant scope)
    Route::middleware(['auth:sanctum', TenantScopeMiddleware::class])->group(function () {
        Route::post('/logout', [AdminAuthController::class, 'logout'])->name('admin.logout');

        Route::get('/user', function () {
            return response()->json(request()->user());
        })->name('admin.user');

        // Tenant management — super-admin only
        Route::middleware('role:super_admin')->group(function () {
            Route::get('/tenants', [TenantController::class, 'index'])->name('admin.tenants.index');
            Route::post('/tenants', [TenantController::class, 'store'])->name('admin.tenants.store');
            Route::get('/tenants/{id}', [TenantController::class, 'show'])->name('admin.tenants.show');
            Route::put('/tenants/{id}', [TenantController::class, 'update'])->name('admin.tenants.update');
            Route::delete('/tenants/{id}', [TenantController::class, 'destroy'])->name('admin.tenants.destroy');
        });

        // Routes accessible by both super-admin and tenant-admin
        Route::middleware('role:super_admin,tenant_admin')->group(function () {
            // Screen management
            Route::get('/screens', [ScreenController::class, 'index'])->name('admin.screens.index');
            Route::post('/screens', [ScreenController::class, 'store'])->name('admin.screens.store');
            Route::get('/screens/{id}', [ScreenController::class, 'show'])->name('admin.screens.show');
            Route::put('/screens/{id}', [ScreenController::class, 'update'])->name('admin.screens.update');
            Route::delete('/screens/{id}', [ScreenController::class, 'destroy'])->name('admin.screens.destroy');
            Route::post('/screens/{id}/regenerate-token', [ScreenController::class, 'regenerateToken'])->name('admin.screens.regenerateToken');

            // Screen group management
            Route::get('/groups', [ScreenGroupController::class, 'index'])->name('admin.groups.index');
            Route::post('/groups', [ScreenGroupController::class, 'store'])->name('admin.groups.store');
            Route::get('/groups/{id}', [ScreenGroupController::class, 'show'])->name('admin.groups.show');
            Route::put('/groups/{id}', [ScreenGroupController::class, 'update'])->name('admin.groups.update');
            Route::delete('/groups/{id}', [ScreenGroupController::class, 'destroy'])->name('admin.groups.destroy');
            Route::post('/groups/{id}/screens', [ScreenGroupController::class, 'assignScreens'])->name('admin.groups.assignScreens');

            // Loop configuration
            Route::put('/screens/{id}/loop', [LoopConfigController::class, 'update'])->name('admin.screens.loop.update');

            // Source toggle (enable/disable sources per screen)
            Route::put('/screens/{id}/sources', [SourceToggleController::class, 'update'])->name('admin.screens.sources.update');

            // Playlist management
            Route::get('/playlists', [PlaylistController::class, 'index'])->name('admin.playlists.index');
            Route::post('/playlists', [PlaylistController::class, 'store'])->name('admin.playlists.store');
            Route::get('/playlists/{id}', [PlaylistController::class, 'show'])->name('admin.playlists.show');
            Route::put('/playlists/{id}', [PlaylistController::class, 'update'])->name('admin.playlists.update');
            Route::delete('/playlists/{id}', [PlaylistController::class, 'destroy'])->name('admin.playlists.destroy');
            Route::post('/playlists/{id}/assign', [PlaylistController::class, 'assign'])->name('admin.playlists.assign');

            // Content library
            Route::get('/content', [ContentController::class, 'index'])->name('admin.content.index');
            Route::post('/content', [ContentController::class, 'store'])->name('admin.content.store');
            Route::delete('/content/{id}', [ContentController::class, 'destroy'])->name('admin.content.destroy');
            Route::put('/content/{id}/rotate', [ContentController::class, 'rotate'])->name('admin.content.rotate');
            Route::get('/content/{id}/preview', [ContentPreviewController::class, 'show'])->name('admin.content.preview');
            Route::get('/content/{id}/preview/file', [ContentController::class, 'serveFile'])->name('admin.content.preview.file');

            // Playlist item preview (supports URL items)
            Route::get('/playlist-items/{id}/preview', [ContentPreviewController::class, 'showPlaylistItem'])->name('admin.playlist-items.preview');

            // Analytics
            Route::get('/analytics/playback', [PlaybackAnalyticsController::class, 'index'])->name('admin.analytics.playback');

            // Screenshot viewing
            Route::get('/screens/{id}/screenshots', [ScreenshotViewController::class, 'index'])->name('admin.screens.screenshots');
        });
    });
});
