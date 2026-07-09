<?php

namespace Database\Seeders;

use App\Models\Content;
use App\Models\Playlist;
use App\Models\PlaylistItem;
use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Multi-Tenant Pilot Demonstration Seeder
 *
 * Sets up 2 tenants with distinct configurations to validate
 * complete multi-tenant isolation:
 *
 * - Tenant A ("Prodooh Oficina"): All 4 sources active (incl. GAM)
 * - Tenant B ("Media Owner Demo"): GAM disabled, 3 sources only
 *
 * Each tenant has its own screens, playlists, content, and admin users.
 * This validates Requirement 12.4: multi-tenant pilot demonstration.
 */
class MultiTenantPilotSeeder extends Seeder
{
    /**
     * Run the multi-tenant pilot demonstration seeder.
     */
    public function run(): void
    {
        // ─── Tenant A: Prodooh Oficina (all sources active, incl. GAM) ───
        $tenantA = Tenant::updateOrCreate(
            ['name' => 'Prodooh Oficina'],
            [
                'api_credential' => Str::uuid()->toString(),
                'default_duration_seconds' => 10,
                'default_timezone' => 'America/Santiago',
                'default_schedule' => [
                    ['days' => [1, 2, 3, 4, 5], 'start' => '08:00', 'end' => '20:00'],
                ],
                'transition_type' => 'fade',
                'transition_duration_ms' => 500,
                'default_config' => [
                    'description' => 'Oficina principal con todas las fuentes activas',
                ],
            ]
        );

        // ─── Tenant B: Media Owner Demo (no GAM) ───
        $tenantB = Tenant::updateOrCreate(
            ['name' => 'Media Owner Demo'],
            [
                'api_credential' => Str::uuid()->toString(),
                'default_duration_seconds' => 15,
                'default_timezone' => 'America/Bogota',
                'default_schedule' => null, // 24/7 operation
                'transition_type' => 'slide',
                'transition_duration_ms' => 300,
                'default_config' => [
                    'description' => 'Demo para media owner externo sin GAM',
                ],
            ]
        );

        // ─── Tenant Admin Users ───
        User::updateOrCreate(
            ['email' => 'admin-a@prodooh.com'],
            [
                'tenant_id' => $tenantA->id,
                'password_hash' => 'password',
                'role' => 'tenant_admin',
            ]
        );

        User::updateOrCreate(
            ['email' => 'admin-b@mediaowner.com'],
            [
                'tenant_id' => $tenantB->id,
                'password_hash' => 'password',
                'role' => 'tenant_admin',
            ]
        );

        // ─── Screen Groups ───
        $groupA = ScreenGroup::updateOrCreate(
            ['tenant_id' => $tenantA->id, 'name' => 'Oficina Piso 1'],
            [
                'duration_seconds' => 10,
                'orientation' => 'landscape',
                'resolution_width' => 3840,
                'resolution_height' => 2160,
                'schedule' => [
                    ['days' => [1, 2, 3, 4, 5], 'start' => '08:00', 'end' => '20:00'],
                ],
            ]
        );

        $groupB = ScreenGroup::updateOrCreate(
            ['tenant_id' => $tenantB->id, 'name' => 'Lobby Principal'],
            [
                'duration_seconds' => 15,
                'orientation' => 'portrait',
                'resolution_width' => 2160,
                'resolution_height' => 3840,
                'schedule' => null, // 24/7
            ]
        );

        // ─── Screens for Tenant A (all 4 sources, incl. GAM) ───
        $deviceTokenA1 = 'pilot-token-tenant-a-screen-1';
        $screenA1 = Screen::updateOrCreate(
            ['venue_id' => 'prodooh-oficina-totem-1'],
            [
                'tenant_id' => $tenantA->id,
                'group_id' => $groupA->id,
                'name' => 'Totem Oficina 1',
                'device_token_hash' => Hash::make($deviceTokenA1),
                'status' => 'offline',
                'orientation' => 'landscape',
                'resolution_width' => 3840,
                'resolution_height' => 2160,
                'duration_seconds' => null, // inherit from group
                'loop_config' => [
                    'slots' => [
                        ['position' => 0, 'source' => 'prodooh', 'duration' => 10],
                        ['position' => 1, 'source' => 'gam', 'duration' => 10],
                        ['position' => 2, 'source' => 'url', 'duration' => 10],
                        ['position' => 3, 'source' => 'playlist', 'duration' => 10],
                    ],
                ],
                'sources_config' => [
                    'prodooh' => ['enabled' => true, 'api_key' => 'sandbox-key-a', 'network_id' => 'net-001'],
                    'gam' => ['enabled' => true, 'ad_tag_url' => 'https://pubads.g.doubleclick.net/gampad/ads?sandbox=true&tenant=a'],
                    'url' => ['enabled' => true, 'urls' => [
                        ['url' => 'https://dashboard.prodooh.com/screen/totem-1', 'duration' => 10],
                    ]],
                    'playlist' => ['enabled' => true],
                ],
            ]
        );

        $deviceTokenA2 = 'pilot-token-tenant-a-screen-2';
        $screenA2 = Screen::updateOrCreate(
            ['venue_id' => 'prodooh-oficina-totem-2'],
            [
                'tenant_id' => $tenantA->id,
                'group_id' => $groupA->id,
                'name' => 'Totem Oficina 2',
                'device_token_hash' => Hash::make($deviceTokenA2),
                'status' => 'offline',
                'orientation' => 'landscape',
                'resolution_width' => 3840,
                'resolution_height' => 2160,
                'duration_seconds' => null,
                'loop_config' => [
                    'slots' => [
                        ['position' => 0, 'source' => 'prodooh', 'duration' => 10],
                        ['position' => 1, 'source' => 'gam', 'duration' => 10],
                        ['position' => 2, 'source' => 'url', 'duration' => 10],
                        ['position' => 3, 'source' => 'playlist', 'duration' => 10],
                    ],
                ],
                'sources_config' => [
                    'prodooh' => ['enabled' => true, 'api_key' => 'sandbox-key-a', 'network_id' => 'net-001'],
                    'gam' => ['enabled' => true, 'ad_tag_url' => 'https://pubads.g.doubleclick.net/gampad/ads?sandbox=true&tenant=a'],
                    'url' => ['enabled' => true, 'urls' => [
                        ['url' => 'https://dashboard.prodooh.com/screen/totem-2', 'duration' => 10],
                    ]],
                    'playlist' => ['enabled' => true],
                ],
            ]
        );

        // ─── Screens for Tenant B (NO GAM, slots redistributed) ───
        $deviceTokenB1 = 'pilot-token-tenant-b-screen-1';
        $screenB1 = Screen::updateOrCreate(
            ['venue_id' => 'mediaowner-lobby-screen-1'],
            [
                'tenant_id' => $tenantB->id,
                'group_id' => $groupB->id,
                'name' => 'Lobby Screen 1',
                'device_token_hash' => Hash::make($deviceTokenB1),
                'status' => 'offline',
                'orientation' => 'portrait',
                'resolution_width' => 2160,
                'resolution_height' => 3840,
                'duration_seconds' => 15,
                'loop_config' => [
                    'slots' => [
                        ['position' => 0, 'source' => 'prodooh', 'duration' => 15],
                        ['position' => 1, 'source' => 'playlist', 'duration' => 15],
                        ['position' => 2, 'source' => 'url', 'duration' => 15],
                        ['position' => 3, 'source' => 'playlist', 'duration' => 15],
                    ],
                ],
                'sources_config' => [
                    'prodooh' => ['enabled' => true, 'api_key' => 'sandbox-key-b', 'network_id' => 'net-002'],
                    'gam' => ['enabled' => false],
                    'url' => ['enabled' => true, 'urls' => [
                        ['url' => 'https://mediaowner.example.com/ads/lobby', 'duration' => 15],
                    ]],
                    'playlist' => ['enabled' => true],
                ],
            ]
        );

        // ─── Content for Tenant A ───
        $contentA1 = Content::updateOrCreate(
            ['tenant_id' => $tenantA->id, 'filename' => 'promo-oficina-landscape.jpg'],
            [
                'mime_type' => 'image/jpeg',
                'storage_path' => 'tenants/' . $tenantA->id . '/content/promo-oficina-landscape.jpg',
                'file_size_bytes' => 524288,
                'width' => 3840,
                'height' => 2160,
                'orientation' => 'landscape',
                'rotation' => 0,
                'checksum_sha256' => hash('sha256', 'promo-oficina-landscape-content-a'),
            ]
        );

        $contentA2 = Content::updateOrCreate(
            ['tenant_id' => $tenantA->id, 'filename' => 'video-corporativo.mp4'],
            [
                'mime_type' => 'video/mp4',
                'storage_path' => 'tenants/' . $tenantA->id . '/content/video-corporativo.mp4',
                'file_size_bytes' => 10485760,
                'width' => 3840,
                'height' => 2160,
                'duration_seconds' => 30,
                'orientation' => 'landscape',
                'rotation' => 0,
                'checksum_sha256' => hash('sha256', 'video-corporativo-content-a'),
            ]
        );

        $contentA3 = Content::updateOrCreate(
            ['tenant_id' => $tenantA->id, 'filename' => 'banner-evento.png'],
            [
                'mime_type' => 'image/png',
                'storage_path' => 'tenants/' . $tenantA->id . '/content/banner-evento.png',
                'file_size_bytes' => 1048576,
                'width' => 3840,
                'height' => 2160,
                'orientation' => 'landscape',
                'rotation' => 0,
                'checksum_sha256' => hash('sha256', 'banner-evento-content-a'),
            ]
        );

        // ─── Content for Tenant B ───
        $contentB1 = Content::updateOrCreate(
            ['tenant_id' => $tenantB->id, 'filename' => 'ad-portrait-lobby.jpg'],
            [
                'mime_type' => 'image/jpeg',
                'storage_path' => 'tenants/' . $tenantB->id . '/content/ad-portrait-lobby.jpg',
                'file_size_bytes' => 614400,
                'width' => 2160,
                'height' => 3840,
                'orientation' => 'portrait',
                'rotation' => 0,
                'checksum_sha256' => hash('sha256', 'ad-portrait-lobby-content-b'),
            ]
        );

        $contentB2 = Content::updateOrCreate(
            ['tenant_id' => $tenantB->id, 'filename' => 'promo-vertical.mp4'],
            [
                'mime_type' => 'video/mp4',
                'storage_path' => 'tenants/' . $tenantB->id . '/content/promo-vertical.mp4',
                'file_size_bytes' => 8388608,
                'width' => 2160,
                'height' => 3840,
                'duration_seconds' => 20,
                'orientation' => 'portrait',
                'rotation' => 0,
                'checksum_sha256' => hash('sha256', 'promo-vertical-content-b'),
            ]
        );

        // ─── Playlist for Tenant A ───
        $playlistA = Playlist::updateOrCreate(
            ['tenant_id' => $tenantA->id, 'name' => 'Playlist Oficina Principal'],
            ['version' => 'v1.0.0']
        );

        // Clear existing items and recreate
        PlaylistItem::where('playlist_id', $playlistA->id)->delete();

        PlaylistItem::create([
            'playlist_id' => $playlistA->id,
            'content_id' => $contentA1->id,
            'type' => 'image',
            'duration_seconds' => 10,
            'position' => 0,
        ]);

        PlaylistItem::create([
            'playlist_id' => $playlistA->id,
            'content_id' => $contentA2->id,
            'type' => 'video',
            'duration_seconds' => 30,
            'position' => 1,
        ]);

        PlaylistItem::create([
            'playlist_id' => $playlistA->id,
            'content_id' => $contentA3->id,
            'type' => 'image',
            'duration_seconds' => 10,
            'position' => 2,
        ]);

        // ─── Playlist for Tenant B ───
        $playlistB = Playlist::updateOrCreate(
            ['tenant_id' => $tenantB->id, 'name' => 'Playlist Lobby Media Owner'],
            ['version' => 'v1.0.0']
        );

        PlaylistItem::where('playlist_id', $playlistB->id)->delete();

        PlaylistItem::create([
            'playlist_id' => $playlistB->id,
            'content_id' => $contentB1->id,
            'type' => 'image',
            'duration_seconds' => 15,
            'position' => 0,
        ]);

        PlaylistItem::create([
            'playlist_id' => $playlistB->id,
            'content_id' => $contentB2->id,
            'type' => 'video',
            'duration_seconds' => 20,
            'position' => 1,
        ]);

        PlaylistItem::create([
            'playlist_id' => $playlistB->id,
            'type' => 'url',
            'url' => 'https://mediaowner.example.com/promo-page',
            'duration_seconds' => 15,
            'position' => 2,
            'refresh_interval' => 300,
        ]);

        // ─── Assign Playlists to Screens ───
        $screenA1->playlists()->syncWithoutDetaching([
            $playlistA->id => ['assigned_at' => now()],
        ]);
        $screenA2->playlists()->syncWithoutDetaching([
            $playlistA->id => ['assigned_at' => now()],
        ]);
        $screenB1->playlists()->syncWithoutDetaching([
            $playlistB->id => ['assigned_at' => now()],
        ]);

        // ─── Output summary ───
        $this->command->info('');
        $this->command->info('╔══════════════════════════════════════════════════════════════╗');
        $this->command->info('║       MULTI-TENANT PILOT DEMONSTRATION SEEDED              ║');
        $this->command->info('╠══════════════════════════════════════════════════════════════╣');
        $this->command->info('║                                                            ║');
        $this->command->info('║  Tenant A: Prodooh Oficina                                 ║');
        $this->command->info('║    • Sources: Prodooh + GAM + URL + Playlist (all active)  ║');
        $this->command->info('║    • Screens: Totem Oficina 1, Totem Oficina 2             ║');
        $this->command->info('║    • Playlist: 3 items (2 images + 1 video)                ║');
        $this->command->info('║    • Admin: admin-a@prodooh.com / password                 ║');
        $this->command->info('║    • Device token (screen 1): ' . $deviceTokenA1 . '  ║');
        $this->command->info('║    • Device token (screen 2): ' . $deviceTokenA2 . '  ║');
        $this->command->info('║                                                            ║');
        $this->command->info('║  Tenant B: Media Owner Demo                                ║');
        $this->command->info('║    • Sources: Prodooh + URL + Playlist (GAM DISABLED)      ║');
        $this->command->info('║    • Screens: Lobby Screen 1 (portrait)                    ║');
        $this->command->info('║    • Playlist: 3 items (1 image + 1 video + 1 URL)         ║');
        $this->command->info('║    • Admin: admin-b@mediaowner.com / password              ║');
        $this->command->info('║    • Device token (screen 1): ' . $deviceTokenB1 . '  ║');
        $this->command->info('║                                                            ║');
        $this->command->info('╚══════════════════════════════════════════════════════════════╝');
        $this->command->info('');
    }
}
