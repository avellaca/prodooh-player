import { useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { MoreHorizontal, Plus, Pencil, Trash2 } from "lucide-react";

import { DataTable } from "@/components/shared/DataTable";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { TenantForm } from "../components/TenantForm";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useTenants, useCreateTenant, useUpdateTenant, useDeleteTenant } from "../hooks";
import type { Tenant } from "@/types/models";
import type { CreateTenantInput } from "@/schemas/tenant.schema";

export default function TenantsPage() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [deletingTenant, setDeletingTenant] = useState<Tenant | null>(null);

  const { data: tenants, isLoading, isError, refetch } = useTenants();
  const createTenant = useCreateTenant();
  const updateTenant = useUpdateTenant();
  const deleteTenant = useDeleteTenant();

  const columns: ColumnDef<Tenant, unknown>[] = [
    {
      accessorKey: "name",
      header: "Nombre",
    },
    {
      accessorKey: "screens_count",
      header: "Pantallas",
      cell: ({ row }) => row.original.screens_count ?? 0,
    },
    {
      accessorKey: "created_at",
      header: "Fecha de creación",
      cell: ({ row }) => format(new Date(row.original.created_at), "dd/MM/yyyy"),
    },
    {
      id: "actions",
      enableSorting: false,
      cell: ({ row }) => {
        const tenant = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Acciones</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditingTenant(tenant)}>
                <Pencil className="mr-2 h-4 w-4" />
                Editar
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setDeletingTenant(tenant)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Eliminar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  function handleCreate(data: CreateTenantInput) {
    createTenant.mutate(data, {
      onSuccess: () => setCreateDialogOpen(false),
    });
  }

  function handleUpdate(data: CreateTenantInput) {
    if (!editingTenant) return;
    updateTenant.mutate(
      { id: editingTenant.id, data },
      { onSuccess: () => setEditingTenant(null) },
    );
  }

  function handleDelete() {
    if (!deletingTenant) return;
    deleteTenant.mutate(deletingTenant.id, {
      onSuccess: () => setDeletingTenant(null),
    });
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Tenants</h1>
        <LoadingState />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Tenants</h1>
        <ErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Tenants</h1>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Crear tenant
        </Button>
      </div>

      <DataTable columns={columns} data={tenants ?? []} />

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear tenant</DialogTitle>
            <DialogDescription>
              Ingresa el nombre del nuevo tenant.
            </DialogDescription>
          </DialogHeader>
          <TenantForm
            onSubmit={handleCreate}
            isSubmitting={createTenant.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={editingTenant !== null}
        onOpenChange={(open) => { if (!open) setEditingTenant(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar tenant</DialogTitle>
            <DialogDescription>
              Modifica el nombre del tenant.
            </DialogDescription>
          </DialogHeader>
          {editingTenant && (
            <TenantForm
              key={editingTenant.id}
              defaultValues={{ name: editingTenant.name }}
              onSubmit={handleUpdate}
              isSubmitting={updateTenant.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        open={deletingTenant !== null}
        onOpenChange={(open) => { if (!open) setDeletingTenant(null); }}
        title="Eliminar tenant"
        description={`¿Estás seguro de que deseas eliminar "${deletingTenant?.name}"? Esta acción no se puede deshacer.`}
        onConfirm={handleDelete}
      />
    </div>
  );
}
