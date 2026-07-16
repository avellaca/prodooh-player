<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

/**
 * Lightweight proxy to OpenAI for extracting clean data from voice transcriptions.
 * Used by the voice assistant demo to reason about what the user actually said.
 */
class VoiceExtractController extends Controller
{
    public function extract(Request $request): JsonResponse
    {
        $data = $request->validate([
            'transcript' => ['required', 'string', 'max:500'],
            'field' => ['required', 'string', 'in:order_name,advertiser_name'],
            'context' => ['nullable', 'string', 'max:200'],
        ]);

        $apiKey = config('services.openai.key');

        if (!$apiKey) {
            // Fallback: return the transcript as-is if no API key configured
            return response()->json(['value' => trim($data['transcript'])]);
        }

        $fieldPrompt = match ($data['field']) {
            'order_name' => 'Extrae SOLO el nombre de la campaña/orden/pedido de la siguiente transcripción de voz. Devuelve el nombre limpio en Title Case (primera letra de cada palabra en mayúscula). Sin explicaciones ni comillas.',
            'advertiser_name' => 'Extrae SOLO el nombre del anunciante/marca/cliente de la siguiente transcripción de voz. Devuelve el nombre limpio en Title Case (primera letra de cada palabra en mayúscula, respetando nombres propios de marcas). Sin explicaciones ni comillas.',
        };

        $contextHint = !empty($data['context']) ? "\nContexto: {$data['context']}" : '';

        try {
            $response = Http::withHeaders([
                'Authorization' => "Bearer {$apiKey}",
            ])->timeout(10)->post('https://api.openai.com/v1/chat/completions', [
                'model' => 'gpt-4o-mini',
                'temperature' => 0,
                'max_tokens' => 50,
                'messages' => [
                    [
                        'role' => 'system',
                        'content' => $fieldPrompt . $contextHint,
                    ],
                    [
                        'role' => 'user',
                        'content' => $data['transcript'],
                    ],
                ],
            ]);

            if ($response->successful()) {
                $value = $response->json('choices.0.message.content');
                $clean = trim($value ?? $data['transcript']);
                // Force Title Case regardless of what OpenAI returned
                $clean = mb_convert_case($clean, MB_CASE_TITLE, 'UTF-8');
                return response()->json(['value' => $clean]);
            }

            // API error — fallback to raw transcript
            return response()->json(['value' => mb_convert_case(trim($data['transcript']), MB_CASE_TITLE, 'UTF-8')]);
        } catch (\Throwable) {
            // Timeout or network error — fallback
            return response()->json(['value' => mb_convert_case(trim($data['transcript']), MB_CASE_TITLE, 'UTF-8')]);
        }
    }
}
