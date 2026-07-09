import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useScreens } from "@/features/screens/hooks";

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
  const { data: screens } = useScreens();
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
      onOpenChange={(value) => {
        if (!value) {
          setSelectedIds(currentScreenIds);
        }
        onOpenChange(value);
      }}
    >
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Asignar a pantallas</DialogTitle>
          <DialogDescription>
            Selecciona las pantallas a las que deseas asignar esta playlist.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-4">
          {!screens || screens.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No hay pantallas disponibles.
            </p>
          ) : (
            screens.map((screen) => (
              <Label
                key={screen.id}
                className="flex items-center gap-3 p-2 rounded-md hover:bg-muted cursor-pointer"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300"
                  checked={selectedIds.includes(screen.id)}
                  onChange={() => handleToggle(screen.id)}
                  disabled={isSubmitting}
                />
                <span className="text-sm">{screen.name}</span>
              </Label>
            ))
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
