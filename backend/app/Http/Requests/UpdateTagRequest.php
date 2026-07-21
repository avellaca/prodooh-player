<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateTagRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Get the validation rules that apply to the request.
     */
    public function rules(): array
    {
        $tenantId = $this->resolveTenantId();
        $tagId = $this->route('id');

        return [
            'name' => [
                'required',
                'string',
                'max:100',
                Rule::unique('tags', 'name')
                    ->where('tenant_id', $tenantId)
                    ->ignore($tagId),
            ],
        ];
    }

    /**
     * Custom error messages.
     */
    public function messages(): array
    {
        return [
            'name.required' => 'El nombre del tag es obligatorio.',
            'name.max' => 'El nombre del tag no puede exceder 100 caracteres.',
            'name.unique' => 'Ya existe un tag con ese nombre en este network.',
        ];
    }

    /**
     * Resolve the tenant ID from the authenticated user.
     */
    private function resolveTenantId(): ?string
    {
        $user = $this->user();

        if (!$user) {
            return null;
        }

        if ($user->isSuperAdmin()) {
            return app()->bound('current_tenant_id') ? app('current_tenant_id') : null;
        }

        return $user->tenant_id;
    }
}
