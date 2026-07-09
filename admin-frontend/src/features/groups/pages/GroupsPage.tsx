import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { type ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Plus, Pencil, Trash2 } from "lucide-react";

import { DataTable } from "@/components/shared/DataTable";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { GroupForm } from "../components/GroupForm";
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

import {
  useGroups,
  useCreateGroup,
  useUpdateGroup,
  useDeleteGroup,
} from "../hooks";
import { useTenantContext } from "@/contexts/TenantContext";
import type { ScreenGroup } from "@/types/models";
import type { CreateGroupInput } from "@/schemas/group.schema";

export default function GroupsPage() {
  const navigate = useNavigate();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ScreenGroup | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<ScreenGroup | null>(null);

  const { data: groups, isLoading, isError, refetch } = useGroups();
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();
  const { selectedTenantId } = useTenantContext();

  const columns: ColumnDef<ScreenGroup, unknown>[] = [
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
      accessorKey: "orientation",
      header: "Orientación",
      cell: ({ row }) => {
        const value = row.original.orientation;
        return value ? (
          <span className="capitalize">{value}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      id: "resolution",
      header: "Resolución",
      cell: ({ row }) => {
        const { resolution_width, resolution_height } = row.original;
        return resolution_width && resolution_height ? (
          `${resolution_width}×${resolution_height}`
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      id: "actions",
      enableSorting: false,
      cell: ({ row }) => {
        const group = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Acciones</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditingGroup(group)}>
                <Pencil className="mr-2 h-4 w-4" />
                Editar
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setDeletingGroup(group)}
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

  function handleCreate(data: CreateGroupInput) {
    const payload: CreateGroupInput = selectedTenantId
      ? { ...data, tenant_id: selectedTenantId }
      : data;
    createGroup.mutate(payload, {
      onSuccess: () => setCreateDialogOpen(false),
    });
  }

  function handleUpdate(data: CreateGroupInput) {
    if (!editingGroup) return;
    updateGroup.mutate(
      { id: editingGroup.id, data },
      { onSuccess: () => setEditingGroup(null) }
    );
  }

  function handleDelete() {
    if (!deletingGroup) return;
    deleteGroup.mutate(deletingGroup.id, {
      onSuccess: () => setDeletingGroup(null),
    });
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Grupos</h1>
        <LoadingState />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Grupos</h1>
        <ErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Grupos</h1>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Crear grupo
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={groups ?? []}
        onRowClick={(group) => navigate(`/groups/${group.id}`)}
      />

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear grupo</DialogTitle>
            <DialogDescription>
              Configura los datos del nuevo grupo de pantallas.
            </DialogDescription>
          </DialogHeader>
          <GroupForm
            onSubmit={handleCreate}
            isSubmitting={createGroup.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={editingGroup !== null}
        onOpenChange={(open) => {
          if (!open) setEditingGroup(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar grupo</DialogTitle>
            <DialogDescription>
              Modifica los datos del grupo.
            </DialogDescription>
          </DialogHeader>
          {editingGroup && (
            <GroupForm
              key={editingGroup.id}
              defaultValues={{
                name: editingGroup.name,
                duration_seconds: editingGroup.duration_seconds ?? undefined,
                orientation: editingGroup.orientation ?? undefined,
                resolution_width: editingGroup.resolution_width ?? undefined,
                resolution_height: editingGroup.resolution_height ?? undefined,
              }}
              onSubmit={handleUpdate}
              isSubmitting={updateGroup.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        open={deletingGroup !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingGroup(null);
        }}
        title="Eliminar grupo"
        description={`¿Estás seguro de que deseas eliminar "${deletingGroup?.name}"? Esta acción no se puede deshacer.`}
        onConfirm={handleDelete}
      />
    </div>
  );
}
