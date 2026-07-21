import { useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { AuditLogModal } from '@/features/audit';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorState } from '@/components/shared/ErrorState';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';

import { useOrder, useResolutions, useActivateOrderLine } from '../hooks';
import { useAuth } from '@/hooks/use-auth';
import { orderLinesApi } from '../api';
import type { AvailabilityInfo } from '../api';
import { OrderLineForm } from '../components/OrderLineForm';
import { AvailabilityAlertModal } from '../components/AvailabilityAlertModal';
import { PlaybackModeSelector } from '../components/PlaybackModeSelector';
import { TargetSelector } from '../components/TargetSelector';
import { BulkCreativesModal } from '../components/BulkCreativesModal';
import { TabbedCreativeView } from '../components/TabbedCreativeView';
import { CopyCreativesDialog } from '../components/CopyCreativesDialog';
import type { OrderLine } from '../types';
import type { OrderLineFormValues } from '../schemas';
import { queryClient } from '@/lib/query-client';
import { useTenant } from '@/features/tenants/hooks';
import { TrackingPixelPanel } from '../components/TrackingPixelPanel';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<OrderLine['status'], string> = {
  draft: 'Borrador',
  active: 'Activo',
  paused: 'Pausado',
  finished: 'Finalizado',
};

const STATUS_VARIANTS: Record<OrderLine['status'], 'default' | 'success' | 'warning' | 'secondary'> = {
  draft: 'secondary',
  active: 'success',
  paused: 'warning',
  finished: 'default',
};

const PRIORITY_LABELS: Record<OrderLine['priority_tier'], string> = {
  patrocinio: 'Patrocinio',
  estandar: 'Estándar',
  red_interna: 'Red Interna',
};

const PACE_LABELS: Record<OrderLine['delivery_pace'], string> = {
  asap: 'Lo antes posible',
  uniform: 'Uniforme',
};

function formatDate(isoDate: string): string {
  return format(new Date(isoDate), 'dd-MM-yyyy');
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function OrderLineDetailPage() {
  const { id: orderId, lineId } = useParams<{ id: string; lineId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isTrafficker = user?.role === 'trafficker';
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [availabilityModalOpen, setAvailabilityModalOpen] = useState(false);
  const [availabilityInfo, setAvailabilityInfo] = useState<AvailabilityInfo | null>(null);
  const [librarySelectorOpen, setLibrarySelectorOpen] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);

  // ─── Queries ───────────────────────────────────────────────────────────────

  const {
    data: orderLine,
    isLoading: lineLoading,
    isError: lineError,
    refetch: refetchLine,
  } = useQuery({
    queryKey: ['order-lines', lineId],
    queryFn: () => orderLinesApi.get(lineId!),
    enabled: !!lineId,
  });

  const { data: order } = useOrder(orderId);

  // Fetch tenant config for ad_slots calculation (used by "Por Slot" toggle)
  const { data: tenant } = useTenant(order?.tenant_id);
  const adSlots = tenant
    ? tenant.num_slots - tenant.ssp_slots - tenant.playlist_slots
    : undefined;
  // Calculate loops_per_day: operating_window / (num_slots × slot_duration)
  // Default operating window: 16h (57600s), slot_duration from tenant.default_duration_seconds or 10s
  const loopsPerDay = tenant
    ? Math.floor(57600 / (tenant.num_slots * (tenant.default_duration_seconds ?? 10)))
    : undefined;

  const {
    data: resolutions,
    isLoading: resolutionsLoading,
    isError: resolutionsError,
    refetch: refetchResolutions,
  } = useResolutions(lineId);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const updateOrderLine = useMutation({
    mutationFn: (data: Partial<OrderLineFormValues>) => orderLinesApi.update(lineId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-lines', lineId] });
      toast.success('Línea de pedido actualizada');
      setEditOpen(false);
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al actualizar la línea');
    },
  });

  const deleteOrderLine = useMutation({
    mutationFn: () => orderLinesApi.delete(lineId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders', orderId, 'order-lines'] });
      toast.success('Línea de pedido eliminada');
      navigate(`/orders/${orderId}`);
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al eliminar la línea');
    },
  });

  // ─── Activation with availability check ────────────────────────────────────

  const activateOrderLine = useActivateOrderLine(orderId!, {
    onInsufficientAvailability: (response) => {
      setAvailabilityInfo(response.availability);
      setAvailabilityModalOpen(true);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-lines', lineId] });
    },
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleCreativeAdded = useCallback(() => {
    refetchResolutions();
  }, [refetchResolutions]);

  // ─── Derived values ────────────────────────────────────────────────────────

  // ─── Loading / Error ───────────────────────────────────────────────────────

  if (lineLoading) {
    return (
      <div className="space-y-6">
        <LoadingState rows={3} />
      </div>
    );
  }

  if (lineError || !orderLine) {
    return (
      <ErrorState
        message="Error al cargar la línea de pedido"
        onRetry={() => refetchLine()}
      />
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/orders/${orderId}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{orderLine.name}</h1>
          <p className="text-sm text-muted-foreground">
            {order?.name && `${order.name} · `}
            {formatDate(orderLine.starts_at)} — {formatDate(orderLine.ends_at)}
          </p>
        </div>
        <Badge variant={STATUS_VARIANTS[orderLine.status]}>
          {STATUS_LABELS[orderLine.status]}
        </Badge>
        {!isTrafficker && (
          <Select
            value={orderLine.status}
            onValueChange={(newStatus) => {
              // Prevent activating if parent order isn't active
              if (newStatus === 'active' && order && order.status !== 'active') {
                toast.error('No se puede activar una línea de un pedido que no está activo');
                return;
              }
              // Use dedicated activation endpoint with availability check
              if (newStatus === 'active') {
                activateOrderLine.mutate({ id: lineId!, force: false });
                return;
              }
              updateOrderLine.mutate({ status: newStatus });
            }}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Borrador</SelectItem>
              <SelectItem value="active" disabled={order?.status !== 'active'}>
                Activo
              </SelectItem>
              <SelectItem value="paused">Pausado</SelectItem>
              <SelectItem value="finished">Finalizado</SelectItem>
            </SelectContent>
          </Select>
        )}
        <AuditLogModal auditableType="order-lines" auditableId={lineId!} entityName={orderLine?.name} />
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="h-4 w-4" />
          Editar
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
          Eliminar
        </Button>
      </div>

      {/* Order Line info card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Información de la línea</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Prioridad</p>
              <p className="text-sm">{PRIORITY_LABELS[orderLine.priority_tier]}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Fechas</p>
              <p className="text-sm">{formatDate(orderLine.starts_at)} → {formatDate(orderLine.ends_at)}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Spots objetivo</p>
              <p className="text-sm">{orderLine.target_spots ?? '—'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Ritmo de entrega</p>
              <p className="text-sm">{PACE_LABELS[orderLine.delivery_pace]}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Target assignment (screens / groups) */}
      <TargetSelector orderLineId={lineId!} />

      {/* Playback Mode Selector */}
      <PlaybackModeSelector
        orderLineId={lineId!}
        currentMode={orderLine.playback_mode ?? 'round_robin'}
      />

      {/* Tabbed Creative View — Por Resolución (default), Por Grupo, Por Pantalla */}
      <TabbedCreativeView
        resolutions={resolutions}
        resolutionsLoading={resolutionsLoading}
        resolutionsError={resolutionsError}
        refetchResolutions={refetchResolutions}
        orderLineId={lineId!}
        playbackMode={orderLine.playback_mode ?? 'round_robin'}
        onCreativeAdded={handleCreativeAdded}
        onOpenLibrarySelector={() => setLibrarySelectorOpen(true)}
        onOpenCopyDialog={() => setCopyDialogOpen(true)}
      />
      {/* Tracking Pixels — OrderLine level */}
      <TrackingPixelPanel
        trackableType="order-lines"
        trackableId={lineId!}
        title="Tracking Pixels (Línea de pedido)"
      />

      {/* Edit Order Line Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[550px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar línea de pedido</DialogTitle>
            <DialogDescription>Modifica los datos de la línea</DialogDescription>
          </DialogHeader>
          <OrderLineForm
            defaultValues={{
              name: orderLine.name,
              priority_tier: orderLine.priority_tier,
              active_dates: orderLine.active_dates ?? [],
              spots_mode: 'spots_por_dia',
              spots_input: (orderLine.active_dates && orderLine.active_dates.length > 0)
                ? Math.round((orderLine.target_spots ?? 0) / orderLine.active_dates.length)
                : orderLine.target_spots ?? 1,
              delivery_pace: orderLine.delivery_pace,
              status: orderLine.status,
              by_slot: orderLine.by_slot ?? false,
              slots_purchased: orderLine.slots_purchased ?? undefined,
            }}
            parentOrder={order ? { starts_at: order.starts_at?.split('T')[0] ?? '', ends_at: order.ends_at?.split('T')[0] ?? '' } : { starts_at: orderLine.starts_at?.split('T')[0] ?? '', ends_at: orderLine.ends_at?.split('T')[0] ?? '' }}
            onSubmit={(data) => updateOrderLine.mutate(data)}
            isSubmitting={updateOrderLine.isPending}
            adSlots={adSlots}
            loopsPerDay={loopsPerDay}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Order Line Confirm Dialog */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Eliminar línea de pedido"
        description="¿Estás seguro de que deseas eliminar esta línea de pedido? Esta acción no se puede deshacer."
        onConfirm={() => deleteOrderLine.mutate()}
        confirmLabel="Eliminar"
        variant="destructive"
      />

      {/* Availability Alert Modal — shown when activating with insufficient capacity */}
      {availabilityInfo && (
        <AvailabilityAlertModal
          open={availabilityModalOpen}
          onOpenChange={setAvailabilityModalOpen}
          availability={availabilityInfo}
          isConfirming={activateOrderLine.isPending}
          onConfirm={() => {
            activateOrderLine.mutate(
              { id: lineId!, force: true },
              {
                onSuccess: () => {
                  setAvailabilityModalOpen(false);
                  setAvailabilityInfo(null);
                },
              }
            );
          }}
          onModify={() => {
            setAvailabilityModalOpen(false);
            setAvailabilityInfo(null);
            setEditOpen(true);
          }}
        />
      )}

      {/* Bulk Creatives Modal — library selection + upload with auto-assign */}
      <BulkCreativesModal
        open={librarySelectorOpen}
        onOpenChange={setLibrarySelectorOpen}
        orderLineId={lineId!}
        onAssignComplete={handleCreativeAdded}
      />

      {/* Copy Creatives Dialog — copy to another OrderLine */}
      <CopyCreativesDialog
        open={copyDialogOpen}
        onOpenChange={setCopyDialogOpen}
        sourceOrderLineId={lineId!}
        sourceOrderId={orderId!}
        onSuccess={handleCreativeAdded}
      />
    </div>
  );
}
