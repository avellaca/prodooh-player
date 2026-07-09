import { useState } from "react";
import { Loader2 } from "lucide-react";

import { useScreens } from "@/features/screens/hooks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AssignScreensDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (screenIds: string[]) => void;
  isSubmitting?: boolean;
  currentScreenIds?: string[];
}

export function AssignScreensDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting = false,
  currentScreenIds = [],
}: AssignScreensDialogProps) {
  const { data: screens, isLoading } = useScreens();
  const [selectedIds, setSelectedIds] = useState<string[]>(currentScreenIds);

  function handleToggle(screenId: string) {
    setSelectedIds((prev) =>
      prev.includes(screenId)
        ? prev.filter((id) => id !== screenId)
        : [...prev, screenId]
    );
  }

  function handleSubmit() {
    onSubmit(selectedIds);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setSelectedIds(currentScreenIds);
        }
        onOpenChange(isOpen);
      }}
    >
      <DialogContent className="max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Asignar pantallas</DialogTitle>
          <DialogDescription>
            Selecciona las pantallas que deseas asignar a este grupo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto border rounded-md p-2 space-y-1">
          {isLoading ? (
            <p className="text-sm text-muted-foreground p-2">
              Cargando pantallas...
            </p>
          ) : screens && screens.length > 0 ? (
            screens.map((screen) => (
              <label
                key={screen.id}
                className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(screen.id)}
                  onChange={() => handleToggle(screen.id)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <div className="flex-1">
                  <span className="text-sm font-medium">{screen.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {screen.orientation} · {screen.resolution_width}×
                    {screen.resolution_height}
                  </span>
                </div>
              </label>
            ))
          ) : (
            <p className="text-sm text-muted-foreground p-2">
              No hay pantallas disponibles.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || selectedIds.length === 0}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Asignar ({selectedIds.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
