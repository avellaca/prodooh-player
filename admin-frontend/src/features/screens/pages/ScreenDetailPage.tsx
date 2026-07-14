import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { differenceInMinutes, format } from "date-fns";
import { es } from "date-fns/locale";
import { Pencil, RefreshCw, Loader2, Trash2 } from "lucide-react";

import { useScreen, useScreenshots, useUpdateScreen, useRegenerateToken, useDeleteScreen } from "../hooks";
import { updateScreenSchema, type UpdateScreenInput } from "@/schemas/screen.schema";
import { ScreenshotGallery } from "../components/ScreenshotGallery";
import { ScheduleEditor } from "../components/ScheduleEditor";

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
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold">{screen.name}</h1>
            <p className="text-sm text-muted-foreground">
              {screen.venue_id}
            </p>
          </div>
          <Badge variant={screen.enabled !== false ? 'success' : 'secondary'}>
            {screen.enabled !== false ? 'Activa' : 'Desactivada'}
          </Badge>
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
          <CardTitle className="text-lg">Información básica</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Estado</dt>
              <dd className="flex items-center gap-2">
                <Badge variant={isOnline ? "success" : "destructive"}>
                  {isOnline ? "Online" : "Offline"}
                </Badge>
                {screen.last_heartbeat && (
                  <span className="text-xs text-muted-foreground">
                    Último heartbeat:{" "}
                    {format(new Date(screen.last_heartbeat), "dd/MM/yyyy HH:mm:ss", {
                      locale: es,
                    })}
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Schedule Editor */}
      <ScheduleEditor
        screenId={id!}
        schedule={screen.schedule}
        groupName={screen.screen_group?.name}
      />

      {/* Screenshots Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Screenshots</CardTitle>
        </CardHeader>
        <CardContent>
          <ScreenshotGallery screenshots={screenshots ?? []} />
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
      />
    </div>
  );
}

interface EditScreenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  screen: {
    name: string;
    orientation: "landscape" | "portrait";
    resolution_width: number;
    resolution_height: number;
  };
  onSubmit: (data: UpdateScreenInput) => void;
  isPending: boolean;
}

function EditScreenDialog({
  open,
  onOpenChange,
  screen,
  onSubmit,
  isPending,
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
      orientation: screen.orientation,
      resolution_width: screen.resolution_width,
      resolution_height: screen.resolution_height,
    },
  });

  const orientation = watch("orientation");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar pantalla</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
