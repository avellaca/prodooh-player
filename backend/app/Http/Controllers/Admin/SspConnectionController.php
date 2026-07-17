<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\SspConnection;
use App\Models\SspDefinition;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

/**
 * Tenant Admin: manage SSP connections (credentials per tenant).
 */
class SspConnectionController extends Controller
{
    /**
     * List available SSP definitions + tenant's connections.
     * Shows ALL definitions (active AND inactive) so tenant can see which ones exist.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $tenantId = $user->tenant_id;

        // Super admin: use selected tenant from query param
        if ($user->isSuperAdmin()) {
            $tenantId = $request->input('tenant_id') ?? $request->query('tenant_id');
            if (!$tenantId) {
                return response()->json(['error' => 'Selecciona un Network primero.'], 422);
            }
        }

        // Get ALL SSP definitions (active + inactive)
        $definitions = SspDefinition::orderBy('name')->get();

        // Get this tenant's connections
        $connections = SspConnection::where('tenant_id', $tenantId)
            ->get()
            ->keyBy('ssp_definition_id');

        // Merge: each definition with connection status
        $result = $definitions->map(function ($def) use ($connections) {
            $connection = $connections->get($def->id);
            return [
                'id' => $def->id,
                'name' => $def->name,
                'slug' => $def->slug,
                'logo_url' => $def->logo_url,
                'description' => $def->description,
                'credential_fields' => $def->credential_fields,
                'active' => $def->active, // Whether super admin has enabled it
                'connected' => $connection !== null,
                'connection_id' => $connection?->id,
                'connection_active' => $connection?->active ?? false,
            ];
        });

        return response()->json(['data' => $result]);
    }

    /**
     * Connect (save credentials) for an SSP.
     * Validates credentials via ping before saving.
     */
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        $tenantId = $user->tenant_id;

        // Super admin must provide tenant_id (from query param or body)
        if ($user->isSuperAdmin()) {
            $tenantId = $request->input('tenant_id') ?? $request->query('tenant_id');
            if (!$tenantId) {
                return response()->json(['error' => 'tenant_id required for super admin'], 422);
            }
        }

        $data = $request->validate([
            'ssp_definition_id' => ['required', 'uuid', 'exists:ssp_definitions,id'],
            'credentials' => ['required', 'array'],
        ]);

        // Validate credential fields match the definition
        $definition = SspDefinition::findOrFail($data['ssp_definition_id']);
        $requiredKeys = collect($definition->credential_fields)->pluck('key')->all();

        foreach ($requiredKeys as $key) {
            if (empty($data['credentials'][$key])) {
                return response()->json([
                    'message' => "The credential field '{$key}' is required.",
                    'errors' => ['credentials.' . $key => ["El campo es requerido."]],
                ], 422);
            }
        }

        // Ping the SSP to validate credentials
        $pingResult = $this->pingSSP($definition, $data['credentials']);
        if ($pingResult !== true) {
            return response()->json([
                'message' => $pingResult,
                'ping_failed' => true,
            ], 401);
        }

        $connection = SspConnection::updateOrCreate(
            [
                'tenant_id' => $tenantId,
                'ssp_definition_id' => $data['ssp_definition_id'],
            ],
            [
                'credentials' => $data['credentials'],
                'active' => true,
            ]
        );

        return response()->json([
            'data' => [
                'id' => $connection->id,
                'ssp_definition_id' => $connection->ssp_definition_id,
                'active' => $connection->active,
                'connected' => true,
            ],
        ], 201);
    }

    /**
     * Ping the SSP to validate credentials.
     * Returns true on success, or an error message string on failure.
     */
    private function pingSSP(SspDefinition $definition, array $credentials): bool|string
    {
        // Extract the origin from base_url (scheme + host) and append /v1/ping
        $parsed = parse_url($definition->base_url);
        $origin = ($parsed['scheme'] ?? 'https') . '://' . ($parsed['host'] ?? '');
        if (!empty($parsed['port'])) {
            $origin .= ':' . $parsed['port'];
        }
        $pingUrl = $origin . '/v1/ping';

        try {
            $response = Http::timeout(10)
                ->post($pingUrl, $credentials);

            if ($response->successful()) {
                return true;
            }

            if ($response->status() === 401) {
                return 'Las credenciales son incorrectas. Verifica los datos ingresados o contacta al proveedor SSP.';
            }

            return 'Error al validar credenciales con el proveedor. Código: ' . $response->status();
        } catch (\Exception $e) {
            return 'No se pudo conectar al proveedor SSP. Verifica que el servicio esté disponible.';
        }
    }

    /**
     * Disconnect (deactivate) an SSP connection.
     */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $connection = SspConnection::findOrFail($id);
        $connection->delete();

        return response()->json(['message' => 'SSP disconnected.']);
    }
}
