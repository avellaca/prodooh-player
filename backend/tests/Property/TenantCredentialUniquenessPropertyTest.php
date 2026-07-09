<?php

namespace Tests\Property;

use App\Models\Tenant;
use App\Services\TenantService;
use Eris\Generators;
use Eris\TestTrait;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Property 16: Tenant Credential Uniqueness
 *
 * Generate N tenants and verify all API credentials are pairwise distinct.
 *
 * **Validates: Requirements 11.2**
 */
class TenantCredentialUniquenessPropertyTest extends TestCase
{
    use RefreshDatabase, TestTrait;

    /**
     * Property: When N tenants are created via TenantService, all generated
     * API credentials must be pairwise distinct — no two tenants share the
     * same credential.
     *
     * **Validates: Requirements 11.2**
     */
    public function test_all_tenant_credentials_are_pairwise_distinct(): void
    {
        $this->forAll(
            Generators::choose(2, 10) // number of tenants to create
        )->then(function (int $numTenants): void {
            $service = app(TenantService::class);
            $credentials = [];

            for ($i = 0; $i < $numTenants; $i++) {
                $tenant = $service->create([
                    'name' => "Tenant {$i} " . uniqid(),
                ]);

                $this->assertNotNull(
                    $tenant->api_credential,
                    "Tenant must have an API credential assigned on creation"
                );

                $this->assertNotEmpty(
                    $tenant->api_credential,
                    "Tenant API credential must not be empty"
                );

                $credentials[] = $tenant->api_credential;
            }

            // Verify all credentials are pairwise distinct
            $uniqueCredentials = array_unique($credentials);

            $this->assertCount(
                count($credentials),
                $uniqueCredentials,
                "All {$numTenants} tenant API credentials must be unique. " .
                "Found " . count($uniqueCredentials) . " unique out of " . count($credentials) . " total."
            );

            // Clean up for next iteration
            Tenant::query()->delete();
        });
    }

    /**
     * Property: Credentials generated for new tenants must not collide with
     * any pre-existing tenant credentials in the database.
     *
     * **Validates: Requirements 11.2**
     */
    public function test_new_tenant_credential_does_not_collide_with_existing(): void
    {
        $this->forAll(
            Generators::choose(2, 6), // number of pre-existing tenants
            Generators::choose(1, 5)  // number of new tenants to add
        )->then(function (int $numExisting, int $numNew): void {
            $service = app(TenantService::class);

            // Create pre-existing tenants
            $existingCredentials = [];
            for ($i = 0; $i < $numExisting; $i++) {
                $tenant = $service->create([
                    'name' => "Existing Tenant {$i} " . uniqid(),
                ]);
                $existingCredentials[] = $tenant->api_credential;
            }

            // Create new tenants and verify no collisions with existing
            for ($i = 0; $i < $numNew; $i++) {
                $newTenant = $service->create([
                    'name' => "New Tenant {$i} " . uniqid(),
                ]);

                $this->assertNotContains(
                    $newTenant->api_credential,
                    $existingCredentials,
                    "New tenant credential must be distinct from all existing tenant credentials"
                );
            }

            // Verify all credentials in DB are unique
            $allCredentials = Tenant::pluck('api_credential')->toArray();
            $uniqueAll = array_unique($allCredentials);

            $this->assertCount(
                count($allCredentials),
                $uniqueAll,
                "All tenant credentials in the database must be unique"
            );

            // Clean up for next iteration
            Tenant::query()->delete();
        });
    }
}
