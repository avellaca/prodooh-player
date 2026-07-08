<?php

namespace App\Http\Controllers\Device;

use App\Http\Controllers\Controller;
use App\Models\DeviceCommand;
use App\Models\Screenshot;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class ScreenshotController extends Controller
{
    /**
     * Handle screenshot upload from a device.
     *
     * Accepts a multipart/form-data request with the screenshot image
     * and captured_at timestamp. Stores the file and creates a Screenshot record.
     * If there's a pending screenshot command for this screen, marks it as completed.
     */
    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'image' => 'required|file|mimes:jpeg,png',
            'captured_at' => 'required|date',
        ]);

        $screenId = $request->attributes->get('screen_id');

        // Generate a unique filename and store the image
        $filename = Str::uuid() . '.jpg';
        $storagePath = "screenshots/{$screenId}/{$filename}";
        $request->file('image')->storeAs("screenshots/{$screenId}", $filename);

        // Create the Screenshot record
        $screenshot = Screenshot::create([
            'screen_id' => $screenId,
            'storage_path' => $storagePath,
            'captured_at' => $request->input('captured_at'),
        ]);

        // Mark any pending screenshot commands as completed
        DeviceCommand::where('screen_id', $screenId)
            ->where('type', 'screenshot')
            ->where('status', 'pending')
            ->update(['status' => 'completed']);

        return response()->json([
            'id' => $screenshot->id,
            'url' => $storagePath,
        ], 201);
    }
}
