<?php

use App\Http\Controllers\Admin\AdminAuthController;
use App\Http\Controllers\Device\DeviceAuthController;
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
        Route::get('/config', function () {
            return response()->json(['message' => 'Device config endpoint']);
        })->name('device.config');

        Route::post('/heartbeat', function () {
            return response()->json(['message' => 'Device heartbeat endpoint']);
        })->name('device.heartbeat');

        Route::get('/playlist', function () {
            return response()->json(['message' => 'Device playlist endpoint']);
        })->name('device.playlist');

        Route::post('/playlist/confirm', function () {
            return response()->json(['message' => 'Device playlist confirm endpoint']);
        })->name('device.playlist.confirm');

        Route::post('/playback-logs', function () {
            return response()->json(['message' => 'Device playback logs endpoint']);
        })->name('device.playback-logs');

        Route::post('/screenshot', function () {
            return response()->json(['message' => 'Device screenshot endpoint']);
        })->name('device.screenshot');
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
            Route::get('/tenants', function () {
                return response()->json(['message' => 'Admin tenants endpoint']);
            })->name('admin.tenants.index');

            Route::post('/tenants', function () {
                return response()->json(['message' => 'Admin tenant created'], 201);
            })->name('admin.tenants.store');

            Route::get('/tenants/{id}', function (string $id) {
                return response()->json(['message' => 'Admin tenant details', 'id' => $id]);
            })->name('admin.tenants.show');

            Route::put('/tenants/{id}', function (string $id) {
                return response()->json(['message' => 'Admin tenant updated', 'id' => $id]);
            })->name('admin.tenants.update');

            Route::delete('/tenants/{id}', function (string $id) {
                return response()->json(['message' => 'Admin tenant deleted', 'id' => $id]);
            })->name('admin.tenants.destroy');
        });

        // Routes accessible by both super-admin and tenant-admin
        Route::middleware('role:super_admin,tenant_admin')->group(function () {
            // Screen management
            Route::get('/screens', function () {
                return response()->json(\App\Models\Screen::all());
            })->name('admin.screens.index');

            // Playlist management
            Route::get('/playlists', function () {
                return response()->json(['message' => 'Admin playlists endpoint']);
            })->name('admin.playlists.index');

            // Content library
            Route::get('/content', function () {
                return response()->json(['message' => 'Admin content endpoint']);
            })->name('admin.content.index');

            // Analytics
            Route::get('/analytics/playback', function () {
                return response()->json(['message' => 'Admin analytics endpoint']);
            })->name('admin.analytics.playback');
        });
    });
});
