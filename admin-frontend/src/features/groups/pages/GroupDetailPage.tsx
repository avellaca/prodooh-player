import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Pencil, Trash2, Plus, Monitor } from "lucide-react";

import {
  useGroup,
  useUpdateGroup,
  useDeleteGroup,
  useAssignScreens,
} from "../hooks";
import { GroupForm } from "../components/GroupForm";
import { AssignScreensDialog } from "../components/AssignScreensDialog";

import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { CreateGroupInput } from "@/schemas/group.schema";

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: group, isLoading, isError, refetch } = useGroup(id);

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);

  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();
  const assignScreens = useAssignScreens();

  if (isLoading) {
    return <LoadingState rows={6} />;
  }

  if (isError || !group) {
    return <ErrorState message="Error al cargar el grupo" onRetry={refetch} />;
  }

  function handleUpdate(data: CreateGroupInput) {
    updateGroup.mutate(
      { id: id!, data },
      { onSuccess: () => setShowEditDialog(false) }
    );
  }

  function handleDelete() {
    deleteGroup.mutate(id!, {
      onSuccess: () => navigate("/groups"),
    });
  }

  function handleAssignScreens(screenIds: string[]) {
    assignScreens.mutate(
      { id: id!, data: { screen_ids: screenIds } },
      { onSuccess: () => setShowAssignDialog(false) }
    );
  }

  const currentScreenIds = group.screens?.map((s) => s.id) ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{group.name}</h1>
          <p className="text-sm text-muted-foreground">ID: {group.id}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowAssignDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Asignar pantallas
          </Button>
          <Button variant="outline" onClick={() => setShowEditDialog(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Editar
          </Button>
          <Button
            variant="destructive"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Eliminar
          </Button>
        </div>
      </div>

      <Separator />

      {/* Group Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Información del grupo</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">
                Nombre
              </dt>
              <dd className="text-sm">{group.name}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">
                Duración por defecto
              </dt>
              <dd className="text-sm">
                {group.duration_seconds
                  ? `${group.duration_seconds}s`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">
                Orientación
              </dt>
              <dd className="text-sm capitalize">
                {group.orientation ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">
                Resolución
              </dt>
              <dd className="text-sm">
                {group.resolution_width && group.resolution_height
                  ? `${group.resolution_width}×${group.resolution_height}`
                  : "—"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Screens Assigned */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Pantallas asignadas ({group.screens?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {group.screens && group.screens.length > 0 ? (
            <div className="space-y-2">
              {group.screens.map((screen) => (
                <div
                  key={screen.id}
                  className="flex items-center gap-3 rounded-md border p-3"
                >
                  <Monitor className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <span className="text-sm font-medium">{screen.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {screen.orientation} · {screen.resolution_width}×
                      {screen.resolution_height}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No hay pantallas asignadas a este grupo.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar grupo</DialogTitle>
            <DialogDescription>
              Modifica los datos del grupo.
            </DialogDescription>
          </DialogHeader>
          <GroupForm
            key={group.id}
            defaultValues={{
              name: group.name,
              duration_seconds: group.duration_seconds ?? undefined,
              orientation: group.orientation ?? undefined,
              resolution_width: group.resolution_width ?? undefined,
              resolution_height: group.resolution_height ?? undefined,
            }}
            onSubmit={handleUpdate}
            isSubmitting={updateGroup.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Eliminar grupo"
        description={`¿Estás seguro de que deseas eliminar "${group.name}"? Esta acción no se puede deshacer.`}
        onConfirm={handleDelete}
      />

      {/* Assign Screens Dialog */}
      <AssignScreensDialog
        open={showAssignDialog}
        onOpenChange={setShowAssignDialog}
        onSubmit={handleAssignScreens}
        isSubmitting={assignScreens.isPending}
        currentScreenIds={currentScreenIds}
      />
    </div>
  );
}
