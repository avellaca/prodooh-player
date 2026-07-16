import { useState } from 'react';
import { Plus, Trash2, Clock, Monitor } from 'lucide-react';

import { useUpdateGroup, useApplyGroupSchedule } from '../hooks';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';

import type { ScheduleSlot, Screen } from '@/types/models';

const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DAY_VALUES = [1, 2, 3, 4, 5, 6, 0]; // Monday=1 ... Sunday=0

interface GroupScheduleEditorProps {
  groupId: string;
  schedule: ScheduleSlot[] | null;
  screens: Screen[];
}

export function GroupScheduleEditor({ groupId, schedule, screens }: GroupScheduleEditorProps) {
  const [slots, setSlots] = useState<ScheduleSlot[]>(schedule ?? []);
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);

  const updateGroup = useUpdateGroup();
  const applySchedule = useApplyGroupSchedule();

  const screensInheriting = screens.filter((s) => s.schedule === null);
  const screensWithOverride = screens.filter((s) => s.schedule !== null);

  const hasChanges = JSON.stringify(slots) !== JSON.stringify(schedule ?? []);

  function handleAddSlot() {
    setSlots([...slots, { days: [1, 2, 3, 4, 5], start: '08:00', end: '22:00' }]);
  }

  function handleRemoveSlot(index: number) {
    setSlots(slots.filter((_, i) => i !== index));
  }

  function handleDayToggle(slotIndex: number, day: number) {
    setSlots(
      slots.map((slot, i) => {
        if (i !== slotIndex) return slot;
        const days = slot.days.includes(day)
          ? slot.days.filter((d) => d !== day)
          : [...slot.days, day];
        return { ...slot, days };
      })
    );
  }

  function handleTimeChange(slotIndex: number, field: 'start' | 'end', value: string) {
    setSlots(
      slots.map((slot, i) => {
        if (i !== slotIndex) return slot;
        return { ...slot, [field]: value };
      })
    );
  }

  function handleSave() {
    const scheduleValue = slots.length > 0 ? slots : null;
    updateGroup.mutate({ id: groupId, data: { schedule: scheduleValue } });
  }

  function handleApplyToAll() {
    applySchedule.mutate(groupId, {
      onSuccess: () => setShowApplyConfirm(false),
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="h-5 w-5" />
            Horario operativo del grupo
          </CardTitle>
          <div className="flex gap-2">
            {screens.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowApplyConfirm(true)}
                disabled={applySchedule.isPending}
              >
                Aplicar a todas
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!hasChanges || updateGroup.isPending}
            >
              {updateGroup.isPending ? 'Guardando...' : 'Guardar horario'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Schedule Slots Editor */}
        <div className="space-y-4">
          {slots.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No hay franjas horarias configuradas. Las pantallas operarán 24/7.
            </p>
          )}

          {slots.map((slot, index) => (
            <div
              key={index}
              className="flex flex-col gap-3 rounded-lg border p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Franja {index + 1}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveSlot(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {/* Days selector */}
              <div className="flex flex-wrap gap-2">
                {DAY_VALUES.map((day, dayIndex) => (
                  <label
                    key={day}
                    className="flex items-center gap-1.5 text-sm"
                  >
                    <Checkbox
                      checked={slot.days.includes(day)}
                      onCheckedChange={() => handleDayToggle(index, day)}
                    />
                    {DAY_LABELS[dayIndex]}
                  </label>
                ))}
              </div>

              {/* Time range */}
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  value={slot.start}
                  onChange={(e) => handleTimeChange(index, 'start', e.target.value)}
                  className="w-32"
                />
                <span className="text-sm text-muted-foreground">a</span>
                <Input
                  type="time"
                  value={slot.end}
                  onChange={(e) => handleTimeChange(index, 'end', e.target.value)}
                  className="w-32"
                />
              </div>
            </div>
          ))}

          <Button variant="outline" size="sm" onClick={handleAddSlot}>
            <Plus className="mr-2 h-4 w-4" />
            Agregar franja
          </Button>
        </div>

        {/* Screen inheritance status — removed: not providing relevant info */}
      </CardContent>

      {/* Confirm dialog for "Aplicar a todas" */}
      <ConfirmDialog
        open={showApplyConfirm}
        onOpenChange={setShowApplyConfirm}
        title="Aplicar horario a todas las pantallas"
        description={`Esto restablecerá el horario de todas las pantallas del grupo (${screens.length}) para que hereden el horario del grupo. Las pantallas con horario propio perderán su configuración individual.`}
        onConfirm={handleApplyToAll}
        confirmLabel="Aplicar a todas"
        variant="default"
      />
    </Card>
  );
}
