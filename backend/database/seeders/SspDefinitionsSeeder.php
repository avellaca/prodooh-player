<?php

namespace Database\Seeders;

use App\Models\SspDefinition;
use Illuminate\Database\Seeder;

/**
 * Seeds the SSP Definitions (provider catalog).
 *
 * Creates "Prodooh SSP" and "VIOOH SSP" definitions with their
 * respective credential field schemas.
 */
class SspDefinitionsSeeder extends Seeder
{
    public function run(): void
    {
        SspDefinition::updateOrCreate(
            ['slug' => 'prodooh'],
            [
                'name' => 'Prodooh SSP',
                'logo_url' => null,
                'base_url' => 'https://sandbox.api.prodooh.com',
                'description' => 'Prodooh programmatic SSP para redes DOOH propias. Endpoints: /v1/ad (fetch creative), /v1/ping (validate credentials).',
                'credential_fields' => [
                    ['key' => 'api_key', 'label' => 'API Key', 'type' => 'text'],
                    ['key' => 'network_id', 'label' => 'Network ID', 'type' => 'text'],
                ],
                'active' => true,
            ]
        );

        SspDefinition::updateOrCreate(
            ['slug' => 'viooh'],
            [
                'name' => 'VIOOH SSP',
                'logo_url' => null,
                'base_url' => 'https://api.viooh.com/v1',
                'description' => 'VIOOH — plataforma programática global para Digital Out-of-Home.',
                'credential_fields' => [
                    ['key' => 'api_key', 'label' => 'API Key', 'type' => 'text'],
                    ['key' => 'publisher_id', 'label' => 'Publisher ID', 'type' => 'text'],
                    ['key' => 'secret', 'label' => 'Secret', 'type' => 'password'],
                ],
                'active' => false,
            ]
        );

        $this->command->info('SSP Definitions seeded: Prodooh SSP, VIOOH SSP');
    }
}
