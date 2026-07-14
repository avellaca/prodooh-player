import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Pencil,
  Layers,
  User,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { queryClient } from "@/lib/query-client";
import { creativesApi } from "../api";
import type { UpdateCreativeInput } from "../api";
import { useTargetCreatives } from "../hooks";
import { LibrarySelector } from "./LibrarySelector";
import type { ResolutionScreen, Creative } from "../types";

interface ScreenCreativeListProps {
  screens: ResolutionScreen[];
  orderLineId: string;
  resolutionWidth: number;
  resolutionHeight: number;
}

export function ScreenCreativeList({
  screens,
  orderLineId,
  resolutionWidth,
  resolutionHeight,
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
}

function ScreenRow({
  screen,
  orderLineId,
  resolutionWidth,
  resolutionHeight,
}: ScreenRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [showAddSelector, setShowAddSelector] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Creative | null>(null);
  const [editTarget, setEditTarget] = useState<Creative | null>(null);

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

  // Mutation: Update creative
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCreativeInput }) =>
      creativesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["targets", screen.target_id, "creatives"] });
      toast.success("Creativo actualizado");
      setEditTarget(null);
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? "Error al actualizar creativo");
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
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-3 ml-6 space-y-3">
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
          ) : (
            <div className="space-y-2">
              {creatives!.map((creative) => (
                <CreativeRow
                  key={creative.id}
                  creative={creative}
                  isEditing={editTarget?.id === creative.id}
                  onEdit={() => setEditTarget(creative)}
                  onCancelEdit={() => setEditTarget(null)}
                  onSaveEdit={(data) =>
                    updateMutation.mutate({ id: creative.id, data })
                  }
                  onDelete={() => setDeleteTarget(creative)}
                  isSaving={updateMutation.isPending}
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
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (data: UpdateCreativeInput) => void;
  onDelete: () => void;
  isSaving: boolean;
}

function CreativeRow({
  creative,
  isEditing,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  isSaving,
}: CreativeRowProps) {
  const [editWeight, setEditWeight] = useState(String(creative.weight));

  // Determine if this creative was assigned via bulk (resolution) or individually.
  // Heuristic: if order_line_id is set (deprecated field present) it was likely bulk-assigned.
  // For simplicity, we use whether created_at matches other creatives in the same target.
  // The actual distinction is not stored in the API response, so we use a convention:
  // creatives without order_line_id are individually assigned.
  const isBulkAssigned = !!creative.order_line_id;

  const handleSave = useCallback(() => {
    const weight = parseInt(editWeight, 10);
    if (isNaN(weight) || weight < 1) {
      toast.error("El peso debe ser un entero mayor o igual a 1");
      return;
    }
    onSaveEdit({ weight });
  }, [editWeight, onSaveEdit]);

  if (isEditing) {
    return (
      <div className="rounded-lg border p-3 space-y-3 bg-muted/30">
        <div className="flex items-center gap-2">
          <CreativeThumbnail creative={creative} size="md" />
          <span className="text-sm font-medium truncate flex-1">
            {creative.content?.filename ?? "Contenido"}
          </span>
        </div>

        {/* Weight edit */}
        <div className="space-y-1">
          <Label htmlFor={`weight-${creative.id}`} className="text-xs">
            Peso (weight)
          </Label>
          <Input
            id={`weight-${creative.id}`}
            type="number"
            min={1}
            value={editWeight}
            onChange={(e) => setEditWeight(e.target.value)}
            className="h-8 w-24"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? "Guardando..." : "Guardar"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancelEdit}
            disabled={isSaving}
          >
            Cancelar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border p-2 group hover:bg-muted/20 transition-colors">
      <CreativeThumbnail creative={creative} size="md" />

      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-sm font-medium truncate">
          {creative.content?.filename ?? "Contenido"}
        </p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Peso: {creative.weight}</span>
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

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onEdit}
          title="Editar peso"
        >
          <Pencil className="h-3.5 w-3.5" />
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
