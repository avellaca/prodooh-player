import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Pencil, Trash2, Plus, Monitor, X } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  useGroup,
  useUpdateGroup,
  useDeleteGroup,
  useAssignScreens,
} from "../hooks";
import { GroupForm } from "../components/GroupForm";
import { AssignScreensDialog } from "../components/AssignScreensDialog";
import { GroupScheduleEditor } from "../components/GroupScheduleEditor";
import { settingsApi } from "@/features/settings/api";
import { useAuth } from "@/hooks/use-auth";
import { useTenantContext } from "@/contexts/TenantContext";
import { api } from "@/lib/axios";
import { queryClient } from "@/lib/query-client";

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

  const { user } = useAuth();
  const { selectedTenantId } = useTenantContext();
  const tenantId = user?.role === 'super_admin' ? selectedTenantId : user?.tenant_id;
  const { data: loopConfig } = useQuery({
    queryKey: ['loop-config', tenantId],
    queryFn: () => settingsApi.getLoopConfig(tenantId!),
    enabled: !!tenantId,
  });

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);

  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();
  const assignScreens = useAssignScreens();

  // Unassign a screen from the group (set group_id to null)
  const unassignScreen = useMutation({
    mutationFn: (screenId: string) =>
      api.put(`/admin/screens/${screenId}`, { group_id: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups', id] });
      queryClient.invalidateQueries({ queryKey: ['screens'] });
      toast.success('Pantalla removida del grupo');
    },
    onError: () => {
      toast.error('Error al remover la pantalla del grupo');
    },
  });

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
                Duración del spot
              </dt>
              <dd className="text-sm">
                {group.duration_seconds
                  ? <>{group.duration_seconds}s <span className="text-xs text-muted-foreground">(Grupo)</span></>
                  : <span className="text-muted-foreground">{loopConfig?.num_slots ? '10' : '10'}s <span className="text-xs">(Network)</span></span>}
              </dd>
            </div>
          </dl>

          {/* Loop / Inventario info */}
          {(() => {
            const numSlots = group.num_slots ?? loopConfig?.num_slots ?? 10;
            const sspSlots = group.ssp_slots ?? loopConfig?.ssp_slots ?? 0;
            const playlistSlots = group.playlist_slots ?? loopConfig?.playlist_slots ?? 0;
            const adSlots = numSlots - sspSlots - playlistSlots;
            const slotDuration = group.duration_seconds ?? 10;

            const schedule = group.schedule ?? null;
            let operatingHours = 24;
            let operatingSeconds = 86400;
            if (schedule && schedule.length > 0) {
              operatingSeconds = schedule.reduce((total: number, rule: { start?: string; end?: string }) => {
                const [sh, sm] = (rule.start ?? '00:00').split(':').map(Number);
                const [eh, em] = (rule.end ?? '24:00').split(':').map(Number);
                return total + ((eh * 60 + em) - (sh * 60 + sm)) * 60;
              }, 0);
              operatingHours = operatingSeconds / 3600;
            }

            const loopsPerDay = Math.floor(operatingSeconds / (numSlots * slotDuration));
            const spotsPerDay = loopsPerDay * (adSlots > 0 ? adSlots : 0);

            const numSlotsSource = group.num_slots ? 'Grupo' : 'Network';

            return (
              <div className="mt-4 pt-4 border-t">
                <h4 className="text-sm font-semibold text-muted-foreground mb-3">Inventario</h4>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">Horario operativo</dt>
                    <dd className="text-sm">{operatingHours === 24 ? '24 hrs' : `${operatingHours.toFixed(1)} hrs`}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">Slots de loop</dt>
                    <dd className="text-sm">{numSlots} <span className="text-xs text-muted-foreground">({numSlotsSource})</span></dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">Loops/día</dt>
                    <dd className="text-sm">{loopsPerDay.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">Spots/día (ad)</dt>
                    <dd className="text-sm font-semibold">{spotsPerDay.toLocaleString()}</dd>
                  </div>
                </dl>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Group Schedule Editor */}
      <GroupScheduleEditor
        groupId={id!}
        schedule={group.schedule}
        screens={group.screens ?? []}
      />

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
              {[...group.screens].sort((a, b) =>
                a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' })
              ).map((screen) => (
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
                  <button
                    type="button"
                    onClick={() => unassignScreen.mutate(screen.id)}
                    className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Remover del grupo"
                  >
                    <X className="h-4 w-4" />
                  </button>
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
              num_slots: group.num_slots ?? undefined,
              ssp_slots: group.ssp_slots ?? undefined,
              playlist_slots: group.playlist_slots ?? undefined,
            }}
            onSubmit={handleUpdate}
            isSubmitting={updateGroup.isPending}
            inheritedValues={{
              num_slots: loopConfig?.num_slots ?? 10,
              ssp_slots: loopConfig?.ssp_slots ?? 0,
              playlist_slots: loopConfig?.playlist_slots ?? 0,
              duration_seconds: 10, // tenant default
            }}
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
        key={currentScreenIds.join(',')}
        open={showAssignDialog}
        onOpenChange={setShowAssignDialog}
        onSubmit={handleAssignScreens}
        isSubmitting={assignScreens.isPending}
        currentScreenIds={currentScreenIds}
      />
    </div>
  );
}
