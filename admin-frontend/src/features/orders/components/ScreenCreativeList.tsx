import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Layers,
  User,
  Radio,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { queryClient } from "@/lib/query-client";
import { creativesApi } from "../api";
import { useTargetCreatives } from "../hooks";
import { LibrarySelector } from "./LibrarySelector";
import { PlaybackModeOverrideSelector } from "./PlaybackModeOverrideSelector";
import { InlineWeightEditor } from "./InlineWeightEditor";
import { DragDropCreativeList } from "./DragDropCreativeList";
import { CreativeTrackingPixelsDialog } from "./CreativeTrackingPixelsDialog";
import { DurationWarningBadge } from "./DurationWarningBadge";
import { LoopPreviewModal } from "./LoopPreviewModal";
import type { ResolutionScreen, Creative, PlaybackMode } from "../types";

interface ScreenCreativeListProps {
  screens: ResolutionScreen[];
  orderLineId: string;
  resolutionWidth: number;
  resolutionHeight: number;
  playbackMode?: PlaybackMode;
  /** Slot duration in seconds for duration warning. Defaults to 10s. */
  slotDurationSeconds?: number;
}

export function ScreenCreativeList({
  screens,
  orderLineId,
  resolutionWidth,
  resolutionHeight,
  playbackMode = 'round_robin',
  slotDurationSeconds,
}: ScreenCreativeListProps) {
  return (
    <div className="divide-y">
      {screens.map((screen) => (
        <ScreenRow
          key={screen.id}
          screen={screen}
          orderLineId={orderLineId}
          resolutionWidth={resolutionWidth}
          resolutionHeight={resolutionHeight}
          playbackMode={playbackMode}
          slotDurationSeconds={slotDurationSeconds}
        />
      ))}
    </div>
  );
}

// ─── ScreenRow ─────────────────────────────────────────────────────────────────

interface ScreenRowProps {
  screen: ResolutionScreen;
  orderLineId: string;
  resolutionWidth: number;
  resolutionHeight: number;
  playbackMode: PlaybackMode;
  slotDurationSeconds?: number;
}

function ScreenRow({
  screen,
  orderLineId,
  resolutionWidth,
  resolutionHeight,
  playbackMode,
  slotDurationSeconds,
}: ScreenRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [showAddSelector, setShowAddSelector] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Creative | null>(null);

  const { data: creatives, isLoading } = useTargetCreatives(screen.target_id);

  // Mutation: Delete creative
  const deleteMutation = useMutation({
    mutationFn: (id: string) => creativesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["targets", screen.target_id, "creatives"] });
      queryClient.invalidateQueries({ queryKey: ["order-lines", orderLineId, "resolutions"] });
      toast.success("Creativo eliminado");
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? "Error al eliminar creativo");
    },
  });

  // Mutation: Create creative for this target
  const createMutation = useMutation({
    mutationFn: (contentId: string) =>
      creativesApi.createForTarget(screen.target_id, {
        content_id: contentId,
        weight: 100,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["targets", screen.target_id, "creatives"] });
      queryClient.invalidateQueries({ queryKey: ["order-lines", orderLineId, "resolutions"] });
      toast.success("Creativo asignado a la pantalla");
      setShowAddSelector(false);
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? "Error al asignar creativo");
    },
  });

  function handleDelete() {
    if (deleteTarget) {
      deleteMutation.mutate(deleteTarget.id);
      setDeleteTarget(null);
    }
  }

  function handleContentSelect(contentId: string) {
    createMutation.mutate(contentId);
  }

  const creativesCount = creatives?.length ?? 0;

  return (
    <div className="py-3 px-2">
      {/* Row header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors flex-1 min-w-0"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Colapsar" : "Expandir"} ${screen.name}`}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0" />
          )}
          <span className="truncate">{screen.name}</span>
        </button>

        {/* Thumbnails preview */}
        <div className="flex items-center gap-1 shrink-0">
          {isLoading ? (
            <Skeleton className="h-7 w-16 rounded" />
          ) : creativesCount > 0 ? (
            <div className="flex -space-x-1">
              {creatives!.slice(0, 3).map((c) => (
                <CreativeThumbnail key={c.id} creative={c} />
              ))}
              {creativesCount > 3 && (
                <div className="flex h-7 w-7 items-center justify-center rounded border bg-muted text-xs font-medium">
                  +{creativesCount - 3}
                </div>
              )}
            </div>
          ) : (
            <Badge variant="secondary" className="text-xs">
              Sin creativos
            </Badge>
          )}
        </div>

        {/* Add button */}
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-xs gap-1"
          onClick={() => {
            setExpanded(true);
            setShowAddSelector(true);
          }}
        >
          <Plus className="h-3 w-3" />
          Agregar a esta pantalla
        </Button>

        {/* Loop Preview button */}
        <LoopPreviewModal screenId={screen.id} screenName={screen.name} />
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-3 ml-6 space-y-3">
          {/* Per-screen playback mode override */}
          <PlaybackModeOverrideSelector
            targetId={screen.target_id}
            orderLineId={orderLineId}
            currentOverride={null}
            parentMode={playbackMode}
          />

          {/* Creatives list */}
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 rounded" />
              <Skeleton className="h-16 rounded" />
            </div>
          ) : creativesCount === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              No hay creativos asignados a esta pantalla.
            </p>
          ) : playbackMode === 'sequential' ? (
            <DragDropCreativeList
              creatives={creatives!}
              targetId={screen.target_id}
              orderLineId={orderLineId}
              onDelete={(creative) => setDeleteTarget(creative)}
            />
          ) : (
            <div className="space-y-2">
              {creatives!.map((creative, index) => (
                <CreativeRow
                  key={creative.id}
                  creative={creative}
                  onDelete={() => setDeleteTarget(creative)}
                  playbackMode={playbackMode}
                  position={index}
                  targetId={screen.target_id}
                  orderLineId={orderLineId}
                  slotDurationSeconds={slotDurationSeconds}
                />
              ))}
            </div>
          )}

          {/* Add creative selector */}
          {showAddSelector && (
            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Seleccionar de Biblioteca</h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAddSelector(false)}
                >
                  Cancelar
                </Button>
              </div>
              <LibrarySelector
                width={resolutionWidth}
                height={resolutionHeight}
                onSelect={handleContentSelect}
              />
            </div>
          )}
        </div>
      )}

      {/* Confirm delete dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Eliminar creativo"
        description={`¿Estás seguro de eliminar este creativo de la pantalla "${screen.name}"? Esta acción no se puede deshacer.`}
        onConfirm={handleDelete}
        confirmLabel="Eliminar"
        variant="destructive"
      />
    </div>
  );
}

// ─── CreativeRow ───────────────────────────────────────────────────────────────

interface CreativeRowProps {
  creative: Creative;
  onDelete: () => void;
  playbackMode?: PlaybackMode;
  position?: number;
  targetId: string;
  orderLineId: string;
  slotDurationSeconds?: number;
}

function CreativeRow({
  creative,
  onDelete,
  playbackMode = 'round_robin',
  position,
  targetId,
  orderLineId,
  slotDurationSeconds,
}: CreativeRowProps) {
  const [pixelDialogOpen, setPixelDialogOpen] = useState(false);

  // Determine if this creative was assigned via bulk (resolution) or individually.
  // Heuristic: if order_line_id is set (deprecated field present) it was likely bulk-assigned.
  const isBulkAssigned = !!creative.order_line_id;

  return (
    <div className="flex items-center gap-3 rounded-lg border p-2 group hover:bg-muted/20 transition-colors">
      <CreativeThumbnail creative={creative} size="md" />

      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-sm font-medium truncate">
          {creative.content?.filename ?? "Contenido"}
        </p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {playbackMode === 'sequential' ? (
            <span>Posición: {(creative.position ?? position ?? 0) + 1}</span>
          ) : (
            <InlineWeightEditor
              creativeId={creative.id}
              weight={creative.weight}
              targetId={targetId}
              orderLineId={orderLineId}
              playbackMode={playbackMode}
            />
          )}
        </div>
      </div>

      {/* Assignment type badge */}
      <Badge
        variant="outline"
        className="shrink-0 gap-1 text-xs"
        title={
          isBulkAssigned
            ? "Asignado por resolución (bulk)"
            : "Asignado individualmente"
        }
      >
        {isBulkAssigned ? (
          <>
            <Layers className="h-3 w-3" />
            Resolución
          </>
        ) : (
          <>
            <User className="h-3 w-3" />
            Individual
          </>
        )}
      </Badge>

      {/* Duration warning badge */}
      <DurationWarningBadge
        content={creative.content}
        slotDurationSeconds={slotDurationSeconds}
      />

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setPixelDialogOpen(true)}
          title="Tracking Pixels"
        >
          <Radio className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={onDelete}
          title="Eliminar creativo"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Tracking Pixels Dialog (Creative level) */}
      <CreativeTrackingPixelsDialog
        open={pixelDialogOpen}
        onOpenChange={setPixelDialogOpen}
        creativeId={creative.id}
        creativeName={creative.content?.filename}
      />
    </div>
  );
}

// ─── CreativeThumbnail ─────────────────────────────────────────────────────────

interface CreativeThumbnailProps {
  creative: Creative;
  size?: "sm" | "md";
}

function CreativeThumbnail({ creative, size = "sm" }: CreativeThumbnailProps) {
  const sizeClass = size === "md" ? "h-10 w-10" : "h-7 w-7";

  if (creative.content?.mime_type?.startsWith("image/")) {
    return (
      <img
        src={`/api/admin/content/${creative.content_id}/preview/file`}
        alt={creative.content?.filename ?? "Creativo"}
        className={`${sizeClass} rounded border object-cover`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} rounded border bg-muted flex items-center justify-center`}
    >
      <span className="text-[9px] text-muted-foreground font-medium">
        {creative.content?.mime_type?.startsWith("video/") ? "VID" : "?"}
      </span>
    </div>
  );
}
