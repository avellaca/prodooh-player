<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreTrackingPixelRequest;
use App\Http\Requests\UpdateTrackingPixelRequest;
use App\Models\TrackingPixel;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Str;

class TrackingPixelController extends Controller
{
    /**
     * Map URL segments to model class names for trackable_type.
     */
    private const TRACKABLE_TYPE_MAP = [
        'orders' => \App\Models\Order::class,
        'order-lines' => \App\Models\OrderLine::class,
        'creatives' => \App\Models\Creative::class,
    ];

    /**
     * List tracking pixels for a given trackable entity.
     *
     * GET /api/admin/{trackableType}/{id}/tracking-pixels
     */
    public function index(string $trackableType, string $id): JsonResponse
    {
        $validation = $this->validateTrackable($trackableType, $id);
        if ($validation instanceof JsonResponse) {
            return $validation;
        }

        $modelClass = self::TRACKABLE_TYPE_MAP[$trackableType];

        $pixels = TrackingPixel::where('trackable_type', $modelClass)
            ->where('trackable_id', $id)
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json(['data' => $pixels]);
    }

    /**
     * Create a new tracking pixel for a given trackable entity.
     *
     * POST /api/admin/{trackableType}/{id}/tracking-pixels
     */
    public function store(StoreTrackingPixelRequest $request, string $trackableType, string $id): JsonResponse
    {
        $validation = $this->validateTrackable($trackableType, $id);
        if ($validation instanceof JsonResponse) {
            return $validation;
        }

        $modelClass = self::TRACKABLE_TYPE_MAP[$trackableType];

        $pixel = TrackingPixel::create([
            'trackable_type' => $modelClass,
            'trackable_id' => $id,
            'url' => $request->validated('url'),
            'trigger_type' => $request->validated('trigger_type'),
            'multiplier' => $request->validated('multiplier') ?? 1,
        ]);

        return response()->json(['data' => $pixel], 201);
    }

    /**
     * Update an existing tracking pixel.
     *
     * PUT /api/admin/tracking-pixels/{id}
     */
    public function update(UpdateTrackingPixelRequest $request, string $id): JsonResponse
    {
        if (!Str::isUuid($id)) {
            return response()->json(['message' => 'Tracking pixel not found.'], 404);
        }

        $pixel = TrackingPixel::find($id);

        if (!$pixel) {
            return response()->json(['message' => 'Tracking pixel not found.'], 404);
        }

        $pixel->update($request->validated());

        return response()->json(['data' => $pixel->fresh()]);
    }

    /**
     * Delete a tracking pixel.
     *
     * DELETE /api/admin/tracking-pixels/{id}
     */
    public function destroy(string $id): JsonResponse
    {
        if (!Str::isUuid($id)) {
            return response()->json(['message' => 'Tracking pixel not found.'], 404);
        }

        $pixel = TrackingPixel::find($id);

        if (!$pixel) {
            return response()->json(['message' => 'Tracking pixel not found.'], 404);
        }

        $pixel->delete();

        return response()->json(null, 204);
    }

    /**
     * Validate the trackable type and entity existence.
     *
     * @return JsonResponse|true Returns a JsonResponse on failure, true on success.
     */
    private function validateTrackable(string $trackableType, string $id): JsonResponse|bool
    {
        if (!isset(self::TRACKABLE_TYPE_MAP[$trackableType])) {
            return response()->json([
                'message' => 'Invalid trackable type.',
                'errors' => [
                    'trackable_type' => [
                        "The type '{$trackableType}' is not supported. Supported types: " . implode(', ', array_keys(self::TRACKABLE_TYPE_MAP)),
                    ],
                ],
            ], 422);
        }

        if (!Str::isUuid($id)) {
            return response()->json(['message' => 'Entity not found.'], 404);
        }

        $modelClass = self::TRACKABLE_TYPE_MAP[$trackableType];

        if (!$modelClass::find($id)) {
            return response()->json(['message' => 'Entity not found.'], 404);
        }

        return true;
    }
}
