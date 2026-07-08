<?php

namespace App\Services;

use App\Models\PlaybackLog;
use Illuminate\Support\Facades\DB;

class PlaybackAnalyticsService
{
    /**
     * Query playback analytics with optional filters.
     *
     * Tenant isolation is handled by the BelongsToTenant global scope
     * on the PlaybackLog model.
     *
     * @param array $filters Accepted keys: date_from, date_to, screen_id, source, content_id
     * @return array Aggregated analytics data
     */
    public function query(array $filters): array
    {
        $query = PlaybackLog::query();

        if (!empty($filters['date_from'])) {
            $query->where('started_at', '>=', $filters['date_from']);
        }

        if (!empty($filters['date_to'])) {
            $query->where('started_at', '<=', $filters['date_to']);
        }

        if (!empty($filters['screen_id'])) {
            $query->where('screen_id', $filters['screen_id']);
        }

        if (!empty($filters['source'])) {
            $query->where('source', $filters['source']);
        }

        if (!empty($filters['content_id'])) {
            $query->where('content_id', $filters['content_id']);
        }

        // Total spots count
        $totalSpots = (clone $query)->count();

        // Spots grouped by source
        $bySource = (clone $query)
            ->select('source', DB::raw('count(*) as count'))
            ->groupBy('source')
            ->pluck('count', 'source')
            ->toArray();

        // Spots grouped by screen
        $byScreen = (clone $query)
            ->select('screen_id', DB::raw('count(*) as count'))
            ->groupBy('screen_id')
            ->get()
            ->map(fn ($row) => [
                'screen_id' => $row->screen_id,
                'count' => $row->count,
            ])
            ->toArray();

        // Spots grouped by content
        $byContent = (clone $query)
            ->select('content_id', DB::raw('count(*) as count'))
            ->groupBy('content_id')
            ->get()
            ->map(fn ($row) => [
                'content_id' => $row->content_id,
                'count' => $row->count,
            ])
            ->toArray();

        return [
            'total_spots' => $totalSpots,
            'by_source' => $bySource,
            'by_screen' => $byScreen,
            'by_content' => $byContent,
        ];
    }
}
