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
import { useAuth } from "@/hooks/use-auth";
import type { ScreenGroup } from "@/types/models";
import type { CreateGroupInput } from "@/schemas/group.schema";

export default function GroupsPage() {
  const navigate = useNavigate();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ScreenGroup | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<ScreenGroup | null>(null);

  const { user } = useAuth();
  const { selectedTenantId } = useTenantContext();
  const isSuperAdmin = user?.role === 'super_admin';
  const needsTenant = isSuperAdmin && !selectedTenantId;

  const { data: groups, isLoading, isError, refetch } = useGroups();
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();

  const columns: ColumnDef<ScreenGroup, unknown>[] = [
    {
      accessorKey: "name",
      header: "Nombre",
      sortingFn: (rowA, rowB) => {
        const a = rowA.getValue<string>('name');
        const b = rowB.getValue<string>('name');
        return a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
      },
    },
    {
      accessorKey: "screens_count",
      header: "Pantallas",
      cell: ({ row }) => row.original.screens_count ?? row.original.screens?.length ?? 0,
    },
    {
      id: "composition",
      header: "Composición",
      enableSorting: false,
      cell: ({ row }) => {
        const screens = row.original.screens ?? [];
        if (screens.length === 0) return <span className="text-muted-foreground">—</span>;

        // Count by orientation
        const orientations: Record<string, number> = {};
        // Count by resolution (sorted desc by count)
        const resolutions: Record<string, number> = {};

        for (const s of screens) {
          const orient = s.orientation ?? 'unknown';
          orientations[orient] = (orientations[orient] ?? 0) + 1;

          const res = `${s.resolution_width}×${s.resolution_height}`;
          resolutions[res] = (resolutions[res] ?? 0) + 1;
        }

        const orientEntries = Object.entries(orientations).sort((a, b) => b[1] - a[1]);
        const resEntries = Object.entries(resolutions).sort((a, b) => b[1] - a[1]);

        return (
          <div className="space-y-1">
            <div className="flex flex-wrap gap-1">
              {orientEntries.map(([orient, count]) => (
                <span key={orient} className="inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
                  {orient === 'portrait' ? 'Portrait' : orient === 'landscape' ? 'Landscape' : orient} ×{count}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {resEntries.map(([res, count]) => (
                <span key={res} className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                  {res} ({count})
                </span>
              ))}
            </div>
          </div>
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
                onClick={(e) => {
                  e.stopPropagation();
                  setDeletingGroup(group);
                }}
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
        <Button onClick={() => setCreateDialogOpen(true)} disabled={needsTenant} title={needsTenant ? "Selecciona un Network para crear grupos" : undefined}>
          <Plus className="mr-2 h-4 w-4" />
          Crear grupo
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={groups ?? []}
        onRowClick={(group) => navigate(`/groups/${group.id}`)}
        initialSorting={[{ id: 'name', desc: false }]}
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
