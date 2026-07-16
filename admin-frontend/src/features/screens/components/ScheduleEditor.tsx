import { useState } from 'react';
import { Loader2, Plus, Trash2, RotateCcw } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useUpdateScreen } from '../hooks';

/** A single schedule slot with days of the week and time range */
export interface ScheduleSlot {
  days: number[];   // 0=Monday … 6=Sunday
  start: string;    // "HH:mm"
  end: string;      // "HH:mm"
}

interface ScheduleEditorProps {
  screenId: string;
  /** Current screen schedule; null means inherits from group */
  schedule: ScheduleSlot[] | null;
  /** Group name for display when inheriting */
  groupName?: string | null;
}

const DAY_LABELS: { value: number; label: string; short: string }[] = [
  { value: 0, label: 'Lunes', short: 'Lun' },
  { value: 1, label: 'Martes', short: 'Mar' },
  { value: 2, label: 'Miércoles', short: 'Mié' },
  { value: 3, label: 'Jueves', short: 'Jue' },
  { value: 4, label: 'Viernes', short: 'Vie' },
  { value: 5, label: 'Sábado', short: 'Sáb' },
  { value: 6, label: 'Domingo', short: 'Dom' },
];

function getScheduleOriginLabel(
  schedule: ScheduleSlot[] | null,
  groupName: string | null | undefined,
): { text: string; variant: 'default' | 'secondary' | 'outline' } {
  if (schedule !== null && schedule.length > 0) {
    return { text: 'Configurado en esta pantalla', variant: 'default' };
  }
  if (groupName) {
    return { text: `Heredado del grupo: ${groupName}`, variant: 'secondary' };
  }
  return { text: '24/7 por defecto', variant: 'outline' };
}

function createEmptySlot(): ScheduleSlot {
  return { days: [0, 1, 2, 3, 4], start: '08:00', end: '22:00' };
}

export function ScheduleEditor({ screenId, schedule, groupName }: ScheduleEditorProps) {
  const updateScreen = useUpdateScreen();

  // Local editing state: initialize from prop
  const [slots, setSlots] = useState<ScheduleSlot[]>(schedule ?? []);
  const [isEditing, setIsEditing] = useState(false);

  const origin = getScheduleOriginLabel(schedule, groupName);
  const hasLocalSchedule = schedule !== null;
  const hasUnsavedChanges = isEditing;

  function handleAddSlot() {
    setSlots([...slots, createEmptySlot()]);
    setIsEditing(true);
  }

  function handleRemoveSlot(index: number) {
    setSlots(slots.filter((_, i) => i !== index));
    setIsEditing(true);
  }

  function handleDayToggle(slotIndex: number, day: number, checked: boolean) {
    const updated = slots.map((slot, i) => {
      if (i !== slotIndex) return slot;
      const days = checked
        ? [...slot.days, day].sort((a, b) => a - b)
        : slot.days.filter((d) => d !== day);
      return { ...slot, days };
    });
    setSlots(updated);
    setIsEditing(true);
  }

  function handleTimeChange(slotIndex: number, field: 'start' | 'end', value: string) {
    const updated = slots.map((slot, i) => {
      if (i !== slotIndex) return slot;
      return { ...slot, [field]: value };
    });
    setSlots(updated);
    setIsEditing(true);
  }

  function handleSave() {
    updateScreen.mutate(
      { id: screenId, data: { schedule: slots } as never },
      {
        onSuccess: () => {
          setIsEditing(false);
        },
      },
    );
  }

  function handleResetToGroup() {
    updateScreen.mutate(
      { id: screenId, data: { schedule: null } as never },
      {
        onSuccess: () => {
          setSlots([]);
          setIsEditing(false);
        },
      },
    );
  }

  function handleStartEditing() {
    if (slots.length === 0) {
      setSlots([createEmptySlot()]);
    }
    setIsEditing(true);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg">Horario operativo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Show current schedule or empty state */}
        {!isEditing && !hasLocalSchedule && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {groupName
                ? `Esta pantalla hereda el horario operativo del grupo "${groupName}".`
                : 'Sin horario configurado — la pantalla opera 24/7.'}
            </p>
            <Button variant="outline" size="sm" onClick={handleStartEditing}>
              <Plus className="mr-2 h-4 w-4" />
              Configurar horario propio
            </Button>
          </div>
        )}

        {!isEditing && hasLocalSchedule && schedule && schedule.length > 0 && (
          <div className="space-y-3">
            {schedule.map((slot, index) => (
              <ScheduleSlotDisplay key={index} slot={slot} />
            ))}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleStartEditing}>
                Editar horario
              </Button>
              {groupName && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetToGroup}
                  disabled={updateScreen.isPending}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Restablecer a herencia del grupo
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Editing mode */}
        {isEditing && (
          <div className="space-y-4">
            {slots.map((slot, index) => (
              <ScheduleSlotEditor
                key={index}
                slot={slot}
                index={index}
                onDayToggle={handleDayToggle}
                onTimeChange={handleTimeChange}
                onRemove={handleRemoveSlot}
                canRemove={slots.length > 1}
              />
            ))}

            <Button variant="outline" size="sm" onClick={handleAddSlot}>
              <Plus className="mr-2 h-4 w-4" />
              Agregar franja horaria
            </Button>

            <div className="flex items-center gap-2 pt-2 border-t">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={updateScreen.isPending || slots.some((s) => s.days.length === 0)}
              >
                {updateScreen.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar horario
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSlots(schedule ?? []);
                  setIsEditing(false);
                }}
                disabled={updateScreen.isPending}
              >
                Cancelar
              </Button>
              {hasLocalSchedule && groupName && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-muted-foreground"
                  onClick={handleResetToGroup}
                  disabled={updateScreen.isPending}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Restablecer a herencia del grupo
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Read-only display of a single schedule slot */
function ScheduleSlotDisplay({ slot }: { slot: ScheduleSlot }) {
  const dayLabels = slot.days
    .map((d) => DAY_LABELS.find((dl) => dl.value === d)?.short ?? '')
    .join(', ');

  return (
    <div className="flex items-center gap-3 text-sm rounded-md border px-3 py-2">
      <span className="font-medium min-w-[140px]">{dayLabels}</span>
      <span className="text-muted-foreground">
        {slot.start} — {slot.end}
      </span>
    </div>
  );
}

/** Editable form for a single schedule slot */
function ScheduleSlotEditor({
  slot,
  index,
  onDayToggle,
  onTimeChange,
  onRemove,
  canRemove,
}: {
  slot: ScheduleSlot;
  index: number;
  onDayToggle: (slotIndex: number, day: number, checked: boolean) => void;
  onTimeChange: (slotIndex: number, field: 'start' | 'end', value: string) => void;
  onRemove: (index: number) => void;
  canRemove: boolean;
}) {
  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground font-medium">
          Franja {index + 1}
        </Label>
        {canRemove && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(index)}
            aria-label={`Eliminar franja ${index + 1}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Day checkboxes */}
      <div className="flex flex-wrap gap-3">
        {DAY_LABELS.map((day) => (
          <label
            key={day.value}
            className="flex items-center gap-1.5 text-sm cursor-pointer"
          >
            <Checkbox
              checked={slot.days.includes(day.value)}
              onCheckedChange={(checked) => onDayToggle(index, day.value, checked)}
              aria-label={day.label}
            />
            <span>{day.short}</span>
          </label>
        ))}
      </div>

      {/* Time range */}
      <div className="flex items-center gap-2">
        <div className="space-y-1">
          <Label htmlFor={`start-${index}`} className="text-xs text-muted-foreground">
            Inicio
          </Label>
          <Input
            id={`start-${index}`}
            type="time"
            value={slot.start}
            onChange={(e) => onTimeChange(index, 'start', e.target.value)}
            className="w-[130px]"
          />
        </div>
        <span className="mt-5 text-muted-foreground">—</span>
        <div className="space-y-1">
          <Label htmlFor={`end-${index}`} className="text-xs text-muted-foreground">
            Fin
          </Label>
          <Input
            id={`end-${index}`}
            type="time"
            value={slot.end}
            onChange={(e) => onTimeChange(index, 'end', e.target.value)}
            className="w-[130px]"
          />
        </div>
      </div>
    </div>
  );
}
