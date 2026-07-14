import { useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/axios";
import type { Content } from "@/types/models";

interface ContentPreviewProps {
  items: Content[];
  currentItem: Content | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (item: Content) => void;
}

/**
 * Fetches the file as a blob using the authenticated axios instance,
 * then creates an object URL for display in <img>/<video>.
 */
function useContentBlobUrl(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['content', id, 'blob'],
    queryFn: async () => {
      const fileRes = await api.get(`/admin/content/${id}/preview/file`, {
        responseType: 'blob',
      });
      return URL.createObjectURL(fileRes.data as Blob);
    },
    enabled,
    staleTime: 60_000,
  });
}

export function ContentPreview({
  items,
  currentItem,
  open,
  onOpenChange,
  onNavigate,
}: ContentPreviewProps) {
  const { data: blobUrl, isLoading } = useContentBlobUrl(
    currentItem?.id,
    open && !!currentItem?.id,
  );

  const isVideo = currentItem?.mime_type.startsWith("video/");

  const currentIndex = currentItem ? items.findIndex((i) => i.id === currentItem.id) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < items.length - 1;

  const goToPrev = useCallback(() => {
    if (hasPrev) onNavigate(items[currentIndex - 1]);
  }, [hasPrev, currentIndex, items, onNavigate]);

  const goToNext = useCallback(() => {
    if (hasNext) onNavigate(items[currentIndex + 1]);
  }, [hasNext, currentIndex, items, onNavigate]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goToNext();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, goToPrev, goToNext]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span className="truncate">{currentItem?.filename ?? "Vista previa"}</span>
            {items.length > 1 && (
              <span className="text-sm font-normal text-muted-foreground shrink-0 ml-2">
                {currentIndex + 1} / {items.length}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="relative flex items-center justify-center">
          {/* Left arrow */}
          {hasPrev && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-0 z-10 h-10 w-10 rounded-full bg-background/80 shadow-md hover:bg-background"
              onClick={goToPrev}
              aria-label="Anterior"
            >
              <ChevronLeft className="h-6 w-6" />
            </Button>
          )}

          {/* Content */}
          <div className="flex items-center justify-center w-full min-h-[300px]">
            {isLoading || !blobUrl ? (
              <div className="flex h-64 items-center justify-center text-muted-foreground">
                Cargando vista previa...
              </div>
            ) : isVideo ? (
              <video
                key={currentItem?.id}
                src={blobUrl}
                controls
                className="max-h-[70vh] w-full rounded-md object-contain"
              />
            ) : (
              <img
                key={currentItem?.id}
                src={blobUrl}
                alt={currentItem?.filename ?? "Preview"}
                className="max-h-[70vh] w-full rounded-md object-contain"
              />
            )}
          </div>

          {/* Right arrow */}
          {hasNext && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0 z-10 h-10 w-10 rounded-full bg-background/80 shadow-md hover:bg-background"
              onClick={goToNext}
              aria-label="Siguiente"
            >
              <ChevronRight className="h-6 w-6" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
