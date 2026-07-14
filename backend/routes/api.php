<?php

use App\Http\Controllers\Admin\AdminAuthController;
use App\Http\Controllers\Admin\BulkCreativeController;
use App\Http\Controllers\Admin\ContentController;
use App\Http\Controllers\Admin\ContentPreviewController;
use App\Http\Controllers\Admin\CreativeController;
use App\Http\Controllers\Admin\OrderController;
use App\Http\Controllers\Admin\OrderLineController;
use App\Http\Controllers\Admin\OrderLineTargetController;
use App\Http\Controllers\Admin\ResolutionController;
use App\Http\Controllers\Admin\PlaybackAnalyticsController;
use App\Http\Controllers\Admin\PlaylistController;
use App\Http\Controllers\Admin\ScreenCommandController;
use App\Http\Controllers\Admin\ScreenController;
use App\Http\Controllers\Admin\ScreenGroupController;
use App\Http\Controllers\Admin\ScreenshotViewController;
use App\Http\Controllers\Admin\TenantController;
use App\Http\Controllers\Device\DeviceAuthController;
use App\Http\Controllers\Device\HeartbeatController;
use App\Http\Controllers\Device\ImpressionsController;
use App\Http\Controllers\Device\ManifestController;
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
        Route::post('/heartbeat', HeartbeatController::class)->name('device.heartbeat');

        Route::get('/content/{id}/file', [PlaylistSyncController::class, 'serveContentFile'])->name('device.content.file');

        Route::post('/playback-logs', [PlaybackLogController::class, 'store'])->name('device.playback-logs');

        Route::post('/screenshot', [ScreenshotController::class, 'store'])->name('device.screenshot');

        Route::post('/prodooh/ad', [\App\Http\Controllers\Device\ProDoohProxyController::class, 'fetchAd'])->name('device.prodooh.ad');

        // Manifest-based endpoints (new motor de prioridad)
        Route::get('/manifest', [ManifestController::class, 'show'])->name('device.manifest');
        Route::post('/manifest/confirm', [ManifestController::class, 'confirm'])->name('device.manifest.confirm');
        Route::post('/impressions', [ImpressionsController::class, 'store'])->name('device.impressions');
    });
});

/*
|--------------------------------------------------------------------------
| Deprecated Device Endpoints — 410 Gone
|--------------------------------------------------------------------------
|
| These stubs respond with 410 Gone for old firmware that may still
| call deprecated endpoints. They are outside auth middleware because
| old devices might have expired tokens.
|
*/

$deprecatedMessage = ['message' => 'This endpoint has been deprecated. Please update your device firmware.'];

Route::get('/device/playlist', fn () => response()->json($deprecatedMessage, 410))->name('device.playlist.deprecated');
Route::post('/device/playlist/confirm', fn () => response()->json($deprecatedMessage, 410))->name('device.playlist.confirm.deprecated');
Route::get('/device/config', fn () => response()->json($deprecatedMessage, 410))->name('device.config.deprecated');
Route::put('/screens/{id}/loop', fn () => response()->json($deprecatedMessage, 410))->name('screens.loop.deprecated');
Route::put('/screens/{id}/sources', fn () => response()->json($deprecatedMessage, 410))->name('screens.sources.deprecated');

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

    // Public content file serving (used by <img> tags without Bearer token)
    Route::get('/content/{id}/preview/file', [ContentController::class, 'serveFile'])->name('admin.content.preview.file');

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
            // Order management
            Route::get('/orders', [OrderController::class, 'index'])->name('admin.orders.index');
            Route::post('/orders', [OrderController::class, 'store'])->name('admin.orders.store');
            Route::get('/orders/{id}', [OrderController::class, 'show'])->name('admin.orders.show');
            Route::put('/orders/{id}', [OrderController::class, 'update'])->name('admin.orders.update');
            Route::delete('/orders/{id}', [OrderController::class, 'destroy'])->name('admin.orders.destroy');

            // Order Lines (nested under orders)
            Route::get('/orders/{orderId}/order-lines', [OrderLineController::class, 'index'])->name('admin.order-lines.index');
            Route::post('/orders/{orderId}/order-lines', [OrderLineController::class, 'store'])->name('admin.order-lines.store');
            Route::get('/order-lines/{id}', [OrderLineController::class, 'show'])->name('admin.order-lines.show');
            Route::put('/order-lines/{id}', [OrderLineController::class, 'update'])->name('admin.order-lines.update');
            Route::delete('/order-lines/{id}', [OrderLineController::class, 'destroy'])->name('admin.order-lines.destroy');

            // Creatives by target (new target-based endpoints)
            Route::get('/order-line-targets/{targetId}/creatives', [CreativeController::class, 'index'])->name('admin.creatives.index');
            Route::post('/order-line-targets/{targetId}/creatives', [CreativeController::class, 'store'])->name('admin.creatives.store');
            Route::put('/creatives/{id}', [CreativeController::class, 'update'])->name('admin.creatives.update');
            Route::delete('/creatives/{id}', [CreativeController::class, 'destroy'])->name('admin.creatives.destroy');

            // Order line targets (assign/unassign screens/groups)
            Route::post('/order-lines/{orderLineId}/targets', [OrderLineTargetController::class, 'store'])->name('admin.order-line-targets.store');
            Route::delete('/order-line-targets/{id}', [OrderLineTargetController::class, 'destroy'])->name('admin.order-line-targets.destroy');

            // Resolutions (screens grouped by resolution for an order line)
            Route::get('/order-lines/{orderLineId}/resolutions', [ResolutionController::class, 'index'])->name('admin.resolutions.index');

            // Delivery progress
            Route::get('/orders/{orderId}/delivery-progress', [\App\Http\Controllers\Admin\DeliveryProgressController::class, 'show'])->name('admin.orders.delivery-progress');

            // Bulk creative assignment by resolution
            Route::post('/order-lines/{orderLineId}/creatives/bulk-by-resolution', [BulkCreativeController::class, 'bulkByResolution'])->name('admin.creatives.bulkByResolution');

            // Screen commands (Modo Testigo)
            Route::post('/screens/{id}/commands', [ScreenCommandController::class, 'store'])->name('admin.screens.commands.store');

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
            Route::post('/groups/{id}/apply-schedule', [ScreenGroupController::class, 'applySchedule'])->name('admin.groups.applySchedule');

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

            // Playlist item preview (supports URL items)
            Route::get('/playlist-items/{id}/preview', [ContentPreviewController::class, 'showPlaylistItem'])->name('admin.playlist-items.preview');

            // Analytics
            Route::get('/analytics/playback', [PlaybackAnalyticsController::class, 'index'])->name('admin.analytics.playback');

            // Screenshot viewing
            Route::get('/screens/{id}/screenshots', [ScreenshotViewController::class, 'index'])->name('admin.screens.screenshots');

            // Screen manifest
            Route::get('/screens/{id}/manifest', [ScreenController::class, 'manifest'])->name('admin.screens.manifest');

            // Screen active order lines
            Route::get('/screens/{id}/active-order-lines', [ScreenController::class, 'activeOrderLines'])->name('admin.screens.activeOrderLines');
        });
    });
});
