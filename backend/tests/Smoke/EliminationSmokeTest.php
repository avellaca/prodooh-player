<?php

namespace Tests\Smoke;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class EliminationSmokeTest extends TestCase
{
    use RefreshDatabase;

    public function test_source_migration_file_exists_and_is_valid_php(): void
    {
        $path = database_path('migrations/2026_07_10_000002_simplify_impressions_source_enum.php');
        $this->assertFileExists($path);
        // Ensure it's valid PHP (no parse errors)
        $result = exec("php -l {$path} 2>&1", $output, $returnCode);
        $this->assertEquals(0, $returnCode, 'Migration file has PHP syntax errors');
    }

    public function test_deprecated_playlist_endpoint_returns_410(): void
    {
        $this->getJson('/api/device/playlist')->assertStatus(410);
    }

    public function test_deprecated_playlist_confirm_returns_410(): void
    {
        $this->postJson('/api/device/playlist/confirm')->assertStatus(410);
    }

    public function test_deprecated_config_endpoint_returns_410(): void
    {
        $this->getJson('/api/device/config')->assertStatus(410);
    }

    public function test_loop_engine_file_does_not_exist(): void
    {
        $this->assertFileDoesNotExist(base_path('../player/src/engine/LoopEngine.ts'));
    }

    public function test_config_sync_controller_eliminated(): void
    {
        $this->assertFileDoesNotExist(app_path('Http/Controllers/Device/ConfigSyncController.php'));
    }

    public function test_source_toggle_service_eliminated(): void
    {
        $this->assertFileDoesNotExist(app_path('Services/SourceToggleService.php'));
    }

    public function test_loop_config_service_eliminated(): void
    {
        $this->assertFileDoesNotExist(app_path('Services/LoopConfigService.php'));
    }
}
