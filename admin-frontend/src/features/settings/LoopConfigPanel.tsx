import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import { useUpdateLoopConfig, usePropagateLoopConfig } from './hooks';

// --- Zod schema ---

export const loopConfigSchema = z
  .object({
    num_slots: z.coerce
      .number({ invalid_type_error: 'Debe ser un número' })
      .int('Debe ser un número entero')
      .min(1, 'Mínimo 1')
      .max(100, 'Máximo 100'),
    ssp_slots: z.coerce
      .number({ invalid_type_error: 'Debe ser un número' })
      .int('Debe ser un número entero')
      .min(0, 'Mínimo 0'),
    playlist_slots: z.coerce
      .number({ invalid_type_error: 'Debe ser un número' })
      .int('Debe ser un número entero')
      .min(0, 'Mínimo 0'),
  })
  .refine(
    (data) => data.ssp_slots + data.playlist_slots < data.num_slots,
    {
      message: 'Debe quedar al menos 1 ad_slot (ssp_slots + playlist_slots debe ser menor que num_slots)',
      path: ['num_slots'],
    }
  );

export type LoopConfigFormValues = z.infer<typeof loopConfigSchema>;

// --- Props ---

interface LoopConfigPanelProps {
  tenantId: string;
  defaultValues?: {
    num_slots: number;
    ssp_slots: number;
    playlist_slots: number;
  };
}

// --- Component ---

export function LoopConfigPanel({ tenantId, defaultValues }: LoopConfigPanelProps) {
  const [showPropagateModal, setShowPropagateModal] = useState(false);

  const updateMutation = useUpdateLoopConfig();
  const propagateMutation = usePropagateLoopConfig();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<LoopConfigFormValues>({
    resolver: zodResolver(loopConfigSchema),
    defaultValues: defaultValues ?? {
      num_slots: 10,
      ssp_slots: 2,
      playlist_slots: 1,
    },
  });

  // Live computed values — derived directly in render (no useEffect)
  const numSlots = watch('num_slots');
  const sspSlots = watch('ssp_slots');
  const playlistSlots = watch('playlist_slots');

  const adSlots = (Number(numSlots) || 0) - (Number(sspSlots) || 0) - (Number(playlistSlots) || 0);
  const isAdSlotsValid = adSlots >= 1;

  function onSubmit(data: LoopConfigFormValues) {
    updateMutation.mutate({ tenantId, data });
  }

  function handlePropagateConfirm() {
    propagateMutation.mutate(tenantId, {
      onSettled: () => setShowPropagateModal(false),
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Configuración de Loop</CardTitle>
          <CardDescription>
            Configura la estructura del loop: slots totales, reservados para SSP y para playlist.
            La duración de cada slot se define en el campo duration_seconds del grupo o tenant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {/* num_slots */}
              <div className="space-y-2">
                <Label htmlFor="num_slots">Slots totales</Label>
                <Input
                  id="num_slots"
                  type="number"
                  min={1}
                  max={100}
                  className={cn(errors.num_slots && 'border-red-500 focus-visible:ring-red-500')}
                  disabled={updateMutation.isPending}
                  {...register('num_slots')}
                />
                {errors.num_slots && (
                  <p className="text-sm text-red-500">{errors.num_slots.message}</p>
                )}
              </div>

              {/* ssp_slots */}
              <div className="space-y-2">
                <Label htmlFor="ssp_slots">Slots SSP</Label>
                <Input
                  id="ssp_slots"
                  type="number"
                  min={0}
                  className={cn(errors.ssp_slots && 'border-red-500 focus-visible:ring-red-500')}
                  disabled={updateMutation.isPending}
                  {...register('ssp_slots')}
                />
                {errors.ssp_slots && (
                  <p className="text-sm text-red-500">{errors.ssp_slots.message}</p>
                )}
              </div>

              {/* playlist_slots */}
              <div className="space-y-2">
                <Label htmlFor="playlist_slots">Slots Playlist</Label>
                <Input
                  id="playlist_slots"
                  type="number"
                  min={0}
                  className={cn(errors.playlist_slots && 'border-red-500 focus-visible:ring-red-500')}
                  disabled={updateMutation.isPending}
                  {...register('playlist_slots')}
                />
                {errors.playlist_slots && (
                  <p className="text-sm text-red-500">{errors.playlist_slots.message}</p>
                )}
              </div>
            </div>

            {/* Computed ad_slots display */}
            <div className="rounded-md border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Ad Slots (calculado)</p>
                  <p className={cn(
                    'text-2xl font-bold',
                    isAdSlotsValid ? 'text-foreground' : 'text-red-500'
                  )}>
                    {adSlots}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground max-w-48 text-right">
                  = num_slots − ssp_slots − playlist_slots
                </p>
              </div>
              {!isAdSlotsValid && (
                <p className="mt-2 text-sm text-red-500">
                  Debe haber al menos 1 ad_slot disponible
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowPropagateModal(true)}
                disabled={propagateMutation.isPending || updateMutation.isPending}
              >
                {propagateMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Aplicar a todos
              </Button>

              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Guardar configuración
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Propagation confirmation modal */}
      <Dialog open={showPropagateModal} onOpenChange={setShowPropagateModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar propagación</DialogTitle>
            <DialogDescription>
              Esta acción sobreescribirá la configuración de slots en <strong>TODOS</strong> los
              Grupos de pantallas y Pantallas del Network, incluyendo los que tienen un valor personalizado.
              Se aplicará: <strong>{numSlots} slots totales</strong>, <strong>{sspSlots} SSP</strong>, <strong>{playlistSlots} playlist</strong>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowPropagateModal(false)}
              disabled={propagateMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={handlePropagateConfirm}
              disabled={propagateMutation.isPending}
            >
              {propagateMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Confirmar propagación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
