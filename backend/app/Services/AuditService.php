<?php

namespace App\Services;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

class AuditService implements AuditServiceInterface
{
    /**
     * Valid event types for audit logging.
     */
    private const VALID_EVENT_TYPES = [
        'created',
        'field_modified',
        'status_changed',
        'creative_added',
        'creative_removed',
        'spots_modified',
        'name_changed',
        'target_added',
        'target_removed',
    ];

    /**
     * Registra un evento de auditoría.
     *
     * @param Model $auditable Entidad afectada (polimórfica)
     * @param string $eventType Tipo de evento
     * @param array|null $diff ['old_value' => mixed, 'new_value' => mixed, 'field' => string]
     * @param string|null $userId ID del usuario que realiza el cambio
     */
    public function log(Model $auditable, string $eventType, ?array $diff = null, ?string $userId = null): void
    {
        $resolvedUserId = $userId ?? $this->resolveCurrentUserId();

        AuditLog::create([
            'auditable_type' => get_class($auditable),
            'auditable_id' => $auditable->getKey(),
            'user_id' => $resolvedUserId,
            'event_type' => $eventType,
            'diff' => $diff,
            'created_at' => Carbon::now(),
        ]);
    }

    /**
     * Resolve the current authenticated user's ID.
     */
    private function resolveCurrentUserId(): ?string
    {
        return auth()->id();
    }
}
