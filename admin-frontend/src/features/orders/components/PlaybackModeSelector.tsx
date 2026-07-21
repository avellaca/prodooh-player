import { Repeat, ListOrdered } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useUpdatePlaybackMode } from '../hooks';
import type { PlaybackMode } from '../types';

const MODE_OPTIONS: { value: PlaybackMode; label: string; description: string; icon: typeof Repeat }[] = [
  {
    value: 'round_robin',
    label: 'Round Robin',
    description: 'Rotación por peso — cada creativo se muestra según su proporción de peso relativo.',
    icon: Repeat,
  },
  {
    value: 'sequential',
    label: 'Secuencial',
    description: 'Orden fijo — los creativos se reproducen en la posición definida por el usuario.',
    icon: ListOrdered,
  },
];

interface PlaybackModeSelectorProps {
  orderLineId: string;
  currentMode: PlaybackMode;
}

export function PlaybackModeSelector({ orderLineId, currentMode }: PlaybackModeSelectorProps) {
  const updateMutation = useUpdatePlaybackMode(orderLineId);

  function handleModeChange(value: string) {
    const newMode = value as PlaybackMode;
    if (newMode !== currentMode) {
      updateMutation.mutate(newMode);
    }
  }

  const currentOption = MODE_OPTIONS.find((o) => o.value === currentMode) ?? MODE_OPTIONS[0];
  const CurrentIcon = currentOption.icon;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <CurrentIcon className="h-5 w-5" />
          Modo de reproducción
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Select
            value={currentMode}
            onValueChange={handleModeChange}
            disabled={updateMutation.isPending}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODE_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <SelectItem key={option.value} value={option.value}>
                    <span className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      {option.label}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {updateMutation.isPending && (
            <Badge variant="secondary" className="text-xs">
              Guardando...
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {currentOption.description}
        </p>
        {currentMode === 'sequential' && (
          <p className="text-xs text-muted-foreground border-l-2 border-primary pl-2">
            Arrastra los creativos para definir el orden de reproducción. El peso no aplica en este modo.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
