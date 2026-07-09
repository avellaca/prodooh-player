import { useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import type { Screenshot } from "@/types/models";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ScreenshotGalleryProps {
  screenshots: Screenshot[];
}

export function ScreenshotGallery({ screenshots }: ScreenshotGalleryProps) {
  const [selectedScreenshot, setSelectedScreenshot] = useState<Screenshot | null>(null);

  const sortedScreenshots = [...screenshots].sort(
    (a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()
  );

  if (sortedScreenshots.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay screenshots disponibles
      </p>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {sortedScreenshots.map((screenshot) => (
          <button
            key={screenshot.id}
            type="button"
            className="group cursor-pointer rounded-md border p-2 text-center transition-colors hover:border-primary hover:bg-muted/50"
            onClick={() => setSelectedScreenshot(screenshot)}
          >
            <img
              src={screenshot.storage_path}
              alt={`Screenshot ${format(new Date(screenshot.captured_at), "dd/MM/yyyy HH:mm", { locale: es })}`}
              className="aspect-video w-full rounded object-cover"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {format(new Date(screenshot.captured_at), "dd/MM/yyyy HH:mm:ss", {
                locale: es,
              })}
            </p>
          </button>
        ))}
      </div>

      <Dialog
        open={selectedScreenshot !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedScreenshot(null);
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {selectedScreenshot &&
                format(new Date(selectedScreenshot.captured_at), "dd/MM/yyyy HH:mm:ss", {
                  locale: es,
                })}
            </DialogTitle>
          </DialogHeader>
          {selectedScreenshot && (
            <img
              src={selectedScreenshot.storage_path}
              alt={`Screenshot ${format(new Date(selectedScreenshot.captured_at), "dd/MM/yyyy HH:mm", { locale: es })}`}
              className="w-full rounded-md object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
