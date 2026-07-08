<?php

namespace App\Services;

use App\Models\Screen;
use App\Models\ScreenGroup;

class ScreenGroupService
{
    /**
     * List all screen groups (tenant-filtered via BelongsToTenant global scope).
     */
    public function list()
    {
        return ScreenGroup::with('screens')->orderBy('created_at', 'desc')->get();
    }

    /**
     * Create a new screen group.
     */
    public function create(array $data): ScreenGroup
    {
        return ScreenGroup::create($data);
    }

    /**
     * Update a screen group's configuration.
     */
    public function update(ScreenGroup $group, array $data): ScreenGroup
    {
        $group->update($data);

        return $group->fresh();
    }

    /**
     * Delete a screen group and unassign all its screens first.
     */
    public function delete(ScreenGroup $group): bool
    {
        // Unassign all screens from this group before deleting
        $group->screens()->update(['group_id' => null]);

        return $group->delete();
    }

    /**
     * Assign screens to a group.
     */
    public function assignScreens(ScreenGroup $group, array $screenIds): ScreenGroup
    {
        Screen::whereIn('id', $screenIds)
            ->where('tenant_id', $group->tenant_id)
            ->update(['group_id' => $group->id]);

        return $group->fresh()->load('screens');
    }

    /**
     * Remove a screen from the group (unassign).
     */
    public function removeScreen(ScreenGroup $group, Screen $screen): void
    {
        if ($screen->group_id === $group->id) {
            $screen->update(['group_id' => null]);
        }
    }

    /**
     * Resolve effective configuration for a screen using the inheritance chain:
     * screen override > group > tenant defaults.
     *
     * @return array{duration_seconds: int|null, schedule: array|null, orientation: string|null}
     */
    public function resolveScreenConfig(Screen $screen): array
    {
        $group = $screen->group_id ? $screen->screenGroup : null;
        $tenant = $screen->tenant;

        return [
            'duration_seconds' => $screen->duration_seconds
                ?? ($group?->duration_seconds)
                ?? $tenant?->default_duration_seconds,
            'schedule' => $screen->schedule
                ?? ($group?->schedule)
                ?? $tenant?->default_schedule,
            'orientation' => $screen->orientation
                ?? ($group?->orientation)
                ?? null,
        ];
    }
}
