<?php

namespace App\Services;

use App\Models\Screen;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class DeviceService
{
    /**
     * List all screens (BelongsToTenant handles tenant filtering).
     *
     * @return \Illuminate\Database\Eloquent\Collection<int, Screen>
     */
    public function list()
    {
        return Screen::all();
    }

    /**
     * Register a new screen with a generated device token.
     *
     * The plaintext device_token is returned only at creation time.
     * It is stored as a bcrypt hash in the database.
     *
     * @param  array<string, mixed>  $data
     * @return array{screen: Screen, device_token: string}
     */
    public function register(array $data): array
    {
        $deviceToken = Str::random(64);

        $screen = Screen::create([
            'tenant_id' => $data['tenant_id'],
            'venue_id' => $data['venue_id'],
            'name' => $data['name'],
            'device_token_hash' => Hash::make($deviceToken),
            'status' => 'offline',
            'orientation' => $data['orientation'] ?? 'landscape',
            'resolution_width' => $data['resolution_width'] ?? 1920,
            'resolution_height' => $data['resolution_height'] ?? 1080,
            'group_id' => $data['group_id'] ?? null,
            'loop_config' => $data['loop_config'] ?? [
                'slots' => [
                    ['source' => 'prodooh', 'duration' => 10],
                    ['source' => 'gam', 'duration' => 10],
                    ['source' => 'url', 'duration' => 10],
                    ['source' => 'playlist', 'duration' => 10],
                ],
            ],
            'sources_config' => $data['sources_config'] ?? [
                'prodooh' => ['enabled' => true],
                'gam' => ['enabled' => true],
                'url' => ['enabled' => true],
                'playlist' => ['enabled' => true],
            ],
        ]);

        return [
            'screen' => $screen,
            'device_token' => $deviceToken,
        ];
    }

    /**
     * Show a screen by ID.
     */
    public function show(string $id): Screen
    {
        return Screen::findOrFail($id);
    }

    /**
     * Update a screen's configuration.
     *
     * @param  array<string, mixed>  $data
     */
    public function update(Screen $screen, array $data): Screen
    {
        $screen->update($data);

        return $screen->fresh();
    }
}
