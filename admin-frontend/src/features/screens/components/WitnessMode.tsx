import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Zap, ZapOff } from 'lucide-react';

import { screenCommandsApi } from '@/features/orders/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface WitnessModeProps {
  screenId: string;
}

type SpeedFactor = 2 | 4;

export function WitnessMode({ screenId }: WitnessModeProps) {
  const [isActive, setIsActive] = useState(false);
  const [activeFactor, setActiveFactor] = useState<SpeedFactor>(2);
  const [selectedFactor, setSelectedFactor] = useState<SpeedFactor>(2);

  const activateMutation = useMutation({
    mutationFn: (factor: SpeedFactor) =>
      screenCommandsApi.send(screenId, { type: 'speed_override', factor }),
    onSuccess: (_data, factor) => {
      setIsActive(true);
      setActiveFactor(factor);
      toast.success(`Modo Testigo activado a x${factor}`);
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al activar Modo Testigo');
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: () =>
      screenCommandsApi.send(screenId, { type: 'speed_override', factor: 1 }),
    onSuccess: () => {
      setIsActive(false);
      toast.success('Modo Testigo desactivado');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al desactivar Modo Testigo');
    },
  });

  const isLoading = activateMutation.isPending || deactivateMutation.isPending;

  function handleActivate() {
    activateMutation.mutate(selectedFactor);
  }

  function handleDeactivate() {
    deactivateMutation.mutate();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Modo Testigo</CardTitle>
          {isActive && (
            <Badge className="border-transparent bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100">
              <Zap className="mr-1 h-3 w-3" />
              Testigo x{activeFactor}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!isActive ? (
          <div className="flex items-center gap-3">
            <Select
              value={String(selectedFactor)}
              onValueChange={(value) => setSelectedFactor(Number(value) as SpeedFactor)}
            >
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">x2</SelectItem>
                <SelectItem value="4">x4</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={handleActivate}
              disabled={isLoading}
              variant="default"
            >
              <Zap className="mr-2 h-4 w-4" />
              {activateMutation.isPending ? 'Activando...' : 'Activar Modo Testigo'}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted-foreground">
              Velocidad acelerada a x{activeFactor}. Expira en 10 minutos.
            </p>
            <Button
              onClick={handleDeactivate}
              disabled={isLoading}
              variant="destructive"
            >
              <ZapOff className="mr-2 h-4 w-4" />
              {deactivateMutation.isPending ? 'Desactivando...' : 'Desactivar'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
