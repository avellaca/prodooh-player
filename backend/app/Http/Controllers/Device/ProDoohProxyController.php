<?php

namespace App\Http\Controllers\Device;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class ProDoohProxyController extends Controller
{
    /**
     * POST /api/device/prodooh/ad
     *
     * Proxy ad requests to the ProDooh SSP API.
     * Avoids CORS issues when the player runs in a browser.
     * The player sends the same payload it would send to the SSP directly.
     */
    public function fetchAd(Request $request): JsonResponse
    {
        \Log::info('SSP Ad Request', $request->all());

        $validated = $request->validate([
            'api_key' => 'required|string',
            'network_id' => 'required|string',
            'venue_id' => 'required|string',
            'width' => 'required',
            'height' => 'required',
            'supported_media' => 'required|array',
        ], [
            'api_key.required' => 'El campo api_key es requerido para SSP.',
            'network_id.required' => 'El campo network_id es requerido para SSP.',
            'venue_id.required' => 'El campo venue_id es requerido para SSP.',
            'width.required' => 'El campo width es requerido para SSP.',
            'height.required' => 'El campo height es requerido para SSP.',
            'supported_media.required' => 'El campo supported_media es requerido para SSP.',
        ]);

        $baseUrl = config('services.prodooh.base_url', 'https://sandbox.api.prodooh.com');

        try {
            $response = Http::timeout(10)
                ->post("{$baseUrl}/v1/ad", $request->only([
                    'api_key',
                    'network_id',
                    'venue_id',
                    'width',
                    'height',
                    'supported_media',
                ]));

            return response()->json($response->json(), $response->status());
        } catch (\Exception $e) {
            return response()->json([
                'error' => 'SSP request failed',
                'message' => $e->getMessage(),
            ], 502);
        }
    }
}
