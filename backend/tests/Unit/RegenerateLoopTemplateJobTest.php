<?php

namespace Tests\Unit;

use App\Jobs\RegenerateLoopTemplateJob;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\ScreenManifest;
use App\Models\Tenant;
use App\Services\LoopTemplateGeneratorInterface;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RegenerateLoopTemplateJobTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;
    private ScreenGroup $group;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::factory()->create();
        $this->group = ScreenGroup::factory()->create(['tenant_id' => $this->tenant->id]);
    }

    public function test_job_calls_generate_for_existing_screen(): void
    {
        $screen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'group_id' => $this->group->id,
        ]);

        $job = new RegenerateLoopTemplateJob($screen->id);
        $job->handle(app(LoopTemplateGeneratorInterface::class));

        // Verify a manifest was generated
        $this->assertDatabaseHas('screen_manifests', [
            'screen_id' => $screen->id,
        ]);
    }

    public function test_job_silently_completes_for_deleted_screen(): void
    {
        $fakeId = '00000000-0000-0000-0000-000000000099';

        $job = new RegenerateLoopTemplateJob($fakeId);
        $job->handle(app(LoopTemplateGeneratorInterface::class));

        // Should not throw and no manifest created
        $this->assertDatabaseMissing('screen_manifests', [
            'screen_id' => $fakeId,
        ]);
    }

    public function test_job_generates_empty_loop_template_when_no_active_content(): void
    {
        $screen = Screen::factory()->create([
            'tenant_id' => $this->tenant->id,
            'group_id' => $this->group->id,
        ]);

        $job = new RegenerateLoopTemplateJob($screen->id);
        $job->handle(app(LoopTemplateGeneratorInterface::class));

        $manifest = ScreenManifest::where('screen_id', $screen->id)->first();

        $this->assertNotNull($manifest);
        $this->assertNotNull($manifest->version);
        $this->assertNotEmpty($manifest->version);

        // Verify the template structure has slots but empty ad candidates
        $items = $manifest->items;
        $this->assertArrayHasKey('version', $items);
        $this->assertArrayHasKey('slots', $items);
        $this->assertArrayHasKey('loop_config', $items);

        // All ad slots should have empty candidates (no active lines)
        $adSlots = array_filter($items['slots'], fn ($slot) => $slot['type'] === 'ad');
        foreach ($adSlots as $adSlot) {
            $this->assertEmpty($adSlot['candidates']);
        }
    }

    public function test_job_unique_id_is_screen_id(): void
    {
        $screenId = '123e4567-e89b-12d3-a456-426614174000';
        $job = new RegenerateLoopTemplateJob($screenId);

        $this->assertEquals($screenId, $job->uniqueId());
    }

    public function test_job_has_30_second_timeout(): void
    {
        $job = new RegenerateLoopTemplateJob('some-id');
        $this->assertEquals(30, $job->timeout);
    }
}
