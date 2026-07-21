<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateTrackingPixelRequest extends FormRequest
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
        return [
            'url' => ['sometimes', 'url', 'max:2048'],
            'trigger_type' => ['sometimes', Rule::in(['play', 'impression'])],
            'multiplier' => ['sometimes', 'integer', 'min:1'],
        ];
    }

    /**
     * Custom error messages.
     */
    public function messages(): array
    {
        return [
            'url.url' => 'La URL debe ser una URL válida.',
            'url.max' => 'La URL no puede exceder 2048 caracteres.',
            'trigger_type.in' => 'El tipo de trigger debe ser: play o impression.',
            'multiplier.integer' => 'El multiplicador debe ser un número entero.',
            'multiplier.min' => 'El multiplicador debe ser al menos 1.',
        ];
    }
}
