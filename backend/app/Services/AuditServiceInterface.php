<?php

namespace App\Services;

use Illuminate\Database\Eloquent\Model;

interface AuditServiceInterface
{
    /**
     * Registra un evento de auditoría.
     *
     * @param Model $auditable Entidad afectada (polimórfica)
     * @param string $eventType Tipo: created|field_modified|status_changed|creative_added|creative_removed|spots_modified|name_changed|target_added|target_removed
     * @param array|null $diff ['old_value' => mixed, 'new_value' => mixed, 'field' => string]
     * @param string|null $userId ID del usuario que realiza el cambio
     */
    public function log(Model $auditable, string $eventType, ?array $diff = null, ?string $userId = null): void;
}
