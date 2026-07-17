import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { differenceInMinutes, format } from "date-fns";
import { es } from "date-fns/locale";
import { Pencil, RefreshCw, Loader2, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { useScreen, useScreenshots, useUpdateScreen, useRegenerateToken, useDeleteScreen } from "../hooks";
import { updateScreenSchema, type UpdateScreenInput } from "@/schemas/screen.schema";
import { ScreenshotGallery } from "../components/ScreenshotGallery";
import { ScheduleEditor } from "../components/ScheduleEditor";
import { WitnessControls } from "../components/WitnessControls";
import { settingsApi } from "@/features/settings/api";
import { useAuth } from "@/hooks/use-auth";
import { useTenantContext } from "@/contexts/TenantContext";

import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { TokenRevealDialog } from "@/components/shared/TokenRevealDialog";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function ScreenDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: screen, isLoading, isError, refetch } = useScreen(id);
  const { data: screenshots } = useScreenshots(id);

  const { user } = useAuth();
  const { selectedTenantId } = useTenantContext();
  const tenantId = user?.role === 'super_admin' ? selectedTenantId : user?.tenant_id;
  const { data: loopConfig } = useQuery({
    queryKey: ['loop-config', tenantId],
    queryFn: () => settingsApi.getLoopConfig(tenantId!),
    enabled: !!tenantId,
  });

  const [showConfirmRegenerate, setShowConfirmRegenerate] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [showTokenReveal, setShowTokenReveal] = useState(false);
  const [newToken, setNewToken] = useState("");
  const [showEditDialog, setShowEditDialog] = useState(false);

  const regenerateToken = useRegenerateToken();
  const updateScreen = useUpdateScreen();
  const deleteScreen = useDeleteScreen();

  if (isLoading) {
    return <LoadingState rows={6} />;
  }

  if (isError || !screen) {
    return <ErrorState message="Error al cargar la pantalla" onRetry={refetch} />;
  }

  const isOnline = screen.last_heartbeat
    ? differenceInMinutes(new Date(), new Date(screen.last_heartbeat)) <= 2
    : false;

  function handleRegenerateConfirm() {
    regenerateToken.mutate(id!, {
      onSuccess: (data) => {
        setNewToken(data.device_token);
        setShowTokenReveal(true);
      },
    });
  }

  function handleDeleteConfirm() {
    deleteScreen.mutate(id!, {
      onSuccess: () => navigate('/screens'),
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{screen.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={screen.enabled !== false ? 'success' : 'secondary'}>
              {screen.enabled !== false ? 'Activa' : 'Desactivada'}
            </Badge>
            <span className="relative group">
              <Badge
                variant={isOnline ? "success" : "destructive"}
                className="cursor-default"
              >
                {isOnline ? "En línea" : "Fuera de línea"}
              </Badge>
              {screen.last_heartbeat && (
                <span className="absolute left-0 top-full mt-1 hidden group-hover:block bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-50">
                  Último heartbeat: {format(new Date(screen.last_heartbeat), "dd/MM/yyyy HH:mm:ss", { locale: es })}
                </span>
              )}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              updateScreen.mutate({ id: id!, data: { enabled: !screen.enabled } as never });
            }}
          >
            {screen.enabled !== false ? 'Desactivar' : 'Activar'}
          </Button>
          <Button variant="outline" onClick={() => setShowEditDialog(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Editar
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowConfirmRegenerate(true)}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Regenerar token
          </Button>
          <Button
            variant="destructive"
            onClick={() => setShowConfirmDelete(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Eliminar
          </Button>
        </div>
      </div>

      <Separator />

      {/* Basic Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Información de la pantalla</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Network</dt>
              <dd className="text-sm">{screen.tenant?.name ?? screen.tenant_id}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Grupo</dt>
              <dd className="text-sm">
                {screen.screen_group?.name ?? screen.group_id ?? "Sin grupo"}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Venue ID</dt>
              <dd className="text-sm">{screen.venue_id}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Orientación</dt>
              <dd className="text-sm capitalize">{screen.orientation}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Resolución</dt>
              <dd className="text-sm">
                {screen.resolution_width} × {screen.resolution_height}
              </dd>
            </div>
          </dl>

          {/* Loop / Inventario info */}
          {(() => {
            const numSlots = screen.num_slots ?? screen.screen_group?.num_slots ?? loopConfig?.num_slots ?? 10;
            const sspSlots = screen.ssp_slots ?? screen.screen_group?.ssp_slots ?? loopConfig?.ssp_slots ?? 0;
            const playlistSlots = screen.playlist_slots ?? screen.screen_group?.playlist_slots ?? loopConfig?.playlist_slots ?? 0;
            const adSlots = numSlots - sspSlots - playlistSlots;
            const slotDuration = screen.screen_group?.duration_seconds ?? 10;

            // Resolve operating window from schedule
            const schedule = screen.schedule ?? screen.screen_group?.schedule ?? null;
            let operatingHours = 24;
            let operatingSeconds = 86400;
            if (schedule && schedule.length > 0) {
              operatingSeconds = schedule.reduce((total, rule) => {
                const [sh, sm] = (rule.start ?? '00:00').split(':').map(Number);
                const [eh, em] = (rule.end ?? '24:00').split(':').map(Number);
                return total + ((eh * 60 + em) - (sh * 60 + sm)) * 60;
              }, 0);
              operatingHours = operatingSeconds / 3600;
            }

            const loopsPerDay = Math.floor(operatingSeconds / (numSlots * slotDuration));
            const spotsPerDay = loopsPerDay * (adSlots > 0 ? adSlots : 0);

            const numSlotsSource = screen.num_slots
              ? 'Pantalla'
              : screen.screen_group?.num_slots
                ? 'Grupo'
                : 'Network';

            const durationSource = screen.screen_group?.duration_seconds ? 'Grupo' : 'Network';

            return (
              <div className="mt-4 pt-4 border-t">
                <h4 className="text-sm font-semibold text-muted-foreground mb-3">Inventario</h4>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">Horario operativo</dt>
                    <dd className="text-sm">{operatingHours === 24 ? '24 hrs' : `${operatingHours.toFixed(1)} hrs`}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">Duración del spot</dt>
                    <dd className="text-sm">{slotDuration}s <span className="text-xs text-muted-foreground">({durationSource})</span></dd>
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
                    <dt className="text-sm font-medium text-muted-foreground">Spots/día</dt>
                    <dd className="text-sm font-semibold">{spotsPerDay.toLocaleString()}</dd>
                  </div>
                </dl>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Schedule Editor */}
      <ScheduleEditor
        screenId={id!}
        schedule={screen.schedule}
        groupName={screen.screen_group?.name}
      />

      {/* Testigos Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Testigos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Controls */}
          <div className="flex flex-wrap gap-3">
            <WitnessControls screenId={id!} numSlots={screen.num_slots ?? screen.screen_group?.num_slots ?? loopConfig?.num_slots ?? 10} slotDuration={screen.screen_group?.duration_seconds ?? 10} />
          </div>

          {/* Screenshots Gallery */}
          <div className="pt-3 border-t">
            <h4 className="text-sm font-medium text-muted-foreground mb-3">Capturas</h4>
            <ScreenshotGallery screenshots={screenshots ?? []} screenId={id} orientation={screen.orientation} />
          </div>
        </CardContent>
      </Card>

      {/* Playlists Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Playlists asignadas</CardTitle>
        </CardHeader>
        <CardContent>
          {screen.playlists && screen.playlists.length > 0 ? (
            <div className="space-y-2">
              {screen.playlists.map((playlist) => (
                <div
                  key={playlist.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <span className="text-sm font-medium">{playlist.name}</span>
                  <span className="text-xs text-muted-foreground">
                    v{playlist.version}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No hay playlists asignadas
            </p>
          )}
        </CardContent>
      </Card>

      {/* Confirm Regenerate Token Dialog */}
      <ConfirmDialog
        open={showConfirmRegenerate}
        onOpenChange={setShowConfirmRegenerate}
        title="Regenerar token"
        description="¿Estás seguro? El token actual dejará de funcionar inmediatamente y el dispositivo perderá la conexión hasta que se configure el nuevo token."
        onConfirm={handleRegenerateConfirm}
        confirmLabel="Regenerar"
        variant="destructive"
      />

      {/* Confirm Delete Screen Dialog */}
      <ConfirmDialog
        open={showConfirmDelete}
        onOpenChange={setShowConfirmDelete}
        title="Eliminar pantalla"
        description="¿Estás seguro? Esta acción no se puede deshacer. Se eliminará la pantalla y toda su configuración."
        onConfirm={handleDeleteConfirm}
        confirmLabel="Eliminar"
        variant="destructive"
      />

      {/* Token Reveal Dialog */}
      <TokenRevealDialog
        open={showTokenReveal}
        onOpenChange={setShowTokenReveal}
        token={newToken}
        title="Nuevo token de dispositivo"
      />

      {/* Edit Screen Dialog */}
      <EditScreenDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        screen={screen}
        onSubmit={(data) => {
          updateScreen.mutate(
            { id: id!, data },
            { onSuccess: () => setShowEditDialog(false) }
          );
        }}
        isPending={updateScreen.isPending}
        inheritedValues={{
          num_slots: screen.screen_group?.num_slots ?? loopConfig?.num_slots ?? 10,
          ssp_slots: screen.screen_group?.ssp_slots ?? loopConfig?.ssp_slots ?? 0,
          playlist_slots: screen.screen_group?.playlist_slots ?? loopConfig?.playlist_slots ?? 0,
          duration_seconds: screen.screen_group?.duration_seconds ?? 10,
          num_slots_source: screen.screen_group?.num_slots ? 'Grupo' : 'Network',
          duration_source: screen.screen_group?.duration_seconds ? 'Grupo' : 'Network',
        }}
      />
    </div>
  );
}

interface EditScreenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  screen: {
    name: string;
    venue_id: string;
    orientation: "landscape" | "portrait";
    resolution_width: number;
    resolution_height: number;
    num_slots?: number | null;
    ssp_slots?: number | null;
    playlist_slots?: number | null;
    screen_group?: { num_slots?: number | null; ssp_slots?: number | null; playlist_slots?: number | null; duration_seconds?: number | null } | null;
  };
  onSubmit: (data: UpdateScreenInput) => void;
  isPending: boolean;
  inheritedValues?: {
    num_slots: number;
    ssp_slots: number;
    playlist_slots: number;
    duration_seconds: number;
    num_slots_source: string;
    duration_source: string;
  };
}

function EditScreenDialog({
  open,
  onOpenChange,
  screen,
  onSubmit,
  isPending,
  inheritedValues,
}: EditScreenDialogProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<UpdateScreenInput>({
    resolver: zodResolver(updateScreenSchema),
    values: {
      name: screen.name,
      venue_id: screen.venue_id,
      orientation: screen.orientation,
      resolution_width: screen.resolution_width,
      resolution_height: screen.resolution_height,
      num_slots: (screen as any).num_slots ?? null,
      ssp_slots: (screen as any).ssp_slots ?? null,
      playlist_slots: (screen as any).playlist_slots ?? null,
      duration_seconds: null,
    },
  });

  const orientation = watch("orientation");
  const currentNumSlots = watch("num_slots");
  const currentDuration = watch("duration_seconds");
  const currentSspSlots = watch("ssp_slots");
  const currentPlaylistSlots = watch("playlist_slots");

  // A field is an override only if it has a real positive numeric value
  const numSlotsIsOverride = currentNumSlots !== null && currentNumSlots !== undefined && currentNumSlots !== '' && Number(currentNumSlots) > 0;
  const durationIsOverride = currentDuration !== null && currentDuration !== undefined && currentDuration !== '' && Number(currentDuration) > 0;
  const sspSlotsIsOverride = currentSspSlots !== null && currentSspSlots !== undefined && currentSspSlots !== '' && Number(currentSspSlots) >= 0 && String(currentSspSlots) !== '';
  const playlistSlotsIsOverride = currentPlaylistSlots !== null && currentPlaylistSlots !== undefined && currentPlaylistSlots !== '' && Number(currentPlaylistSlots) >= 0 && String(currentPlaylistSlots) !== '';

  function handleFormSubmit(data: UpdateScreenInput) {
    // Explicitly send null for fields that should inherit (cleared overrides)
    const numSlots = data.num_slots && Number(data.num_slots) > 0 ? Number(data.num_slots) : null;
    const sspSlots = data.ssp_slots != null && data.ssp_slots !== undefined && String(data.ssp_slots) !== '' ? Number(data.ssp_slots) : null;
    const playlistSlots = data.playlist_slots != null && data.playlist_slots !== undefined && String(data.playlist_slots) !== '' ? Number(data.playlist_slots) : null;
    const duration = data.duration_seconds && Number(data.duration_seconds) > 0 ? Number(data.duration_seconds) : null;
    const cleaned: Record<string, unknown> = {
      ...data,
      num_slots: numSlots,
      ssp_slots: sspSlots,
      playlist_slots: playlistSlots,
      duration_seconds: duration,
    };
    onSubmit(cleaned as UpdateScreenInput);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Editar pantalla</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Nombre</Label>
            <Input
              id="edit-name"
              {...register("name")}
              className={errors.name ? "border-red-500" : ""}
            />
            {errors.name && (
              <p className="text-sm text-red-500">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-venue_id">Venue ID</Label>
            <Input
              id="edit-venue_id"
              {...register("venue_id")}
              className={errors.venue_id ? "border-red-500" : ""}
            />
            {errors.venue_id && (
              <p className="text-sm text-red-500">{errors.venue_id.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Orientación</Label>
            <Select
              value={orientation}
              onValueChange={(value) =>
                setValue("orientation", value as "landscape" | "portrait")
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="landscape">Landscape</SelectItem>
                <SelectItem value="portrait">Portrait</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-width">Ancho (px)</Label>
              <Input
                id="edit-width"
                type="number"
                {...register("resolution_width")}
                className={errors.resolution_width ? "border-red-500" : ""}
              />
              {errors.resolution_width && (
                <p className="text-sm text-red-500">
                  {errors.resolution_width.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-height">Alto (px)</Label>
              <Input
                id="edit-height"
                type="number"
                {...register("resolution_height")}
                className={errors.resolution_height ? "border-red-500" : ""}
              />
              {errors.resolution_height && (
                <p className="text-sm text-red-500">
                  {errors.resolution_height.message}
                </p>
              )}
            </div>
          </div>

          {/* Num slots with inheritance */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-num_slots">Número de slots</Label>
              {inheritedValues && !numSlotsIsOverride && (
                <span className="text-xs text-muted-foreground">
                  Heredado: {inheritedValues.num_slots} ({inheritedValues.num_slots_source})
                </span>
              )}
              {numSlotsIsOverride && inheritedValues && (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setValue("num_slots", null as any)}
                >
                  Usar heredado ({inheritedValues.num_slots})
                </button>
              )}
            </div>
            <Input
              id="edit-num_slots"
              type="number"
              min={1}
              max={100}
              placeholder={inheritedValues ? `${inheritedValues.num_slots} (heredado)` : "10"}
              {...register("num_slots")}
            />
            {numSlotsIsOverride && inheritedValues && currentNumSlots !== inheritedValues.num_slots && (
              <p className="text-xs text-amber-600">
                Override: esta pantalla usará {currentNumSlots} slots en vez de {inheritedValues.num_slots} del {inheritedValues.num_slots_source}.
              </p>
            )}
          </div>

          {/* SSP slots with inheritance */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-ssp_slots">Slots SSP</Label>
              {inheritedValues && !sspSlotsIsOverride && (
                <span className="text-xs text-muted-foreground">
                  Heredado: {inheritedValues.ssp_slots}
                </span>
              )}
              {sspSlotsIsOverride && inheritedValues && (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setValue("ssp_slots", null as any)}
                >
                  Usar heredado ({inheritedValues.ssp_slots})
                </button>
              )}
            </div>
            <Input
              id="edit-ssp_slots"
              type="number"
              min={0}
              placeholder={inheritedValues ? `${inheritedValues.ssp_slots} (heredado)` : "0"}
              {...register("ssp_slots")}
            />
          </div>

          {/* Playlist slots with inheritance */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-playlist_slots">Slots Playlist</Label>
              {inheritedValues && !playlistSlotsIsOverride && (
                <span className="text-xs text-muted-foreground">
                  Heredado: {inheritedValues.playlist_slots}
                </span>
              )}
              {playlistSlotsIsOverride && inheritedValues && (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setValue("playlist_slots", null as any)}
                >
                  Usar heredado ({inheritedValues.playlist_slots})
                </button>
              )}
            </div>
            <Input
              id="edit-playlist_slots"
              type="number"
              min={0}
              placeholder={inheritedValues ? `${inheritedValues.playlist_slots} (heredado)` : "0"}
              {...register("playlist_slots")}
            />
          </div>

          {/* Duration with inheritance */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-duration">Duración del spot (s)</Label>
              {inheritedValues && !durationIsOverride && (
                <span className="text-xs text-muted-foreground">
                  Heredado: {inheritedValues.duration_seconds}s ({inheritedValues.duration_source})
                </span>
              )}
              {durationIsOverride && inheritedValues && (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setValue("duration_seconds", null as any)}
                >
                  Usar heredado ({inheritedValues.duration_seconds}s)
                </button>
              )}
            </div>
            <Input
              id="edit-duration"
              type="number"
              min={1}
              placeholder={inheritedValues ? `${inheritedValues.duration_seconds} (heredado)` : "10"}
              {...register("duration_seconds")}
            />
            {durationIsOverride && inheritedValues && currentDuration !== inheritedValues.duration_seconds && (
              <p className="text-xs text-amber-600">
                Override: esta pantalla usará {currentDuration}s en vez de {inheritedValues.duration_seconds}s del {inheritedValues.duration_source}.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
