import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/axios";
import type { Content } from "@/types/models";

interface ContentLightboxProps {
  items: Content[];
  initialIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Fetches content file as a blob using the authenticated axios instance,
 * then creates an object URL for display.
 */
function useContentBlobUrl(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["content", id, "blob"],
    queryFn: async () => {
      const fileRes = await api.get(`/admin/content/${id}/preview/file`, {
        responseType: "blob",
      });
      return URL.createObjectURL(fileRes.data as Blob);
    },
    enabled,
    staleTime: 60_000,
  });
}

export function ContentLightbox({
  items,
  initialIndex,
  open,
  onOpenChange,
}: ContentLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [prevOpen, setPrevOpen] = useState(open);

  // Reset index when lightbox opens (React pattern: derive state from props during render)
  if (open && !prevOpen) {
    setCurrentIndex(initialIndex);
    setPrevOpen(true);
  } else if (!open && prevOpen) {
    setPrevOpen(false);
  }

  const effectiveIndex =
    items.length > 0 ? Math.min(currentIndex, items.length - 1) : 0;

  const currentItem = items[effectiveIndex] as Content | undefined;
  const isImage = currentItem?.mime_type.startsWith("image/");
  const isVideo = currentItem?.mime_type.startsWith("video/");
  const totalItems = items.length;

  const { data: blobUrl, isLoading } = useContentBlobUrl(
    currentItem?.id,
    open && !!currentItem?.id
  );

  const close = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const goNext = useCallback(() => {
    if (totalItems === 0) return;
    setCurrentIndex((i) => (i + 1) % totalItems);
  }, [totalItems]);

  const goPrev = useCallback(() => {
    if (totalItems === 0) return;
    setCurrentIndex((i) => (i - 1 + totalItems) % totalItems);
  }, [totalItems]);

  // Keyboard event listener for navigation and close — legitimate external browser API use
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case "Escape":
          close();
          break;
        case "ArrowLeft":
          goPrev();
          break;
        case "ArrowRight":
          goNext();
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, close, goNext, goPrev]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Lightbox de contenido"
    >
      {/* Backdrop — click to close */}
      <div
        className="absolute inset-0 bg-black/80"
        onClick={close}
        aria-hidden="true"
      />

      {/* Close button */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-4 top-4 z-10 text-white hover:bg-white/20"
        onClick={close}
        aria-label="Cerrar lightbox"
      >
        <X className="h-6 w-6" />
      </Button>

      {/* Previous button */}
      {totalItems > 1 && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-4 top-1/2 z-10 -translate-y-1/2 text-white hover:bg-white/20"
          onClick={goPrev}
          aria-label="Contenido anterior"
        >
          <ChevronLeft className="h-8 w-8" />
        </Button>
      )}

      {/* Next button */}
      {totalItems > 1 && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-4 top-1/2 z-10 -translate-y-1/2 text-white hover:bg-white/20"
          onClick={goNext}
          aria-label="Contenido siguiente"
        >
          <ChevronRight className="h-8 w-8" />
        </Button>
      )}

      {/* Content area */}
      <div
        className="relative z-10 flex max-h-[85vh] max-w-[90vw] items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {isLoading || !blobUrl ? (
          <div className="flex h-64 w-64 items-center justify-center text-white">
            Cargando...
          </div>
        ) : isVideo ? (
          <video
            key={currentItem?.id}
            src={blobUrl}
            controls
            autoPlay
            className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
          />
        ) : isImage ? (
          <img
            key={currentItem?.id}
            src={blobUrl}
            alt={currentItem?.filename ?? "Preview"}
            className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
          />
        ) : (
          <div className="flex h-64 w-64 items-center justify-center text-white">
            Formato no soportado
          </div>
        )}
      </div>

      {/* Counter indicator */}
      {totalItems > 1 && (
        <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-sm text-white">
          {effectiveIndex + 1} / {totalItems}
        </div>
      )}
    </div>
  );
}
