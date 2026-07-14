import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { ArrowLeft, Edit, Plus, Pause, Play, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorState } from '@/components/shared/ErrorState';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';

import {
  useOrder,
  useOrderLines,
  useUpdateOrder,
  useCreateOrderLine,
  useUpdateOrderLine,
  useDeleteOrderLine,
  useDeliveryProgress,
} from '../hooks';
import { orderSchema } from '../schemas';
import type { OrderFormValues } from '../schemas';
import type { Order, OrderLine } from '../types';
import { OrderLineForm, type OrderLineSubmitPayload } from '../components/OrderLineForm';
import { sumOrderLineSpots } from '../utils/orderline-calculations';

// ─── Status helpers ──────────────────────────────────────────────────────────

const STATUS_LABELS: Record<Order['status'], string> = {
  draft: 'Borrador',
  active: 'Activo',
  paused: 'Pausado',
  finished: 'Finalizado',
};

const STATUS_VARIANTS: Record<Order['status'], 'default' | 'success' | 'warning' | 'secondary'> = {
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

/** Format ISO date string to dd/MM/yyyy */
function formatDate(isoDate: string): string {
  return format(new Date(isoDate), 'dd-MM-yyyy');
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Queries
  const { data: order, isLoading: orderLoading, isError: orderError, refetch: refetchOrder } = useOrder(id);
  const { data: orderLines, isLoading: linesLoading, isError: linesError, refetch: refetchLines } = useOrderLines(id);
  const { data: deliveryProgress } = useDeliveryProgress(id);

  // Mutations
  const updateOrder = useUpdateOrder();
  const createOrderLine = useCreateOrderLine(id ?? '');
  const updateOrderLine = useUpdateOrderLine(id ?? '');
  const deleteOrderLine = useDeleteOrderLine(id ?? '');

  // Dialog state
  const [editOrderOpen, setEditOrderOpen] = useState(false);
  const [createLineOpen, setCreateLineOpen] = useState(false);
  const [deletingLineId, setDeletingLineId] = useState<string | null>(null);
  const [activateOrderConfirmOpen, setActivateOrderConfirmOpen] = useState(false);
  const [pendingOrderStatus, setPendingOrderStatus] = useState<string | null>(null);

  // ─── Loading / Error states ──────────────────────────────────────────────

  if (orderLoading) {
    return (
      <div className="space-y-6">
        <LoadingState rows={3} />
      </div>
    );
  }

  if (orderError || !order) {
    return (
      <ErrorState
        message="Error al cargar el pedido"
        onRetry={() => refetchOrder()}
      />
    );
  }

  // Derived value in render (no useEffect)
  const totalSpots = orderLines ? sumOrderLineSpots(orderLines) : 0;

  return (
    <div className="space-y-6">
      {/* Header with back button */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/orders')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{order.name}</h1>
          <p className="text-sm text-muted-foreground">
            {order.advertiser_name && `${order.advertiser_name} · `}
            {formatDate(order.starts_at)} — {formatDate(order.ends_at)}
          </p>
        </div>
      </div>

      {/* Order info card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-lg">Información del pedido</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setEditOrderOpen(true)}>
            <Edit className="mr-2 h-4 w-4" />
            Editar pedido
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Nombre</p>
              <p className="text-sm">{order.name}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Anunciante</p>
              <p className="text-sm">{order.advertiser_name ?? '—'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Fechas</p>
              <p className="text-sm">{formatDate(order.starts_at)} → {formatDate(order.ends_at)}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Estado</p>
              <Select
                value={order.status}
                onValueChange={(newStatus) => {
                  if (order.status === 'draft' && newStatus === 'active') {
                    // When activating from draft, ask about order lines
                    setPendingOrderStatus(newStatus);
                    setActivateOrderConfirmOpen(true);
                  } else {
                    updateOrder.mutate({ id: order.id, data: { status: newStatus } });
                  }
                }}
              >
                <SelectTrigger className="w-[140px] mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Borrador</SelectItem>
                  <SelectItem value="active">Activo</SelectItem>
                  <SelectItem value="paused">Pausado</SelectItem>
                  <SelectItem value="finished">Finalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total spots</p>
              <p className="text-sm">{totalSpots.toLocaleString()}</p>
            </div>
            {deliveryProgress && deliveryProgress.total_progress !== null && (
              <div className="sm:col-span-2 lg:col-span-4">
                <p className="text-sm font-medium text-muted-foreground mb-1">Progreso de entrega</p>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${deliveryProgress.total_progress}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium whitespace-nowrap">
                    {deliveryProgress.total_delivered.toLocaleString()} / {deliveryProgress.total_target.toLocaleString()} ({deliveryProgress.total_progress}%)
                  </span>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Order Lines section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Líneas de pedido</h2>
          <Button onClick={() => setCreateLineOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Crear línea de pedido
          </Button>
        </div>

        {linesLoading ? (
          <LoadingState rows={3} />
        ) : linesError ? (
          <ErrorState
            message="Error al cargar las líneas de pedido"
            onRetry={() => refetchLines()}
          />
        ) : !orderLines || orderLines.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">
                No hay líneas de pedido. Crea una para comenzar.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Prioridad</TableHead>
                  <TableHead>Fechas</TableHead>
                  <TableHead>Ritmo de entrega</TableHead>
                  <TableHead>Spots</TableHead>
                  <TableHead>Entrega</TableHead>
                  <TableHead>Peso</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderLines.map((line) => (
                  <OrderLineRow
                    key={line.id}
                    line={line}
                    orderId={id!}
                    lineProgress={deliveryProgress?.lines.find((l) => l.order_line_id === line.id)}
                    onToggleStatus={(line) => {
                      const newStatus = line.status === 'active' ? 'paused' : 'active';
                      if (newStatus === 'active' && order.status !== 'active') {
                        // Can't activate a line if the order isn't active
                        return;
                      }
                      updateOrderLine.mutate({ id: line.id, data: { status: newStatus } });
                    }}
                    onDelete={(lineId) => {
                      setDeletingLineId(lineId);
                    }}
                    onNavigate={(lineId) => navigate(`/orders/${id}/lines/${lineId}`)}
                  />
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      {/* Edit Order Dialog */}
      <EditOrderDialog
        order={order}
        open={editOrderOpen}
        onOpenChange={setEditOrderOpen}
        onSubmit={(data) => {
          updateOrder.mutate(
            { id: order.id, data },
            { onSuccess: () => setEditOrderOpen(false) }
          );
        }}
        isSubmitting={updateOrder.isPending}
      />

      {/* Create Order Line Dialog */}
      <CreateOrderLineDialog
        open={createLineOpen}
        onOpenChange={setCreateLineOpen}
        onSubmit={(data) => {
          createOrderLine.mutate(data, {
            onSuccess: () => setCreateLineOpen(false),
          });
        }}
        isSubmitting={createOrderLine.isPending}
        parentOrder={{ starts_at: order.starts_at.split('T')[0], ends_at: order.ends_at.split('T')[0] }}
      />

      {/* Delete Order Line Confirm Dialog */}
      <ConfirmDialog
        open={deletingLineId !== null}
        onOpenChange={(open) => { if (!open) setDeletingLineId(null); }}
        title="Eliminar línea de pedido"
        description="¿Estás seguro de que deseas eliminar esta línea de pedido? Esta acción no se puede deshacer."
        onConfirm={() => {
          if (deletingLineId) deleteOrderLine.mutate(deletingLineId);
        }}
        confirmLabel="Eliminar"
        variant="destructive"
      />

      {/* Activate Order + Lines Confirm Dialog */}
      <Dialog open={activateOrderConfirmOpen} onOpenChange={setActivateOrderConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activar pedido</DialogTitle>
            <DialogDescription>
              ¿Deseas activar también todas las líneas de pedido?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                // Activate order only, not lines
                if (pendingOrderStatus) {
                  updateOrder.mutate({ id: order.id, data: { status: pendingOrderStatus } });
                }
                setActivateOrderConfirmOpen(false);
                setPendingOrderStatus(null);
              }}
            >
              No, las activaré manualmente
            </Button>
            <Button
              onClick={() => {
                // Activate order AND all lines
                if (pendingOrderStatus) {
                  updateOrder.mutate(
                    { id: order.id, data: { status: pendingOrderStatus } },
                    {
                      onSuccess: () => {
                        // Activate all draft/paused lines
                        orderLines?.forEach((line) => {
                          if (line.status === 'draft' || line.status === 'paused') {
                            updateOrderLine.mutate({ id: line.id, data: { status: 'active' } });
                          }
                        });
                      },
                    }
                  );
                }
                setActivateOrderConfirmOpen(false);
                setPendingOrderStatus(null);
              }}
            >
              Sí, activar todas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Order Line Row ──────────────────────────────────────────────────────────

interface OrderLineRowProps {
  line: OrderLine;
  orderId: string;
  lineProgress?: { total_progress: number | null; today_progress: number | null; total_delivered: number; today_delivered: number; daily_budget: number | null };
  onToggleStatus: (line: OrderLine) => void;
  onDelete: (lineId: string) => void;
  onNavigate: (lineId: string) => void;
}

function OrderLineRow({ line, lineProgress, onToggleStatus, onDelete, onNavigate }: OrderLineRowProps) {
  const canToggle = line.status === 'active' || line.status === 'paused' || line.status === 'draft';

  return (
    <TableRow
      className="cursor-pointer"
      onClick={() => onNavigate(line.id)}
    >
      <TableCell className="font-medium">{line.name}</TableCell>
      <TableCell>{PRIORITY_LABELS[line.priority_tier]}</TableCell>
      <TableCell className="text-sm">
        {formatDate(line.starts_at)} → {formatDate(line.ends_at)}
      </TableCell>
      <TableCell>{PACE_LABELS[line.delivery_pace]}</TableCell>
      <TableCell>{line.target_spots?.toLocaleString() ?? '—'}</TableCell>
      <TableCell>
        {lineProgress && lineProgress.total_progress !== null ? (
          <div className="space-y-1 min-w-[100px]">
            <div className="flex items-center gap-1">
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${lineProgress.total_progress}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">{lineProgress.total_progress}%</span>
            </div>
            {lineProgress.today_progress !== null && (
              <div className="flex items-center gap-1">
                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-500 transition-all"
                    style={{ width: `${lineProgress.today_progress}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">hoy {lineProgress.today_progress}%</span>
              </div>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>{line.share_weight}</TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANTS[line.status]}>
          {STATUS_LABELS[line.status]}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          {canToggle && (
            <Button
              variant="ghost"
              size="icon"
              title={line.status === 'active' ? 'Pausar' : 'Activar'}
              onClick={(e) => {
                e.stopPropagation();
                onToggleStatus(line);
              }}
            >
              {line.status === 'active' ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            title="Eliminar"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(line.id);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Edit Order Dialog ───────────────────────────────────────────────────────

interface EditOrderDialogProps {
  order: Order;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: OrderFormValues) => void;
  isSubmitting: boolean;
}

function EditOrderDialog({ order, open, onOpenChange, onSubmit, isSubmitting }: EditOrderDialogProps) {
  const form = useForm<OrderFormValues>({
    resolver: zodResolver(orderSchema),
    values: {
      name: order.name,
      advertiser_name: order.advertiser_name,
      starts_at: order.starts_at?.split('T')[0] ?? '',
      ends_at: order.ends_at?.split('T')[0] ?? '',
      status: order.status,
    },
  });

  function handleSubmit(data: OrderFormValues) {
    onSubmit(data);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Editar pedido</DialogTitle>
          <DialogDescription>Modifica los datos del pedido</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Nombre</Label>
            <Input id="edit-name" {...form.register('name')} />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-advertiser">Anunciante</Label>
            <Input id="edit-advertiser" {...form.register('advertiser_name')} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-starts">Fecha inicio</Label>
              <Input id="edit-starts" type="date" {...form.register('starts_at')} />
              {form.formState.errors.starts_at && (
                <p className="text-sm text-destructive">{form.formState.errors.starts_at.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-ends">Fecha fin</Label>
              <Input id="edit-ends" type="date" {...form.register('ends_at')} />
              {form.formState.errors.ends_at && (
                <p className="text-sm text-destructive">{form.formState.errors.ends_at.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Estado</Label>
            <Select
              value={form.watch('status')}
              onValueChange={(val) => form.setValue('status', val as OrderFormValues['status'])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Borrador</SelectItem>
                <SelectItem value="active">Activo</SelectItem>
                <SelectItem value="paused">Pausado</SelectItem>
                <SelectItem value="finished">Finalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create Order Line Dialog ────────────────────────────────────────────────

interface CreateOrderLineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: OrderLineSubmitPayload) => void;
  isSubmitting: boolean;
  parentOrder: { starts_at: string; ends_at: string };
}

function CreateOrderLineDialog({ open, onOpenChange, onSubmit, isSubmitting, parentOrder }: CreateOrderLineDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Crear línea de pedido</DialogTitle>
          <DialogDescription>Agrega una nueva línea al pedido</DialogDescription>
        </DialogHeader>
        <OrderLineForm
          onSubmit={(data) => {
            onSubmit(data);
          }}
          isSubmitting={isSubmitting}
          parentOrder={parentOrder}
        />
      </DialogContent>
    </Dialog>
  );
}
