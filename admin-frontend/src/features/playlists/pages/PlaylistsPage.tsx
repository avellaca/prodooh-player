import { useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { MoreHorizontal, Plus, Pencil, Trash2, Monitor } from "lucide-react";

import { DataTable } from "@/components/shared/DataTable";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { PlaylistForm } from "../components/PlaylistForm";
import { AssignScreensDialog } from "../components/AssignScreensDialog";
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
  usePlaylists,
  usePlaylist,
  useCreatePlaylist,
  useUpdatePlaylist,
  useDeletePlaylist,
  useAssignPlaylist,
} from "../hooks";
import { useTenantContext } from "@/contexts/TenantContext";
import type { Playlist } from "@/types/models";
import type { CreatePlaylistInput } from "@/schemas/playlist.schema";

export default function PlaylistsPage() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);
  const [deletingPlaylist, setDeletingPlaylist] = useState<Playlist | null>(null);
  const [assigningPlaylist, setAssigningPlaylist] = useState<Playlist | null>(null);

  const { data: playlists, isLoading, isError, refetch } = usePlaylists();
  const createPlaylist = useCreatePlaylist();
  const updatePlaylist = useUpdatePlaylist();
  const deletePlaylist = useDeletePlaylist();
  const assignPlaylist = useAssignPlaylist();
  const { selectedTenantId } = useTenantContext();

  // Fetch detail for editing (to get items)
  const { data: editingPlaylistDetail } = usePlaylist(editingPlaylist?.id);

  const columns: ColumnDef<Playlist, unknown>[] = [
    {
      accessorKey: "name",
      header: "Nombre",
    },
    {
      accessorKey: "items_count",
      header: "Ítems",
      cell: ({ row }) => row.original.items_count ?? row.original.playlist_items?.length ?? 0,
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
        const playlist = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Acciones</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditingPlaylist(playlist)}>
                <Pencil className="mr-2 h-4 w-4" />
                Editar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAssigningPlaylist(playlist)}>
                <Monitor className="mr-2 h-4 w-4" />
                Asignar a pantallas
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setDeletingPlaylist(playlist)}
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

  function handleCreate(data: CreatePlaylistInput) {
    const payload: CreatePlaylistInput = selectedTenantId
      ? { ...data, tenant_id: selectedTenantId }
      : data;
    createPlaylist.mutate(payload, {
      onSuccess: () => setCreateDialogOpen(false),
    });
  }

  function handleUpdate(data: CreatePlaylistInput) {
    if (!editingPlaylist) return;
    updatePlaylist.mutate(
      { id: editingPlaylist.id, data },
      { onSuccess: () => setEditingPlaylist(null) },
    );
  }

  function handleDelete() {
    if (!deletingPlaylist) return;
    deletePlaylist.mutate(deletingPlaylist.id, {
      onSuccess: () => setDeletingPlaylist(null),
    });
  }

  function handleAssign(screenIds: string[]) {
    if (!assigningPlaylist) return;
    assignPlaylist.mutate(
      { id: assigningPlaylist.id, data: { screen_ids: screenIds } },
      { onSuccess: () => setAssigningPlaylist(null) },
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Playlists</h1>
        <LoadingState />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Playlists</h1>
        <ErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  // Map playlist items for the edit form
  const editDefaultValues = editingPlaylistDetail
    ? {
        name: editingPlaylistDetail.name,
        items: (editingPlaylistDetail.playlist_items ?? []).map((item) => ({
          type: (item.type === 'image' || item.type === 'video' ? 'content' : item.type) as 'content' | 'url',
          content_id: item.content_id ?? undefined,
          url: item.url ?? undefined,
          duration_seconds: item.duration_seconds,
          position: item.position,
        })),
      }
    : undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Playlists</h1>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Crear playlist
        </Button>
      </div>

      <DataTable columns={columns} data={playlists ?? []} />

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Crear playlist</DialogTitle>
            <DialogDescription>
              Ingresa el nombre y agrega ítems a la nueva playlist.
            </DialogDescription>
          </DialogHeader>
          <PlaylistForm
            onSubmit={handleCreate}
            isSubmitting={createPlaylist.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={editingPlaylist !== null}
        onOpenChange={(open) => { if (!open) setEditingPlaylist(null); }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar playlist</DialogTitle>
            <DialogDescription>
              Modifica el nombre y los ítems de la playlist.
            </DialogDescription>
          </DialogHeader>
          {editingPlaylist && editDefaultValues && (
            <PlaylistForm
              key={editingPlaylist.id}
              defaultValues={editDefaultValues}
              onSubmit={handleUpdate}
              isSubmitting={updatePlaylist.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        open={deletingPlaylist !== null}
        onOpenChange={(open) => { if (!open) setDeletingPlaylist(null); }}
        title="Eliminar playlist"
        description={`¿Estás seguro de que deseas eliminar "${deletingPlaylist?.name}"? Esta acción no se puede deshacer.`}
        onConfirm={handleDelete}
      />

      {/* Assign Screens Dialog */}
      <AssignScreensDialog
        open={assigningPlaylist !== null}
        onOpenChange={(open) => { if (!open) setAssigningPlaylist(null); }}
        onSubmit={handleAssign}
        isSubmitting={assignPlaylist.isPending}
      />
    </div>
  );
}
