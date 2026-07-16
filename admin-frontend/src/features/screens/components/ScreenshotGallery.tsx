import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/axios";
import { queryClient } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import type { Screenshot } from "@/types/models";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ScreenshotGalleryProps {
  screenshots: Screenshot[];
  screenId?: string;
  orientation?: 'landscape' | 'portrait';
}

/**
 * Parse a captured_at timestamp correctly.
 * The backend stores the UTC time from the player but may serve it
 * with an incorrect offset. We parse and display in local time.
 */
function parseLocalDate(dateStr: string): Date {
  return new Date(dateStr);
}

export function ScreenshotGallery({ screenshots, screenId, orientation = 'landscape' }: ScreenshotGalleryProps) {
  const [selectedScreenshot, setSelectedScreenshot] = useState<Screenshot | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/screenshots/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['screens', screenId, 'screenshots'] });
      toast.success('Captura eliminada');
    },
    onError: () => {
      toast.error('Error al eliminar la captura');
    },
  });

  const sortedScreenshots = [...screenshots].sort(
    (a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()
  );

  if (sortedScreenshots.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay capturas disponibles
      </p>
    );
  }

  return (
    <>
      <div className={cn(
        "grid gap-4",
        orientation === 'portrait'
          ? "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6"
          : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
      )}>
        {sortedScreenshots.map((screenshot) => (
          <div
            key={screenshot.id}
            className="group relative rounded-md border p-2 text-center transition-colors hover:border-primary hover:bg-muted/50"
          >
            <button
              type="button"
              className="w-full cursor-pointer"
              onClick={() => setSelectedScreenshot(screenshot)}
            >
              <img
                src={screenshot.storage_path}
                alt={`Captura ${format(parseLocalDate(screenshot.captured_at), "dd/MM/yyyy HH:mm", { locale: es })}`}
                className={cn(
                  "w-full rounded object-cover",
                  orientation === 'portrait' ? "aspect-[9/16]" : "aspect-video"
                )}
              />
            </button>
            <p className="mt-2 text-xs text-muted-foreground">
              {format(parseLocalDate(screenshot.captured_at), "dd/MM/yyyy HH:mm:ss", {
                locale: es,
              })}
            </p>
            {/* Delete button */}
            <button
              type="button"
              className="absolute top-1 right-1 hidden group-hover:flex h-6 w-6 items-center justify-center rounded bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                deleteMutation.mutate(screenshot.id);
              }}
              title="Eliminar captura"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <Dialog
        open={selectedScreenshot !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedScreenshot(null);
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" onKeyDown={(e) => {
          if (!selectedScreenshot) return;
          const currentIdx = sortedScreenshots.findIndex(s => s.id === selectedScreenshot.id);
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            const next = sortedScreenshots[(currentIdx + 1) % sortedScreenshots.length];
            if (next) setSelectedScreenshot(next);
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = sortedScreenshots[(currentIdx - 1 + sortedScreenshots.length) % sortedScreenshots.length];
            if (prev) setSelectedScreenshot(prev);
          }
        }}>
          <DialogHeader>
            <DialogTitle>
              {selectedScreenshot &&
                format(parseLocalDate(selectedScreenshot.captured_at), "dd/MM/yyyy HH:mm:ss", {
                  locale: es,
                })}
            </DialogTitle>
          </DialogHeader>
          {selectedScreenshot && (
            <div className="relative flex items-center justify-center flex-1 min-h-0">
              {/* Prev button */}
              <button
                type="button"
                className="absolute left-2 top-1/2 -translate-y-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                onClick={() => {
                  const idx = sortedScreenshots.findIndex(s => s.id === selectedScreenshot.id);
                  const prev = sortedScreenshots[(idx - 1 + sortedScreenshots.length) % sortedScreenshots.length];
                  if (prev) setSelectedScreenshot(prev);
                }}
              >
                ‹
              </button>

              <img
                src={selectedScreenshot.storage_path}
                alt={`Captura ${format(parseLocalDate(selectedScreenshot.captured_at), "dd/MM/yyyy HH:mm", { locale: es })}`}
                className="max-w-full max-h-[75vh] rounded-md object-contain"
              />

              {/* Next button */}
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                onClick={() => {
                  const idx = sortedScreenshots.findIndex(s => s.id === selectedScreenshot.id);
                  const next = sortedScreenshots[(idx + 1) % sortedScreenshots.length];
                  if (next) setSelectedScreenshot(next);
                }}
              >
                ›
              </button>

              {/* Counter */}
              <span className="absolute bottom-2 right-2 text-xs text-white bg-black/50 rounded px-2 py-0.5">
                {sortedScreenshots.findIndex(s => s.id === selectedScreenshot.id) + 1} / {sortedScreenshots.length}
              </span>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
