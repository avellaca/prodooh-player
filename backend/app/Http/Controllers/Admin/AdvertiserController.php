<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Advertiser;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdvertiserController extends Controller
{
    /**
     * GET /api/admin/advertisers?q=coca
     *
     * Search advertisers by name (autocomplete). Returns up to 10 matches.
     */
    public function index(Request $request): JsonResponse
    {
        $query = Advertiser::query()->orderBy('name');

        if ($q = $request->input('q')) {
            $query->where('name', 'ilike', "%{$q}%");
        }

        $advertisers = $query->limit(10)->get(['id', 'name']);

        return response()->json(['data' => $advertisers]);
    }

    /**
     * POST /api/admin/advertisers
     *
     * Create a new advertiser. Returns the created advertiser.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
        ]);

        $user = $request->user();
        $tenantId = $user->tenant_id;

        // Super admin: use selected tenant from query param
        if ($user->isSuperAdmin()) {
            $tenantId = $request->input('tenant_id') ?? $request->query('tenant_id');
            if (!$tenantId) {
                return response()->json([
                    'error' => 'Validation failed',
                    'message' => 'Super admin must specify a tenant_id.',
                ], 422);
            }
        }

        $advertiser = Advertiser::create([
            'tenant_id' => $tenantId,
            'name' => $data['name'],
        ]);

        return response()->json(['data' => $advertiser], 201);
    }
}
