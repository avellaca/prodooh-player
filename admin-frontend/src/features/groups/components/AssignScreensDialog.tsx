import { useState, useMemo } from "react";
import { Loader2, Search } from "lucide-react";

import { useScreens } from "@/features/screens/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(currentScreenIds));
  const [searchQuery, setSearchQuery] = useState("");

  // Filter and sort screens: selected first, then alphabetically by name
  const filteredScreens = useMemo(() => {
    if (!screens) return [];
    let result = screens;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((s) => {
        const resolution = `${s.resolution_width}x${s.resolution_height}`;
        return (
          s.name.toLowerCase().includes(q) ||
          s.venue_id.toLowerCase().includes(q) ||
          resolution.includes(q) ||
          s.orientation.toLowerCase().includes(q)
        );
      });
    }

    // Sort: selected screens first (by name), then unselected (by name)
    return [...result].sort((a, b) => {
      const aSelected = selectedIds.has(a.id) ? 0 : 1;
      const bSelected = selectedIds.has(b.id) ? 0 : 1;
      if (aSelected !== bSelected) return aSelected - bSelected;
      return a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' });
    });
  }, [screens, searchQuery, selectedIds]);

  // Check if all filtered screens are selected
  const allFilteredSelected = filteredScreens.length > 0 &&
    filteredScreens.every((s) => selectedIds.has(s.id));
  const someFilteredSelected = filteredScreens.some((s) => selectedIds.has(s.id));

  function handleToggle(screenId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(screenId)) {
        next.delete(screenId);
      } else {
        next.add(screenId);
      }
      return next;
    });
  }

  function handleToggleAll() {
    if (allFilteredSelected) {
      // Deselect all filtered
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredScreens.forEach((s) => next.delete(s.id));
        return next;
      });
    } else {
      // Select all filtered
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredScreens.forEach((s) => next.add(s.id));
        return next;
      });
    }
  }

  function handleSubmit() {
    onSubmit(Array.from(selectedIds));
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      setSearchQuery("");
    }
    onOpenChange(isOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-hidden flex flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Asignar pantallas</DialogTitle>
          <DialogDescription>
            Selecciona las pantallas que deseas asignar a este grupo.
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, venue ID, resolución..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>

        {/* Select all checkbox */}
        {filteredScreens.length > 0 && (
          <label className="flex items-center gap-3 px-3 py-1.5 border-b cursor-pointer">
            <Checkbox
              checked={allFilteredSelected ? true : someFilteredSelected ? "indeterminate" : false}
              onCheckedChange={handleToggleAll}
            />
            <span className="text-sm font-medium">
              {allFilteredSelected
                ? `Deseleccionar todas (${filteredScreens.length})`
                : `Seleccionar todas (${filteredScreens.length})`}
            </span>
          </label>
        )}

        {/* Screen list */}
        <div className="flex-1 overflow-y-auto border rounded-md p-2 space-y-1 min-h-[200px] max-h-[400px]">
          {isLoading ? (
            <p className="text-sm text-muted-foreground p-2">
              Cargando pantallas...
            </p>
          ) : filteredScreens.length > 0 ? (
            filteredScreens.map((screen) => (
              <label
                key={screen.id}
                className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted cursor-pointer"
              >
                <Checkbox
                  checked={selectedIds.has(screen.id)}
                  onCheckedChange={() => handleToggle(screen.id)}
                />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{screen.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {screen.venue_id}
                  </span>
                  <div className="text-xs text-muted-foreground">
                    {screen.orientation} · {screen.resolution_width}×{screen.resolution_height}
                  </div>
                </div>
              </label>
            ))
          ) : searchQuery ? (
            <p className="text-sm text-muted-foreground p-2 text-center">
              Sin resultados para "{searchQuery}"
            </p>
          ) : (
            <p className="text-sm text-muted-foreground p-2">
              No hay pantallas disponibles.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || selectedIds.size === 0}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Asignar ({selectedIds.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
