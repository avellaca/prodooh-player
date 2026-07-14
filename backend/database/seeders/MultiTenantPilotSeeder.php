<?php

namespace Database\Seeders;

use App\Models\Screen;
use App\Models\ScreenGroup;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Multi-Tenant Pilot Seeder
 *
 * Sets up 2 tenants:
 * - Prodooh: Office screens + AIFA airport screens
 * - Network Demo: Demo lobby screen
 */
class MultiTenantPilotSeeder extends Seeder
{
    public function run(): void
    {
        // ─── Tenant A: Prodooh ───
        $tenantA = Tenant::updateOrCreate(
            ['name' => 'Prodooh'],
            [
                'api_credential' => Str::uuid()->toString(),
                'default_duration_seconds' => 10,
                'default_timezone' => 'America/Mexico_City',
                'default_schedule' => [
                    ['days' => [1, 2, 3, 4, 5, 6, 7], 'start' => '06:00', 'end' => '23:00'],
                ],
                'transition_type' => 'fade',
                'transition_duration_ms' => 500,
                'default_config' => [
                    'description' => 'Prodooh - Oficina y AIFA',
                ],
            ]
        );

        // ─── Tenant B: Network Demo ───
        $tenantB = Tenant::updateOrCreate(
            ['name' => 'Network Demo'],
            [
                'api_credential' => Str::uuid()->toString(),
                'default_duration_seconds' => 15,
                'default_timezone' => 'America/Bogota',
                'default_schedule' => null,
                'transition_type' => 'slide',
                'transition_duration_ms' => 300,
                'default_config' => [
                    'description' => 'Network demo para pruebas',
                ],
            ]
        );

        // ─── Admin Users ───
        User::updateOrCreate(
            ['email' => 'admin-a@prodooh.com'],
            [
                'tenant_id' => $tenantA->id,
                'password_hash' => 'password',
                'role' => 'tenant_admin',
            ]
        );

        User::updateOrCreate(
            ['email' => 'admin-b@networkdemo.com'],
            [
                'tenant_id' => $tenantB->id,
                'password_hash' => 'password',
                'role' => 'tenant_admin',
            ]
        );

        // ─── Screen Groups for Prodooh ───
        $groupOficina = ScreenGroup::updateOrCreate(
            ['tenant_id' => $tenantA->id, 'name' => 'Oficina Piso 17'],
            ['duration_seconds' => 10]
        );

        $groupTotems = ScreenGroup::updateOrCreate(
            ['tenant_id' => $tenantA->id, 'name' => 'AIFA Totems'],
            ['duration_seconds' => 10]
        );

        $groupVideowalls = ScreenGroup::updateOrCreate(
            ['tenant_id' => $tenantA->id, 'name' => 'AIFA Videowalls'],
            ['duration_seconds' => 10]
        );

        // ─── Screen Group for Network Demo ───
        $groupDemo = ScreenGroup::updateOrCreate(
            ['tenant_id' => $tenantB->id, 'name' => 'Lobby Principal'],
            ['duration_seconds' => 15]
        );

        // ─── Oficina Screens (Prodooh) ───
        $deviceTokenA1 = 'pilot-token-tenant-a-screen-1';
        Screen::updateOrCreate(
            ['venue_id' => 'prodooh-oficina-totem-1'],
            [
                'tenant_id' => $tenantA->id,
                'group_id' => $groupOficina->id,
                'name' => 'Oficina Totem 1',
                'device_token_hash' => Hash::make($deviceTokenA1),
                'status' => 'offline',
                'orientation' => 'portrait',
                'resolution_width' => 2160,
                'resolution_height' => 3840,
            ]
        );

        $deviceTokenA2 = 'pilot-token-tenant-a-screen-2';
        Screen::updateOrCreate(
            ['venue_id' => 'prodooh-oficina-totem-2'],
            [
                'tenant_id' => $tenantA->id,
                'group_id' => $groupOficina->id,
                'name' => 'Oficina Totem 2',
                'device_token_hash' => Hash::make($deviceTokenA2),
                'status' => 'offline',
                'orientation' => 'portrait',
                'resolution_width' => 2160,
                'resolution_height' => 3840,
            ]
        );

        // ─── AIFA Totems (vertical, 2160x3840) ───
        $totems = [
            'TOTEM 1', 'TOTEM 2', 'TOTEM 3', 'TOTEM 4', 'TOTEM 5',
            'TOTEM 6', 'TOTEM 7', 'TOTEM 8', 'TOTEM 9', 'TOTEM 10',
            'TOTEM 11', 'TOTEM 12', 'TOTEM 13', 'TOTEM 14', 'TOTEM 15',
            'TOTEM 16', 'TOTEM 17', 'TOTEM 18', 'TOTEM 19', 'TOTEM 20',
            'TOTEM 21', 'TOTEM 22', 'TOTEM 23', 'TOTEM 24', 'TOTEM 25',
            'TOTEM 26', 'TOTEM 27', 'TOTEM 28', 'TOTEM 29', 'TOTEM 30',
            'TOTEM 31', 'TOTEM 32', 'TOTEM 33', 'TOTEM 34', 'TOTEM 35',
            'TOTEM 36', 'TOTEM 37', 'TOTEM 38', 'TOTEM 39',
        ];

        foreach ($totems as $name) {
            $venueId = strtolower(str_replace(' ', '-', $name));
            Screen::updateOrCreate(
                ['venue_id' => $venueId],
                [
                    'tenant_id' => $tenantA->id,
                    'group_id' => $groupTotems->id,
                    'name' => $name,
                    'device_token_hash' => Hash::make(Str::uuid()->toString()),
                    'status' => 'offline',
                    'orientation' => 'portrait',
                    'resolution_width' => 2160,
                    'resolution_height' => 3840,
                ]
            );
        }

        // ─── AIFA Premium (horizontal, various resolutions) ───
        $premiums = [
            ['name' => 'PREMIUM 1', 'width' => 2560, 'height' => 960],
            ['name' => 'PREMIUM 2', 'width' => 2560, 'height' => 960],
            ['name' => 'PREMIUM 3', 'width' => 3840, 'height' => 1080],
            ['name' => 'PREMIUM 4', 'width' => 2560, 'height' => 960],
            ['name' => 'PREMIUM 5', 'width' => 2560, 'height' => 960],
            ['name' => 'PREMIUM 7', 'width' => 2560, 'height' => 960],
            ['name' => 'PREMIUM 8', 'width' => 2560, 'height' => 960],
        ];

        foreach ($premiums as $screen) {
            $venueId = strtolower(str_replace(' ', '-', $screen['name']));
            Screen::updateOrCreate(
                ['venue_id' => $venueId],
                [
                    'tenant_id' => $tenantA->id,
                    'group_id' => $groupVideowalls->id,
                    'name' => $screen['name'],
                    'device_token_hash' => Hash::make(Str::uuid()->toString()),
                    'status' => 'offline',
                    'orientation' => 'landscape',
                    'resolution_width' => $screen['width'],
                    'resolution_height' => $screen['height'],
                ]
            );
        }

        // ─── AIFA Puentes (horizontal, 1550x386) ───
        $puentes = ['PUENTE 1', 'PUENTE 2'];

        foreach ($puentes as $name) {
            $venueId = strtolower(str_replace(' ', '-', $name));
            Screen::updateOrCreate(
                ['venue_id' => $venueId],
                [
                    'tenant_id' => $tenantA->id,
                    'group_id' => $groupVideowalls->id,
                    'name' => $name,
                    'device_token_hash' => Hash::make(Str::uuid()->toString()),
                    'status' => 'offline',
                    'orientation' => 'landscape',
                    'resolution_width' => 1550,
                    'resolution_height' => 386,
                ]
            );
        }

        // ─── AIFA Videowalls (horizontal, various resolutions) ───
        $videowalls = [
            ['name' => 'VIDEOWALL 1', 'width' => 1792, 'height' => 768],
            ['name' => 'VIDEOWALL 2', 'width' => 1792, 'height' => 768],
            ['name' => 'VIDEOWALL 3', 'width' => 1792, 'height' => 768],
            ['name' => 'VIDEOWALL 4', 'width' => 1792, 'height' => 768],
            ['name' => 'VIDEOWALL 5', 'width' => 1792, 'height' => 768],
            ['name' => 'VIDEOWALL 6', 'width' => 1792, 'height' => 768],
            ['name' => 'VIDEOWALL 7', 'width' => 920, 'height' => 520],
            ['name' => 'VIDEOWALL 8', 'width' => 920, 'height' => 520],
            ['name' => 'VIDEOWALL 9', 'width' => 1792, 'height' => 768],
            ['name' => 'VIDEOWALL 10', 'width' => 1792, 'height' => 768],
        ];

        foreach ($videowalls as $screen) {
            $venueId = strtolower(str_replace(' ', '-', $screen['name']));
            Screen::updateOrCreate(
                ['venue_id' => $venueId],
                [
                    'tenant_id' => $tenantA->id,
                    'group_id' => $groupVideowalls->id,
                    'name' => $screen['name'],
                    'device_token_hash' => Hash::make(Str::uuid()->toString()),
                    'status' => 'offline',
                    'orientation' => 'landscape',
                    'resolution_width' => $screen['width'],
                    'resolution_height' => $screen['height'],
                ]
            );
        }

        // ─── AIFA Cilíndricas (horizontal) ───
        $cilindricas = [
            ['name' => 'CILINDRICA 1', 'width' => 1120, 'height' => 640],
            ['name' => 'CILINDRICA 2', 'width' => 1600, 'height' => 920],
        ];

        foreach ($cilindricas as $screen) {
            $venueId = strtolower(str_replace(' ', '-', $screen['name']));
            Screen::updateOrCreate(
                ['venue_id' => $venueId],
                [
                    'tenant_id' => $tenantA->id,
                    'group_id' => $groupVideowalls->id,
                    'name' => $screen['name'],
                    'device_token_hash' => Hash::make(Str::uuid()->toString()),
                    'status' => 'offline',
                    'orientation' => 'landscape',
                    'resolution_width' => $screen['width'],
                    'resolution_height' => $screen['height'],
                ]
            );
        }

        // ─── AIFA Columnas (vertical, 384x1280) ───
        $columnas = ['COLUMNA 1', 'COLUMNA 2', 'COLUMNA 3', 'COLUMNA 4', 'COLUMNA 5', 'COLUMNA 6'];

        foreach ($columnas as $name) {
            $venueId = strtolower(str_replace(' ', '-', $name));
            Screen::updateOrCreate(
                ['venue_id' => $venueId],
                [
                    'tenant_id' => $tenantA->id,
                    'group_id' => $groupTotems->id,
                    'name' => $name,
                    'device_token_hash' => Hash::make(Str::uuid()->toString()),
                    'status' => 'offline',
                    'orientation' => 'portrait',
                    'resolution_width' => 384,
                    'resolution_height' => 1280,
                ]
            );
        }

        // ─── AIFA Outdoor (horizontal/vertical, 1920x1080) ───
        $outdoors = [
            ['name' => 'OUTDOOR 1', 'orientation' => 'portrait'],
            ['name' => 'OUTDOOR 2', 'orientation' => 'landscape'],
            ['name' => 'OUTDOOR 3', 'orientation' => 'landscape'],
            ['name' => 'OUTDOOR 4', 'orientation' => 'landscape'],
            ['name' => 'OUTDOOR 5', 'orientation' => 'landscape'],
            ['name' => 'OUTDOOR 6', 'orientation' => 'landscape'],
            ['name' => 'OUTDOOR 7', 'orientation' => 'landscape'],
            ['name' => 'OUTDOOR 8', 'orientation' => 'landscape'],
            ['name' => 'OUTDOOR 9', 'orientation' => 'landscape'],
            ['name' => 'OUTDOOR 10', 'orientation' => 'landscape'],
        ];

        foreach ($outdoors as $screen) {
            $venueId = strtolower(str_replace(' ', '-', $screen['name']));
            Screen::updateOrCreate(
                ['venue_id' => $venueId],
                [
                    'tenant_id' => $tenantA->id,
                    'group_id' => $groupTotems->id,
                    'name' => $screen['name'],
                    'device_token_hash' => Hash::make(Str::uuid()->toString()),
                    'status' => 'offline',
                    'orientation' => $screen['orientation'],
                    'resolution_width' => 1920,
                    'resolution_height' => 1080,
                ]
            );
        }

        // ─── Network Demo Screen ───
        $deviceTokenB1 = 'pilot-token-tenant-b-screen-1';
        Screen::updateOrCreate(
            ['venue_id' => 'network-demo-lobby-1'],
            [
                'tenant_id' => $tenantB->id,
                'group_id' => $groupDemo->id,
                'name' => 'Lobby Screen 1',
                'device_token_hash' => Hash::make($deviceTokenB1),
                'status' => 'offline',
                'orientation' => 'portrait',
                'resolution_width' => 2160,
                'resolution_height' => 3840,
            ]
        );

        // ─── Output summary ───
        $this->command->info('');
        $this->command->info('╔══════════════════════════════════════════════════════════════╗');
        $this->command->info('║          MULTI-TENANT PILOT SEEDED                         ║');
        $this->command->info('╠══════════════════════════════════════════════════════════════╣');
        $this->command->info('║                                                            ║');
        $this->command->info('║  Tenant: Prodooh                                           ║');
        $this->command->info('║    • Grupo: Oficina Piso 17 (2 pantallas)                  ║');
        $this->command->info('║    • Grupo: AIFA Totems (39 totems + 6 columnas + 10 out)  ║');
        $this->command->info('║    • Grupo: AIFA Videowalls (premium+puente+vw+cilíndrica) ║');
        $this->command->info('║    • Admin: admin-a@prodooh.com / password                 ║');
        $this->command->info('║    • Device tokens oficina:                                ║');
        $this->command->info('║      - Totem 1: ' . $deviceTokenA1 . '           ║');
        $this->command->info('║      - Totem 2: ' . $deviceTokenA2 . '           ║');
        $this->command->info('║                                                            ║');
        $this->command->info('║  Tenant: Network Demo                                      ║');
        $this->command->info('║    • Grupo: Lobby Principal (1 pantalla portrait)           ║');
        $this->command->info('║    • Admin: admin-b@networkdemo.com / password              ║');
        $this->command->info('║    • Device token: ' . $deviceTokenB1 . '        ║');
        $this->command->info('║                                                            ║');
        $this->command->info('╚══════════════════════════════════════════════════════════════╝');
        $this->command->info('');
    }
}
