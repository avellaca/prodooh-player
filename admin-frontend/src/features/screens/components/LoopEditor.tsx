import { useState } from "react";
import { Plus, Trash2, Loader2, Save } from "lucide-react";

import { useUpdateLoop } from "../hooks";
import type { LoopSlot } from "@/types/models";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface LoopEditorProps {
  screenId: string;
  initialSlots: LoopSlot[];
}

type SlotDraft = {
  source: LoopSlot["source"] | "";
  duration: number;
};

const SOURCE_OPTIONS: { value: LoopSlot["source"]; label: string }[] = [
  { value: "prodooh", label: "Prodooh" },
  { value: "gam", label: "GAM" },
  { value: "url", label: "URL" },
  { value: "playlist", label: "Playlist" },
];

function toSlotDrafts(slots: LoopSlot[]): SlotDraft[] {
  if (slots.length === 0) {
    return [{ source: "", duration: 0 }];
  }
  return slots.map((s) => ({ source: s.source, duration: s.duration }));
}

export function LoopEditor({ screenId, initialSlots }: LoopEditorProps) {
  const [slots, setSlots] = useState<SlotDraft[]>(() => toSlotDrafts(initialSlots));
  const updateLoop = useUpdateLoop(screenId);

  // Validation: every slot must have a source selected and duration > 0
  const isValid = slots.every((slot) => slot.source !== "" && slot.duration > 0);

  function handleAddSlot() {
    setSlots((prev) => [...prev, { source: "", duration: 0 }]);
  }

  function handleRemoveSlot(index: number) {
    if (slots.length <= 1) return;
    setSlots((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSourceChange(index: number, value: LoopSlot["source"]) {
    setSlots((prev) =>
      prev.map((slot, i) => (i === index ? { ...slot, source: value } : slot))
    );
  }

  function handleDurationChange(index: number, value: string) {
    const duration = Number(value) || 0;
    setSlots((prev) =>
      prev.map((slot, i) => (i === index ? { ...slot, duration } : slot))
    );
  }

  function handleSave() {
    if (!isValid) return;

    const payload: LoopSlot[] = slots.map((slot, index) => ({
      position: index + 1,
      source: slot.source as LoopSlot["source"],
      duration: slot.duration,
    }));

    updateLoop.mutate(payload);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {slots.map((slot, index) => (
          <div
            key={index}
            className="flex items-center gap-3 rounded-md border p-3"
          >
            <span className="text-sm font-medium text-muted-foreground w-8">
              #{index + 1}
            </span>

            <Select
              value={slot.source || undefined}
              onValueChange={(value) =>
                handleSourceChange(index, value as LoopSlot["source"])
              }
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Fuente" />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                value={slot.duration || ""}
                onChange={(e) => handleDurationChange(index, e.target.value)}
                placeholder="Duración (s)"
                className="w-[120px]"
              />
              <span className="text-sm text-muted-foreground">seg</span>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => handleRemoveSlot(index)}
              disabled={slots.length <= 1}
              aria-label={`Eliminar slot ${index + 1}`}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={handleAddSlot}>
          <Plus className="mr-2 h-4 w-4" />
          Agregar slot
        </Button>

        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={!isValid || updateLoop.isPending}
        >
          {updateLoop.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Guardar loop
        </Button>
      </div>
    </div>
  );
}
