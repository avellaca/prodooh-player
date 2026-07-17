import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, X, Monitor, Layers } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { settingsApi, type OverrideItem } from './api';

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
      <PropagateModal
        open={showPropagateModal}
        onOpenChange={setShowPropagateModal}
        tenantId={tenantId}
        numSlots={numSlots}
        sspSlots={sspSlots}
        playlistSlots={playlistSlots}
        propagateMutation={propagateMutation}
      />
    </>
  );
}

// ─── Propagate Modal with Override Exclusions ─────────────────────────────────

function PropagateModal({
  open,
  onOpenChange,
  tenantId,
  numSlots,
  sspSlots,
  playlistSlots,
  propagateMutation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  numSlots: number;
  sspSlots: number;
  playlistSlots: number;
  propagateMutation: ReturnType<typeof usePropagateLoopConfig>;
}) {
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  const { data: overrides, isLoading: loadingOverrides } = useQuery({
    queryKey: ['loop-config-overrides', tenantId],
    queryFn: () => settingsApi.getOverrides(tenantId),
    enabled: open,
  });

  function handleConfirm() {
    const excludeGroupIds = overrides
      ?.filter((o) => o.type === 'group' && excludedIds.has(o.id))
      .map((o) => o.id) ?? [];
    const excludeScreenIds = overrides
      ?.filter((o) => o.type === 'screen' && excludedIds.has(o.id))
      .map((o) => o.id) ?? [];

    propagateMutation.mutate(
      { tenantId, excludeGroupIds, excludeScreenIds },
      { onSettled: () => { onOpenChange(false); setExcludedIds(new Set()); } }
    );
  }

  function toggleExclude(id: string) {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const visibleOverrides = overrides?.filter((o) => !excludedIds.has(o.id)) ?? [];
  const excludedOverrides = overrides?.filter((o) => excludedIds.has(o.id)) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Confirmar propagación</DialogTitle>
          <DialogDescription>
            Se aplicará: <strong>{numSlots} slots totales</strong>, <strong>{sspSlots} SSP</strong>, <strong>{playlistSlots} playlist</strong> a todos los Grupos y Pantallas del Network.
          </DialogDescription>
        </DialogHeader>

        {/* Override list */}
        {loadingOverrides ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando configuraciones personalizadas...
          </div>
        ) : overrides && overrides.length > 0 ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">
              Entidades con configuración personalizada ({visibleOverrides.length} se sobrescribirán):
            </p>
            <div className="max-h-48 overflow-y-auto space-y-1 rounded-md border p-2">
              {visibleOverrides.map((item) => (
                <OverrideRow key={item.id} item={item} onRemove={() => toggleExclude(item.id)} />
              ))}
              {visibleOverrides.length === 0 && (
                <p className="text-xs text-muted-foreground py-2 text-center">
                  Todas las entidades fueron excluidas de la propagación.
                </p>
              )}
            </div>

            {excludedOverrides.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Excluidos de la propagación ({excludedOverrides.length}):
                </p>
                <div className="flex flex-wrap gap-1">
                  {excludedOverrides.map((item) => (
                    <Badge
                      key={item.id}
                      variant="secondary"
                      className="cursor-pointer hover:bg-muted"
                      onClick={() => toggleExclude(item.id)}
                    >
                      {item.type === 'group' ? <Layers className="h-3 w-3 mr-1" /> : <Monitor className="h-3 w-3 mr-1" />}
                      {item.name}
                      <span className="ml-1 text-[10px]">↩</span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-2">
            No hay grupos ni pantallas con configuración personalizada. Se aplicará a todos.
          </p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={propagateMutation.isPending}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
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
  );
}

// ─── Override Row ─────────────────────────────────────────────────────────────

function OverrideRow({ item, onRemove }: { item: OverrideItem; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50 group">
      {item.type === 'group' ? (
        <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      ) : (
        <Monitor className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      )}
      <span className="text-sm flex-1 truncate">{item.name}</span>
      <span className="text-xs text-muted-foreground shrink-0">
        {item.num_slots}/{item.ssp_slots}/{item.playlist_slots}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        title="Excluir de la propagación"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
