<?php

namespace App\Services;

use App\Models\Playlist;
use App\Models\PlaylistItem;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Str;

class PlaylistService
{
    /**
     * List all playlists with item count (tenant-filtered via BelongsToTenant).
     */
    public function list(): Collection
    {
        return Playlist::withCount('playlistItems')
            ->orderBy('created_at', 'desc')
            ->get();
    }

    /**
     * Create a new playlist with an initial version.
     *
     * @param  array<string, mixed>  $data
     */
    public function create(array $data): Playlist
    {
        return Playlist::create([
            'tenant_id' => $data['tenant_id'],
            'name' => $data['name'],
            'version' => (string) Str::uuid(),
        ]);
    }

    /**
     * Show a playlist with its items ordered by position.
     */
    public function show(string $id): Playlist
    {
        return Playlist::with(['playlistItems' => function ($query) {
            $query->orderBy('position');
        }])->findOrFail($id);
    }

    /**
     * Replace all items in a playlist and increment the version.
     *
     * @param  array<int, array<string, mixed>>  $items
     */
    public function updateItems(Playlist $playlist, array $items): Playlist
    {
        // Delete existing items
        $playlist->playlistItems()->delete();

        // Create new items
        foreach ($items as $item) {
            // Resolve "content" type to "image" or "video" based on the content's mime_type
            $type = $item['type'];
            if ($type === 'content' && !empty($item['content_id'])) {
                $content = \App\Models\Content::find($item['content_id']);
                $type = ($content && str_starts_with($content->mime_type, 'video/')) ? 'video' : 'image';
            }

            PlaylistItem::create([
                'playlist_id' => $playlist->id,
                'content_id' => $item['content_id'] ?? null,
                'type' => $type,
                'url' => $item['url'] ?? null,
                'duration_seconds' => $item['duration_seconds'] ?? null,
                'position' => $item['position'],
                'refresh_interval' => $item['refresh_interval'] ?? null,
            ]);
        }

        // Increment version (new UUID)
        $playlist->update(['version' => (string) Str::uuid()]);

        // Dispatch manifest recalculation for all screens using this playlist
        $screenIds = $playlist->screens()->pluck('screens.id');
        foreach ($screenIds as $screenId) {
            \App\Jobs\RecalculateManifestJob::dispatch($screenId, true)->afterCommit();
        }

        return $playlist->load(['playlistItems' => function ($query) {
            $query->orderBy('position');
        }]);
    }

    /**
     * Assign a playlist to multiple screens via pivot table.
     *
     * @param  array<int, string>  $screenIds
     */
    public function assignToScreens(Playlist $playlist, array $screenIds): void
    {
        $syncData = [];
        foreach ($screenIds as $screenId) {
            $syncData[$screenId] = ['assigned_at' => now()];
        }

        $playlist->screens()->sync($syncData);

        // Dispatch manifest recalculation for all affected screens
        foreach ($screenIds as $screenId) {
            \App\Jobs\RecalculateManifestJob::dispatch($screenId, true)->afterCommit();
        }
    }

    /**
     * Delete a playlist and its items (cascade handled by DB).
     */
    public function delete(Playlist $playlist): void
    {
        $playlist->delete();
    }
}
