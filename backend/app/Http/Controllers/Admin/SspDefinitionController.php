<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\SspDefinition;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Super Admin panel: manage SSP definitions (global catalog).
 */
class SspDefinitionController extends Controller
{
    public function index(): JsonResponse
    {
        $definitions = SspDefinition::orderBy('name')->get();
        return response()->json(['data' => $definitions]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'slug' => ['required', 'string', 'max:100', 'unique:ssp_definitions,slug'],
            'logo_url' => ['nullable', 'string', 'max:500'],
            'base_url' => ['required', 'string', 'max:500'],
            'description' => ['nullable', 'string', 'max:500'],
            'credential_fields' => ['required', 'array', 'min:1'],
            'credential_fields.*.key' => ['required', 'string'],
            'credential_fields.*.label' => ['required', 'string'],
            'credential_fields.*.type' => ['sometimes', 'string', 'in:text,password'],
            'active' => ['sometimes', 'boolean'],
        ]);

        $definition = SspDefinition::create($data);
        return response()->json(['data' => $definition], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $definition = SspDefinition::findOrFail($id);

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'slug' => ['sometimes', 'string', 'max:100', 'unique:ssp_definitions,slug,' . $id],
            'logo_url' => ['nullable', 'string', 'max:500'],
            'base_url' => ['sometimes', 'string', 'max:500'],
            'description' => ['nullable', 'string', 'max:500'],
            'credential_fields' => ['sometimes', 'array', 'min:1'],
            'credential_fields.*.key' => ['required_with:credential_fields', 'string'],
            'credential_fields.*.label' => ['required_with:credential_fields', 'string'],
            'credential_fields.*.type' => ['sometimes', 'string', 'in:text,password'],
            'active' => ['sometimes', 'boolean'],
        ]);

        $definition->update($data);
        return response()->json(['data' => $definition->fresh()]);
    }

    public function destroy(string $id): JsonResponse
    {
        $definition = SspDefinition::findOrFail($id);
        $definition->delete();
        return response()->json(['message' => 'SSP definition deleted.']);
    }
}
