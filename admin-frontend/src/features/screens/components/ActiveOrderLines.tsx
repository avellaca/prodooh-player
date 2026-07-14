import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { FileText } from 'lucide-react';

import { useActiveOrderLines } from '../hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorState } from '@/components/shared/ErrorState';
import type { OrderLine } from '@/features/orders/types';

interface ActiveOrderLinesProps {
  screenId: string;
}

const priorityConfig: Record<OrderLine['priority_tier'], { label: string; className: string }> = {
  patrocinio: {
    label: 'Patrocinio',
    className: 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100',
  },
  estandar: {
    label: 'Estándar',
    className: 'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
  },
  red_interna: {
    label: 'Red interna',
    className: 'border-transparent bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-100',
  },
};

const statusConfig: Record<OrderLine['status'], { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }> = {
  draft: { label: 'Borrador', variant: 'secondary' },
  active: { label: 'Activa', variant: 'success' },
  paused: { label: 'Pausada', variant: 'warning' },
  finished: { label: 'Finalizada', variant: 'default' },
};

export function ActiveOrderLines({ screenId }: ActiveOrderLinesProps) {
  const navigate = useNavigate();
  const { data: orderLines, isLoading, isError, refetch } = useActiveOrderLines(screenId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Líneas de pedido activas</CardTitle>
        </CardHeader>
        <CardContent>
          <LoadingState rows={3} />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Líneas de pedido activas</CardTitle>
        </CardHeader>
        <CardContent>
          <ErrorState message="Error al cargar líneas de pedido" onRetry={refetch} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Líneas de pedido activas</CardTitle>
      </CardHeader>
      <CardContent>
        {!orderLines || orderLines.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <FileText className="mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No hay líneas de pedido activas para esta pantalla
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {orderLines.map((line) => {
              const priority = priorityConfig[line.priority_tier];
              const status = statusConfig[line.status];

              return (
                <div
                  key={line.id}
                  className="flex cursor-pointer items-center justify-between rounded-md border p-3 transition-colors hover:bg-muted/50"
                  onClick={() => navigate(`/orders/${line.order_id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/orders/${line.order_id}`);
                    }
                  }}
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{line.name}</span>
                      <Badge className={priority.className}>
                        {priority.label}
                      </Badge>
                      <Badge variant={status.variant}>
                        {status.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {line.order && (
                        <span>Pedido: {line.order.name}</span>
                      )}
                      <span>·</span>
                      <span>
                        {format(new Date(line.starts_at), 'dd/MM/yyyy', { locale: es })}
                        {' — '}
                        {format(new Date(line.ends_at), 'dd/MM/yyyy', { locale: es })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
