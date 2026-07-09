<?php

namespace Database\Seeders;

use App\Models\Content;
use App\Models\Creative;
use App\Models\Order;
use App\Models\OrderLine;
use App\Models\OrderLineTarget;
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

        // ─── Screens for Tenant A ───
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
            ]
        );

        // ─── Screens for Tenant B ───
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

        // ─── Orders & Order Lines for Tenant A (Prodooh Oficina) ───
        $orderA1 = Order::updateOrCreate(
            ['tenant_id' => $tenantA->id, 'name' => 'Campaña Corporativa Q3 2026'],
            [
                'advertiser_name' => 'Prodooh Internal',
                'starts_at' => '2026-07-01',
                'ends_at' => '2026-09-30',
                'status' => 'active',
            ]
        );

        $orderLineA1 = OrderLine::updateOrCreate(
            ['order_id' => $orderA1->id, 'name' => 'Patrocinio - Video Corporativo'],
            [
                'priority_tier' => 'patrocinio',
                'starts_at' => '2026-07-01',
                'ends_at' => '2026-09-30',
                'target_spots' => 5000,
                'delivery_pace' => 'uniform',
                'share_weight' => 100,
                'status' => 'active',
            ]
        );

        $orderLineA2 = OrderLine::updateOrCreate(
            ['order_id' => $orderA1->id, 'name' => 'Estándar - Banner Evento'],
            [
                'priority_tier' => 'estandar',
                'starts_at' => '2026-08-01',
                'ends_at' => '2026-08-31',
                'target_spots' => 2000,
                'delivery_pace' => 'asap',
                'share_weight' => 80,
                'status' => 'active',
            ]
        );

        $orderLineA3 = OrderLine::updateOrCreate(
            ['order_id' => $orderA1->id, 'name' => 'Red Interna - Promo Oficina'],
            [
                'priority_tier' => 'red_interna',
                'starts_at' => '2026-07-01',
                'ends_at' => '2026-09-30',
                'target_spots' => null,
                'delivery_pace' => 'uniform',
                'share_weight' => 50,
                'status' => 'active',
            ]
        );

        // ─── Order Line Targets (assign lines to screens/groups) ───
        // Patrocinio line targets the entire group
        OrderLineTarget::updateOrCreate(
            ['order_line_id' => $orderLineA1->id, 'screen_group_id' => $groupA->id],
            ['screen_id' => null]
        );

        // Estándar line targets only screen 1
        OrderLineTarget::updateOrCreate(
            ['order_line_id' => $orderLineA2->id, 'screen_id' => $screenA1->id],
            ['screen_group_id' => null]
        );

        // Red interna targets the entire group
        OrderLineTarget::updateOrCreate(
            ['order_line_id' => $orderLineA3->id, 'screen_group_id' => $groupA->id],
            ['screen_id' => null]
        );

        // ─── Creatives (link content to order lines with active dates) ───
        Creative::updateOrCreate(
            ['order_line_id' => $orderLineA1->id, 'content_id' => $contentA2->id],
            [
                'weight' => 100,
                'active_dates' => ['2026-07-01', '2026-07-15', '2026-08-01', '2026-08-15', '2026-09-01', '2026-09-15'],
            ]
        );

        Creative::updateOrCreate(
            ['order_line_id' => $orderLineA2->id, 'content_id' => $contentA3->id],
            [
                'weight' => 100,
                'active_dates' => ['2026-08-01', '2026-08-10', '2026-08-20', '2026-08-31'],
            ]
        );

        Creative::updateOrCreate(
            ['order_line_id' => $orderLineA3->id, 'content_id' => $contentA1->id],
            [
                'weight' => 60,
                'active_dates' => ['2026-07-01', '2026-08-01', '2026-09-01'],
            ]
        );

        Creative::updateOrCreate(
            ['order_line_id' => $orderLineA3->id, 'content_id' => $contentA3->id],
            [
                'weight' => 40,
                'active_dates' => ['2026-07-15', '2026-08-15', '2026-09-15'],
            ]
        );

        // ─── Order for Tenant B ───
        $orderB1 = Order::updateOrCreate(
            ['tenant_id' => $tenantB->id, 'name' => 'Campaña Lobby Verano 2026'],
            [
                'advertiser_name' => 'Marca Externa',
                'starts_at' => '2026-07-15',
                'ends_at' => '2026-08-31',
                'status' => 'active',
            ]
        );

        $orderLineB1 = OrderLine::updateOrCreate(
            ['order_id' => $orderB1->id, 'name' => 'Patrocinio - Ad Portrait'],
            [
                'priority_tier' => 'patrocinio',
                'starts_at' => '2026-07-15',
                'ends_at' => '2026-08-31',
                'target_spots' => 3000,
                'delivery_pace' => 'uniform',
                'share_weight' => 100,
                'status' => 'active',
            ]
        );

        OrderLineTarget::updateOrCreate(
            ['order_line_id' => $orderLineB1->id, 'screen_id' => $screenB1->id],
            ['screen_group_id' => null]
        );

        Creative::updateOrCreate(
            ['order_line_id' => $orderLineB1->id, 'content_id' => $contentB1->id],
            [
                'weight' => 70,
                'active_dates' => ['2026-07-15', '2026-08-01', '2026-08-15', '2026-08-31'],
            ]
        );

        Creative::updateOrCreate(
            ['order_line_id' => $orderLineB1->id, 'content_id' => $contentB2->id],
            [
                'weight' => 30,
                'active_dates' => ['2026-08-01', '2026-08-15'],
            ]
        );

        // ─── Output summary ───
        $this->command->info('');
        $this->command->info('╔══════════════════════════════════════════════════════════════╗');
        $this->command->info('║       MULTI-TENANT PILOT DEMONSTRATION SEEDED              ║');
        $this->command->info('╠══════════════════════════════════════════════════════════════╣');
        $this->command->info('║                                                            ║');
        $this->command->info('║  Tenant A: Prodooh Oficina                                 ║');
        $this->command->info('║    • Screens: Totem Oficina 1, Totem Oficina 2             ║');
        $this->command->info('║    • Playlist: 3 items (2 images + 1 video)                ║');
        $this->command->info('║    • Order: Campaña Corporativa Q3 2026 (3 líneas)         ║');
        $this->command->info('║      - Patrocinio: Video Corporativo → grupo completo      ║');
        $this->command->info('║      - Estándar: Banner Evento → solo Totem 1              ║');
        $this->command->info('║      - Red Interna: Promo Oficina → grupo completo         ║');
        $this->command->info('║    • Admin: admin-a@prodooh.com / password                 ║');
        $this->command->info('║    • Device token (screen 1): ' . $deviceTokenA1 . '  ║');
        $this->command->info('║    • Device token (screen 2): ' . $deviceTokenA2 . '  ║');
        $this->command->info('║                                                            ║');
        $this->command->info('║  Tenant B: Media Owner Demo                                ║');
        $this->command->info('║    • Screens: Lobby Screen 1 (portrait)                    ║');
        $this->command->info('║    • Playlist: 3 items (1 image + 1 video + 1 URL)         ║');
        $this->command->info('║    • Order: Campaña Lobby Verano 2026 (1 línea)            ║');
        $this->command->info('║      - Patrocinio: Ad Portrait → Lobby Screen 1            ║');
        $this->command->info('║    • Admin: admin-b@mediaowner.com / password              ║');
        $this->command->info('║    • Device token (screen 1): ' . $deviceTokenB1 . '  ║');
        $this->command->info('║                                                            ║');
        $this->command->info('╚══════════════════════════════════════════════════════════════╝');
        $this->command->info('');
    }
}
