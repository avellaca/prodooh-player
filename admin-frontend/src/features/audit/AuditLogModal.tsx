import { useState } from 'react';
import { Clock } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog';

import { useAuditLogs } from './hooks';
import type { AuditableType, AuditEventType, AuditLogEntry } from './types';

// ─── Event type badge configuration ─────────────────────────────────────────

type BadgeColor = 'success' | 'warning' | 'destructive';

const EVENT_BADGE_MAP: Record<AuditEventType, { label: string; color: BadgeColor }> = {
  created: { label: 'Creado', color: 'success' },
  creative_added: { label: 'Creativo agregado', color: 'success' },
  target_added: { label: 'Inventario asignado', color: 'success' },
  field_modified: { label: 'Campo modificado', color: 'warning' },
  spots_modified: { label: 'Spots modificados', color: 'warning' },
  name_changed: { label: 'Nombre cambiado', color: 'warning' },
  status_changed: { label: 'Estado cambiado', color: 'warning' },
  creative_removed: { label: 'Creativo eliminado', color: 'destructive' },
  target_removed: { label: 'Inventario removido', color: 'destructive' },
};

function EventBadge({ eventType }: { eventType: AuditEventType }) {
  const config = EVENT_BADGE_MAP[eventType] ?? { label: eventType, color: 'warning' as const };
  return <Badge variant={config.color}>{config.label}</Badge>;
}

// ─── Diff display ────────────────────────────────────────────────────────────

function DiffDisplay({ entry }: { entry: AuditLogEntry }) {
  if (!entry.diff) return null;

  const { field, old_value, new_value } = entry.diff;
  if (!field) return null;

  return (
    <div className="rounded bg-muted/50 px-2.5 py-1.5 text-xs">
      <span className="font-medium text-muted-foreground">{field}:</span>{' '}
      {old_value !== null && old_value !== undefined && (
        <><span className="line-through text-red-500">{formatValue(old_value)}</span>{' → '}</>
      )}
      <span className="text-green-600 font-medium">{formatValue(new_value)}</span>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '(vacío)';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// ─── Audit log entry row ─────────────────────────────────────────────────────

/** Map auditable_type class to a human-readable label */
function getEntityLabel(auditableType: string): string {
  if (auditableType.includes('Order') && !auditableType.includes('OrderLine')) return 'Pedido';
  if (auditableType.includes('OrderLine')) return 'Línea de pedido';
  if (auditableType.includes('Creative')) return 'Creativo';
  return '';
}

function AuditLogRow({ entry, showEntity = false }: { entry: AuditLogEntry; showEntity?: boolean }) {
  const timestamp = format(new Date(entry.created_at), "d MMM yyyy, HH:mm", { locale: es });
  const userName = entry.user?.name ?? entry.user?.email ?? 'Sistema';
  const entityLabel = showEntity ? getEntityLabel(entry.auditable_type) : '';
  const entityName = entry.entity_name || '';

  return (
    <div className="border-b py-4 last:border-b-0 space-y-2">
      {/* Top row: badge + timestamp */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <EventBadge eventType={entry.event_type} />
          {entityLabel && (
            <p className="text-xs text-muted-foreground">
              {entityLabel}{entityName ? ` · ${entityName}` : ''}
            </p>
          )}
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">{timestamp}</span>
      </div>

      {/* User */}
      <p className="text-xs text-muted-foreground">
        por <span className="font-medium text-foreground">{userName}</span>
      </p>

      {/* Diff */}
      <DiffDisplay entry={entry} />
    </div>
  );
}

// ─── Loading skeleton ────────────────────────────────────────────────────────

function AuditLogSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 border-b py-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

// ─── Pagination controls ─────────────────────────────────────────────────────

function Pagination({
  currentPage,
  lastPage,
  onPageChange,
}: {
  currentPage: number;
  lastPage: number;
  onPageChange: (page: number) => void;
}) {
  if (lastPage <= 1) return null;

  return (
    <div className="flex items-center justify-between pt-3 border-t">
      <Button
        variant="outline"
        size="sm"
        disabled={currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
      >
        Anterior
      </Button>
      <span className="text-xs text-muted-foreground">
        Página {currentPage} de {lastPage}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={currentPage >= lastPage}
        onClick={() => onPageChange(currentPage + 1)}
      >
        Siguiente
      </Button>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export interface AuditLogModalProps {
  auditableType: AuditableType;
  auditableId: string;
  entityName?: string;
}

export function AuditLogModal({ auditableType, auditableId, entityName }: AuditLogModalProps) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useAuditLogs(
    open ? auditableType : undefined,
    open ? auditableId : undefined,
    page,
  );

  const title = entityName
    ? `Historial de cambios — ${entityName}`
    : 'Historial de cambios';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Ver historial de cambios">
          <Clock className="h-4 w-4" />
          <span className="sr-only">Ver historial de cambios</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Registro cronológico de todas las modificaciones realizadas.
          </DialogDescription>
        </DialogHeader>

        {isLoading && <AuditLogSkeleton />}

        {!isLoading && data && data.data.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No hay cambios registrados.
          </p>
        )}

        {!isLoading && data && data.data.length > 0 && (
          <div className="flex flex-col">
            {data.data.map((entry) => (
              <AuditLogRow key={entry.id} entry={entry} showEntity={auditableType === 'orders'} />
            ))}
            <Pagination
              currentPage={data.current_page}
              lastPage={data.last_page}
              onPageChange={setPage}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
