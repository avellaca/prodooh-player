export type AuditableType = 'orders' | 'order-lines' | 'creatives';

export type AuditEventType =
  | 'created'
  | 'field_modified'
  | 'status_changed'
  | 'creative_added'
  | 'creative_removed'
  | 'spots_modified'
  | 'name_changed'
  | 'target_added'
  | 'target_removed';

export interface AuditLogEntry {
  id: string;
  auditable_type: string;
  auditable_id: string;
  user_id: string | null;
  event_type: AuditEventType;
  diff: AuditDiff | null;
  entity_name?: string | null;
  created_at: string;
  user?: {
    id: string;
    name: string;
    email: string;
  } | null;
}

export interface AuditDiff {
  field?: string;
  old_value?: unknown;
  new_value?: unknown;
}

export interface AuditLogPaginatedResponse {
  data: AuditLogEntry[];
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}
