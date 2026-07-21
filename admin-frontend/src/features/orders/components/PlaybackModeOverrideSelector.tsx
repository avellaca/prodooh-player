import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useUpdateTargetPlaybackMode } from '../hooks';
import type { PlaybackMode } from '../types';

interface PlaybackModeOverrideSelectorProps {
  targetId: string;
  orderLineId: string;
  currentOverride: PlaybackMode | null;
  parentMode: PlaybackMode;
}

const INHERIT_VALUE = '__inherit__';

export function PlaybackModeOverrideSelector({
  targetId,
  orderLineId,
  currentOverride,
  parentMode,
}: PlaybackModeOverrideSelectorProps) {
  const updateMutation = useUpdateTargetPlaybackMode(orderLineId);

  function handleChange(value: string) {
    const newOverride = value === INHERIT_VALUE ? null : (value as PlaybackMode);
    if (newOverride !== currentOverride) {
      updateMutation.mutate({ targetId, playbackModeOverride: newOverride });
    }
  }

  const selectValue = currentOverride ?? INHERIT_VALUE;

  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs text-muted-foreground whitespace-nowrap">Modo:</Label>
      <Select
        value={selectValue}
        onValueChange={handleChange}
        disabled={updateMutation.isPending}
      >
        <SelectTrigger className="h-7 w-[160px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={INHERIT_VALUE}>
            Heredar ({parentMode === 'round_robin' ? 'Round Robin' : 'Secuencial'})
          </SelectItem>
          <SelectItem value="round_robin">Round Robin</SelectItem>
          <SelectItem value="sequential">Secuencial</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
