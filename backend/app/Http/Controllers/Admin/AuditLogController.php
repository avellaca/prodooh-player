<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class AuditLogController extends Controller
{
    /**
     * Map URL segments to model class names for auditable_type.
     */
    private const AUDITABLE_TYPE_MAP = [
        'orders' => \App\Models\Order::class,
        'order-lines' => \App\Models\OrderLine::class,
        'creatives' => \App\Models\Creative::class,
    ];

    /**
     * Return paginated audit history for an entity.
     *
     * GET /api/admin/{auditableType}/{id}/audit-logs
     */
    public function index(Request $request, string $auditableType, string $id): JsonResponse
    {
        // Validate auditable type
        if (!isset(self::AUDITABLE_TYPE_MAP[$auditableType])) {
            return response()->json([
                'message' => 'Invalid auditable type.',
                'errors' => [
                    'auditable_type' => ["The type '{$auditableType}' is not supported. Supported types: " . implode(', ', array_keys(self::AUDITABLE_TYPE_MAP))],
                ],
            ], 422);
        }

        // Validate UUID format
        if (!Str::isUuid($id)) {
            return response()->json(['message' => 'Entity not found.'], 404);
        }

        $modelClass = self::AUDITABLE_TYPE_MAP[$auditableType];

        // Verify the entity exists
        if (!$modelClass::find($id)) {
            return response()->json(['message' => 'Entity not found.'], 404);
        }

        $perPage = (int) $request->input('per_page', 50);
        $perPage = max(1, min($perPage, 100));

        // For orders: include audit logs from the order AND all its order lines
        if ($auditableType === 'orders') {
            $orderLineIds = \App\Models\OrderLine::where('order_id', $id)->pluck('id')->all();

            $logs = AuditLog::where(function ($q) use ($modelClass, $id, $orderLineIds) {
                $q->where(function ($inner) use ($modelClass, $id) {
                    $inner->where('auditable_type', $modelClass)
                          ->where('auditable_id', $id);
                });
                if (!empty($orderLineIds)) {
                    $q->orWhere(function ($inner) use ($orderLineIds) {
                        $inner->where('auditable_type', \App\Models\OrderLine::class)
                              ->whereIn('auditable_id', $orderLineIds);
                    });
                }
            })
                ->with('user:id,email,role')
                ->orderBy('created_at', 'desc')
                ->paginate($perPage);
        } else {
            $logs = AuditLog::where('auditable_type', $modelClass)
                ->where('auditable_id', $id)
                ->with('user:id,email,role')
                ->orderBy('created_at', 'desc')
                ->paginate($perPage);
        }

        // Enrich logs with readable names for referenced entities
        $logs->getCollection()->transform(function ($log) {
            // Add auditable entity name
            $log->entity_name = $this->resolveEntityName($log->auditable_type, $log->auditable_id);

            // Enrich diff values: replace IDs with names
            if ($log->diff) {
                $log->diff = $this->enrichDiff($log->diff, $log->event_type);
            }

            return $log;
        });

        return response()->json($logs);
    }

    /**
     * Resolve the human-readable name of an auditable entity.
     */
    private function resolveEntityName(string $type, string $id): ?string
    {
        try {
            if (str_contains($type, 'Order') && !str_contains($type, 'OrderLine')) {
                return \App\Models\Order::withoutGlobalScopes()->find($id)?->name;
            }
            if (str_contains($type, 'OrderLine')) {
                return \App\Models\OrderLine::find($id)?->name;
            }
            if (str_contains($type, 'Creative')) {
                $creative = \App\Models\Creative::find($id);
                return $creative ? ('Creativo #' . substr($id, 0, 8)) : null;
            }
        } catch (\Throwable) {
            // Non-critical
        }
        return null;
    }

    /**
     * Enrich diff values by resolving IDs to human-readable names.
     */
    private function enrichDiff(array $diff, string $eventType): array
    {
        $field = $diff['field'] ?? null;
        $oldValue = $diff['old_value'] ?? null;
        $newValue = $diff['new_value'] ?? null;

        // Resolve target references (screen_group:uuid → group name, screen:uuid → screen name)
        if ($field === 'target') {
            if ($oldValue) {
                $diff['old_value'] = $this->resolveTargetName($oldValue);
            }
            if ($newValue) {
                $diff['new_value'] = $this->resolveTargetName($newValue);
            }
        }

        // Resolve creative_id to something readable
        if ($field === 'creative_id') {
            if ($oldValue) {
                $diff['old_value'] = $this->resolveCreativeName($oldValue);
            }
            if ($newValue) {
                $diff['new_value'] = $this->resolveCreativeName($newValue);
            }
        }

        return $diff;
    }

    /**
     * Resolve a target reference string to a readable name.
     * Format: "screen_group:{uuid}" or "screen:{uuid}"
     */
    private function resolveTargetName(string $ref): string
    {
        if (str_starts_with($ref, 'screen_group:')) {
            $id = str_replace('screen_group:', '', $ref);
            $group = \App\Models\ScreenGroup::withoutGlobalScopes()->find($id);
            return $group ? "Grupo: {$group->name}" : $ref;
        }
        if (str_starts_with($ref, 'screen:')) {
            $id = str_replace('screen:', '', $ref);
            $screen = \App\Models\Screen::withoutGlobalScopes()->find($id);
            return $screen ? "Pantalla: {$screen->name}" : $ref;
        }
        return $ref;
    }

    /**
     * Resolve a creative ID to a readable name.
     */
    private function resolveCreativeName(string $id): string
    {
        $creative = \App\Models\Creative::find($id);
        if (!$creative) return "Creativo #" . substr($id, 0, 8);

        $content = $creative->content;
        if ($content && $content->filename) {
            return $content->filename;
        }

        return "Creativo #" . substr($id, 0, 8);
    }
}
