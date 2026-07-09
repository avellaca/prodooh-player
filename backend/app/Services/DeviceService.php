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
     * Token is 8 characters (alphanumeric) for easy manual entry on devices.
     *
     * @param  array<string, mixed>  $data
     * @return array{screen: Screen, device_token: string}
     */
    public function register(array $data): array
    {
        $deviceToken = $this->generateDeviceToken();

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
     * Regenerate the device token for a screen.
     *
     * Generates a new short token, hashes it, and updates the screen record.
     * The old token hash is replaced, effectively invalidating any existing JWT sessions.
     *
     * @return array{screen: Screen, device_token: string}
     */
    public function regenerateToken(Screen $screen): array
    {
        $deviceToken = $this->generateDeviceToken();

        $screen->update([
            'device_token_hash' => Hash::make($deviceToken),
        ]);

        return [
            'screen' => $screen->fresh(),
            'device_token' => $deviceToken,
        ];
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

    /**
     * Generate a short, human-typeable device token.
     *
     * Uses 8 uppercase alphanumeric characters (no ambiguous chars like 0/O, 1/I/L).
     * This is designed to be manually entered on Raspberry Pi devices
     * where copy-paste is not available.
     *
     * Character space: 30 chars (A-Z minus O,I + 0-9 minus 0,1) = ~1.56 billion combinations.
     */
    private function generateDeviceToken(): string
    {
        // Exclude ambiguous characters: O (confused with 0), I/L (confused with 1)
        $chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        $token = '';
        for ($i = 0; $i < 8; $i++) {
            $token .= $chars[random_int(0, strlen($chars) - 1)];
        }

        return $token;
    }
}
