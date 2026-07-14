import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { type ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { Plus, Pause, Play, MoreHorizontal, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { DataTable } from "@/components/shared/DataTable";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useOrders, useCreateOrder, useUpdateOrder, useDeleteOrder } from "../hooks";
import { orderSchema, type OrderFormValues } from "../schemas";
import { useAuth } from "@/hooks/use-auth";
import { useTenantContext } from "@/contexts/TenantContext";
import type { Order } from "../types";

// ─── Status badge config ─────────────────────────────────────────────────────

const statusConfig: Record<Order["status"], { label: string; variant: "success" | "warning" | "secondary" | "default"; className?: string }> = {
  active: { label: "Activo", variant: "success" },
  paused: { label: "Pausado", variant: "warning" },
  draft: { label: "Borrador", variant: "secondary" },
  finished: { label: "Finalizado", variant: "default", className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100" },
};

// ─── Page Component ──────────────────────────────────────────────────────────

export default function OrdersPage() {
  const navigate = useNavigate();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deletingOrder, setDeletingOrder] = useState<Order | null>(null);

  const { user } = useAuth();
  const { selectedTenantId } = useTenantContext();
  const isSuperAdmin = user?.role === 'super_admin';
  const needsTenant = isSuperAdmin && !selectedTenantId;

  const { data: orders, isLoading, isError, refetch } = useOrders();
  const createOrder = useCreateOrder();
  const updateOrder = useUpdateOrder();
  const deleteOrder = useDeleteOrder();

  // ─── Toggle pause/activate ───────────────────────────────────────────────

  function handleToggleStatus(order: Order) {
    const newStatus = order.status === "active" ? "paused" : "active";
    updateOrder.mutate({ id: order.id, data: { status: newStatus } });
  }

  // ─── Columns ─────────────────────────────────────────────────────────────

  const columns: ColumnDef<Order, unknown>[] = [
    {
      accessorKey: "name",
      header: "Nombre",
    },
    {
      accessorKey: "advertiser_name",
      header: "Anunciante",
      cell: ({ row }) => row.original.advertiser_name ?? "—",
    },
    {
      accessorKey: "starts_at",
      header: "Inicio",
      cell: ({ row }) => format(new Date(row.original.starts_at), "dd/MM/yyyy"),
    },
    {
      accessorKey: "ends_at",
      header: "Fin",
      cell: ({ row }) => format(new Date(row.original.ends_at), "dd/MM/yyyy"),
    },
    {
      accessorKey: "status",
      header: "Estado",
      cell: ({ row }) => {
        const status = row.original.status;
        const config = statusConfig[status];
        return (
          <Badge variant={config.variant} className={config.className}>
            {config.label}
          </Badge>
        );
      },
    },
    {
      id: "actions",
      enableSorting: false,
      cell: ({ row }) => {
        const order = row.original;
        const canToggle = order.status === "active" || order.status === "paused";
        return (
          <div className="flex items-center gap-1">
            {canToggle && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={updateOrder.isPending}
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleStatus(order);
                }}
                title={order.status === "active" ? "Pausar" : "Activar"}
              >
                {order.status === "active" ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">Acciones</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => setDeletingOrder(order)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Eliminar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  // ─── Create handler ──────────────────────────────────────────────────────

  function handleCreate(data: OrderFormValues) {
    createOrder.mutate(
      {
        name: data.name,
        advertiser_name: data.advertiser_name ?? null,
        starts_at: data.starts_at,
        ends_at: data.ends_at,
        status: data.status,
      },
      { onSuccess: () => setCreateDialogOpen(false) },
    );
  }

  // ─── Delete handler ──────────────────────────────────────────────────────

  function handleDelete() {
    if (!deletingOrder) return;
    deleteOrder.mutate(deletingOrder.id, {
      onSuccess: () => setDeletingOrder(null),
    });
  }

  // ─── Row click → navigate to detail ──────────────────────────────────────

  function handleRowClick(order: Order) {
    navigate(`/orders/${order.id}`);
  }

  // ─── Loading / Error states ──────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Pedidos</h1>
        <LoadingState />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Pedidos</h1>
        <ErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Pedidos</h1>
        <Button
          onClick={() => setCreateDialogOpen(true)}
          disabled={needsTenant}
          title={needsTenant ? "Selecciona un Network para crear pedidos" : undefined}
        >
          <Plus className="mr-2 h-4 w-4" />
          Crear pedido
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={orders ?? []}
        onRowClick={handleRowClick}
      />

      {/* Create Order Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear pedido</DialogTitle>
            <DialogDescription>
              Completa los datos para crear un nuevo pedido.
            </DialogDescription>
          </DialogHeader>
          <OrderInlineForm
            onSubmit={handleCreate}
            isSubmitting={createOrder.isPending}
            onCancel={() => setCreateDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        open={deletingOrder !== null}
        onOpenChange={(open) => { if (!open) setDeletingOrder(null); }}
        title="Eliminar pedido"
        description={`¿Estás seguro de que deseas eliminar "${deletingOrder?.name}"? Esta acción no se puede deshacer.`}
        onConfirm={handleDelete}
      />
    </div>
  );
}

// ─── Inline Order Form (temporary — will be replaced by OrderForm component) ─

interface OrderInlineFormProps {
  onSubmit: (data: OrderFormValues) => void;
  isSubmitting: boolean;
  onCancel: () => void;
}

function OrderInlineForm({ onSubmit, isSubmitting, onCancel }: OrderInlineFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<OrderFormValues>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      name: "",
      advertiser_name: "",
      starts_at: "",
      ends_at: "",
      status: "draft",
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Nombre *</Label>
        <Input id="name" {...register("name")} placeholder="Nombre del pedido" />
        {errors.name && (
          <p className="text-sm text-destructive">{errors.name.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="advertiser_name">Anunciante</Label>
        <Input id="advertiser_name" {...register("advertiser_name")} placeholder="Nombre del anunciante" />
        {errors.advertiser_name && (
          <p className="text-sm text-destructive">{errors.advertiser_name.message}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="starts_at">Fecha inicio *</Label>
          <Input id="starts_at" type="date" {...register("starts_at")} />
          {errors.starts_at && (
            <p className="text-sm text-destructive">{errors.starts_at.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="ends_at">Fecha fin *</Label>
          <Input id="ends_at" type="date" {...register("ends_at")} />
          {errors.ends_at && (
            <p className="text-sm text-destructive">{errors.ends_at.message}</p>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creando..." : "Crear pedido"}
        </Button>
      </DialogFooter>
    </form>
  );
}
