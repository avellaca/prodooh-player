<?php

namespace App\Http\Controllers\Device;

use App\Http\Controllers\Controller;
use App\Models\Screen;
use App\Services\SourceToggleService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ConfigSyncController extends Controller
{
    public function __construct(
        private readonly SourceToggleService $sourceToggleService,
    ) {}

    /**
     * GET /api/device/config
     *
     * Serve the full device configuration including loop config, sources,
     * display settings, schedule, and sync intervals.
     */
    public function __invoke(Request $request): JsonResponse
    {
        $screenId = $request->attributes->get('screen_id');
        $tenantId = $request->attributes->get('tenant_id');
        $venueId = $request->attributes->get('venue_id');

        $screen = Screen::withoutGlobalScopes()
            ->with(['screenGroup', 'tenant'])
            ->findOrFail($screenId);

        $group = $screen->screenGroup;
        $tenant = $screen->tenant;

        // Resolve duration using hierarchy: screen > group > tenant > default
        [$durationSeconds, $durationSource] = $this->resolveDuration($screen, $group, $tenant);

        // Resolve schedule using hierarchy: screen > group > tenant > null
        $schedule = $this->resolveSchedule($screen, $group, $tenant);

        // Get effective loop config (disabled sources replaced with playlist)
        $effectiveLoop = $this->sourceToggleService->getEffectiveLoopConfig($screen);

        // Calculate total loop duration
        $totalDuration = array_sum(array_column($effectiveLoop['slots'] ?? [], 'duration'));

        // Build slots with position index
        $slots = array_map(function (array $slot, int $index) {
            return [
                'position' => $index,
                'source' => $slot['source'],
                'duration' => $slot['duration'],
            ];
        }, $effectiveLoop['slots'] ?? [], array_keys($effectiveLoop['slots'] ?? []));

        // Build sources config
        $sourcesConfig = $screen->sources_config ?? [
            'prodooh' => ['enabled' => true],
            'gam' => ['enabled' => true],
            'url' => ['enabled' => true],
            'playlist' => ['enabled' => true],
        ];

        $sources = $this->buildSourcesResponse($sourcesConfig, $screen, $tenant);

        // Build display config
        $display = $this->buildDisplayResponse($screen, $group, $tenant);

        return response()->json([
            'venue_id' => $venueId,
            'tenant_id' => $tenantId,
            'loop' => [
                'slots' => $slots,
                'total_duration' => $totalDuration,
            ],
            'sources' => $sources,
            'display' => $display,
            'schedule' => $schedule,
            'content_duration' => [
                'default_seconds' => $durationSeconds,
                'source' => $durationSource,
            ],
            'sync_interval_seconds' => 60,
            'heartbeat_interval_seconds' => 30,
        ]);
    }

    /**
     * Resolve duration using the hierarchy: screen > group > tenant > default (10).
     *
     * @return array{0: int, 1: string}
     */
    private function resolveDuration(Screen $screen, $group, $tenant): array
    {
        if ($screen->duration_seconds !== null) {
            return [(int) $screen->duration_seconds, 'screen'];
        }

        if ($group && $group->duration_seconds !== null) {
            return [(int) $group->duration_seconds, 'group'];
        }

        if ($tenant && $tenant->default_duration_seconds !== null) {
            return [(int) $tenant->default_duration_seconds, 'tenant'];
        }

        return [10, 'tenant'];
    }

    /**
     * Resolve schedule using the hierarchy: screen > group > tenant > null.
     */
    private function resolveSchedule(Screen $screen, $group, $tenant): ?array
    {
        $rules = $screen->schedule
            ?? ($group ? $group->schedule : null)
            ?? $tenant->default_schedule
            ?? null;

        if ($rules === null) {
            return null;
        }

        return [
            'timezone' => $tenant->default_timezone ?? 'UTC',
            'rules' => $rules,
        ];
    }

    /**
     * Build the sources section of the response.
     */
    private function buildSourcesResponse(array $sourcesConfig, Screen $screen, $tenant): array
    {
        $screenSourcesConfig = $screen->sources_config ?? [];

        return [
            'prodooh' => [
                'enabled' => $sourcesConfig['prodooh']['enabled'] ?? true,
                'api_key' => $tenant->api_credential ?? '',
                'network_id' => $tenant->default_config['network_id'] ?? '',
            ],
            'gam' => [
                'enabled' => $sourcesConfig['gam']['enabled'] ?? true,
                'ad_tag_url' => $screenSourcesConfig['gam']['ad_tag_url'] ?? '',
            ],
            'url' => [
                'enabled' => $sourcesConfig['url']['enabled'] ?? true,
                'urls' => $screenSourcesConfig['url']['urls'] ?? [],
            ],
            'playlist' => [
                'enabled' => $sourcesConfig['playlist']['enabled'] ?? true,
            ],
        ];
    }

    /**
     * Build the display section of the response.
     */
    private function buildDisplayResponse(Screen $screen, $group, $tenant): array
    {
        $orientation = $screen->orientation
            ?? ($group ? $group->orientation : null)
            ?? 'landscape';

        $resolutionWidth = $screen->resolution_width
            ?? ($group ? $group->resolution_width : null)
            ?? 1920;

        $resolutionHeight = $screen->resolution_height
            ?? ($group ? $group->resolution_height : null)
            ?? 1080;

        $transitionType = $screen->transition_type
            ?? $tenant->transition_type
            ?? 'cut';

        $transitionDuration = $screen->transition_duration_ms
            ?? $tenant->transition_duration_ms
            ?? 0;

        return [
            'resolution' => [
                'width' => (int) $resolutionWidth,
                'height' => (int) $resolutionHeight,
            ],
            'orientation' => $orientation,
            'transition' => [
                'type' => $transitionType,
                'duration_ms' => (int) $transitionDuration,
            ],
        ];
    }
}
