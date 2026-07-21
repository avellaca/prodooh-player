import { useState } from "react";
import { Filter, Upload, ExternalLink, Image, Film, Check, AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useContentByResolution } from "../hooks";
import { exceedsSlotDuration, DEFAULT_SLOT_DURATION_SECONDS } from "../utils/duration-validation";
import type { Content } from "@/types/models";

interface LibrarySelectorProps {
  width: number;
  height: number;
  onSelect: (contentIds: string[]) => void;
  onUploadClick?: () => void;
  isSubmitting?: boolean;
  /** Slot duration in seconds for video duration warnings. Defaults to 10s. */
  slotDurationSeconds?: number;
}

export function LibrarySelector({
  width,
  height,
  onSelect,
  onUploadClick,
  isSubmitting = false,
  slotDurationSeconds = DEFAULT_SLOT_DURATION_SECONDS,
}: LibrarySelectorProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { data: contents, isLoading } = useContentByResolution(width, height);

  function handleItemClick(contentId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(contentId)) {
        next.delete(contentId);
      } else {
        next.add(contentId);
      }
      return next;
    });
  }

  function handleConfirm() {
    onSelect(Array.from(selectedIds));
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Badge variant="secondary" className="gap-1">
          <Filter className="h-3 w-3" />
          Filtro: {width}×{height}
        </Badge>
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  const isEmpty = !contents || contents.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Badge variant="secondary" className="gap-1">
          <Filter className="h-3 w-3" />
          Filtro: {width}×{height}
        </Badge>
        {selectedIds.size > 0 && (
          <span className="text-sm text-muted-foreground">
            {selectedIds.size} seleccionado{selectedIds.size > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
          <Image className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-4">
            No hay archivos con resolución {width}×{height}
          </p>
          <div className="flex gap-2">
            {onUploadClick && (
              <Button variant="default" size="sm" onClick={onUploadClick}>
                <Upload className="h-4 w-4" />
                Subir nuevo
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <a href="/biblioteca">
                <ExternalLink className="h-4 w-4" />
                Ir a Biblioteca
              </a>
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 max-h-[400px] overflow-y-auto">
            {contents.map((content: Content) => {
              const isSelected = selectedIds.has(content.id);
              const hasDurationWarning = exceedsSlotDuration(content, slotDurationSeconds);
              return (
                <button
                  key={content.id}
                  type="button"
                  onClick={() => handleItemClick(content.id)}
                  disabled={isSubmitting}
                  className={`relative aspect-video rounded-md border-2 overflow-hidden cursor-pointer transition-all hover:ring-2 hover:ring-primary/50 ${
                    isSelected
                      ? "border-primary ring-2 ring-primary/50"
                      : hasDurationWarning
                        ? "border-amber-300"
                        : "border-transparent"
                  }`}
                >
                  {content.mime_type.startsWith("image/") ? (
                    <img
                      src={`/api/admin/content/${content.id}/preview/file`}
                      alt={content.filename}
                      className="h-full w-full object-cover"
                    />
                  ) : content.mime_type.startsWith("video/") ? (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-muted">
                      <Film className="h-6 w-6 text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground truncate px-1 max-w-full">
                        {content.filename}
                      </span>
                    </div>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-muted">
                      <span className="text-xs text-muted-foreground truncate px-1">
                        {content.filename}
                      </span>
                    </div>
                  )}
                  {isSelected && (
                    <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
                      <div className="rounded-full bg-primary p-1">
                        <Check className="h-3 w-3 text-primary-foreground" />
                      </div>
                    </div>
                  )}
                  {hasDurationWarning && (
                    <div
                      className="absolute top-1 right-1"
                      title={`Video de ${content.duration_seconds}s excede slot de ${slotDurationSeconds}s`}
                    >
                      <Badge variant="outline" className="gap-0.5 text-[9px] px-1 py-0 border-amber-400 text-amber-600 bg-amber-50">
                        <AlertTriangle className="h-2.5 w-2.5" />
                        {content.duration_seconds}s
                      </Badge>
                    </div>
                  )}
                  <span className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 text-[10px] text-white truncate">
                    {content.filename}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Confirm button */}
          <div className="flex justify-end pt-2 border-t">
            <Button
              onClick={handleConfirm}
              disabled={selectedIds.size === 0 || isSubmitting}
            >
              {isSubmitting
                ? "Asignando..."
                : `Añadir creativo${selectedIds.size > 1 ? "s" : ""} (${selectedIds.size})`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
