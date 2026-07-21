import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Plus, Pencil, Trash2, Radio } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';

import {
  useTrackingPixels,
  useCreateTrackingPixel,
  useUpdateTrackingPixel,
  useDeleteTrackingPixel,
} from '../hooks';
import type { TrackableType, TrackingPixel, TrackingPixelInput, TriggerType } from '../types';

// ─── Form types ──────────────────────────────────────────────────────────────

interface PixelFormValues {
  url: string;
  trigger_type: TriggerType;
  multiplier: string;
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface TrackingPixelPanelProps {
  trackableType: TrackableType;
  trackableId: string;
  title?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TrackingPixelPanel({ trackableType, trackableId, title }: TrackingPixelPanelProps) {
  const { data: pixels, isLoading } = useTrackingPixels(trackableType, trackableId);
  const createMutation = useCreateTrackingPixel(trackableType, trackableId);
  const updateMutation = useUpdateTrackingPixel(trackableType, trackableId);
  const deleteMutation = useDeleteTrackingPixel(trackableType, trackableId);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingPixel, setEditingPixel] = useState<TrackingPixel | null>(null);
  const [deletingPixelId, setDeletingPixelId] = useState<string | null>(null);

  const panelTitle = title ?? 'Tracking Pixels';

  function handleCreate(data: TrackingPixelInput) {
    createMutation.mutate(data, {
      onSuccess: () => setCreateOpen(false),
    });
  }

  function handleUpdate(id: string, data: Partial<TrackingPixelInput>) {
    updateMutation.mutate({ id, data }, {
      onSuccess: () => setEditingPixel(null),
    });
  }

  function handleDelete() {
    if (deletingPixelId) {
      deleteMutation.mutate(deletingPixelId, {
        onSuccess: () => setDeletingPixelId(null),
      });
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Radio className="h-5 w-5" />
          {panelTitle}
        </CardTitle>
        <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Agregar pixel
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando...</p>
        ) : !pixels || pixels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay tracking pixels configurados. Agrega uno para registrar impresiones o reproducciones.
          </p>
        ) : (
          <div className="space-y-2">
            {pixels.map((pixel) => (
              <PixelRow
                key={pixel.id}
                pixel={pixel}
                onEdit={() => setEditingPixel(pixel)}
                onDelete={() => setDeletingPixelId(pixel.id)}
              />
            ))}
          </div>
        )}
      </CardContent>

      {/* Create Dialog */}
      <PixelFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Agregar tracking pixel"
        description="Configura una URL de seguimiento que se disparará al registrar una impresión o reproducción."
        onSubmit={handleCreate}
        isSubmitting={createMutation.isPending}
      />

      {/* Edit Dialog */}
      {editingPixel && (
        <PixelFormDialog
          open={!!editingPixel}
          onOpenChange={(open) => { if (!open) setEditingPixel(null); }}
          title="Editar tracking pixel"
          description="Modifica la configuración del pixel."
          defaultValues={{
            url: editingPixel.url,
            trigger_type: editingPixel.trigger_type,
            multiplier: String(editingPixel.multiplier),
          }}
          onSubmit={(data) => handleUpdate(editingPixel.id, data)}
          isSubmitting={updateMutation.isPending}
        />
      )}

      {/* Delete Confirm */}
      <ConfirmDialog
        open={deletingPixelId !== null}
        onOpenChange={(open) => { if (!open) setDeletingPixelId(null); }}
        title="Eliminar tracking pixel"
        description="¿Estás seguro de que deseas eliminar este tracking pixel? Esta acción no se puede deshacer."
        onConfirm={handleDelete}
        confirmLabel="Eliminar"
        variant="destructive"
      />
    </Card>
  );
}

// ─── Pixel Row ───────────────────────────────────────────────────────────────

interface PixelRowProps {
  pixel: TrackingPixel;
  onEdit: () => void;
  onDelete: () => void;
}

function PixelRow({ pixel, onEdit, onDelete }: PixelRowProps) {
  const triggerLabel = pixel.trigger_type === 'play' ? 'Play' : 'Impression';
  const triggerVariant = pixel.trigger_type === 'play' ? 'default' : 'secondary';

  return (
    <div className="flex items-center gap-3 rounded-md border p-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-mono truncate" title={pixel.url}>
          {pixel.url}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <Badge variant={triggerVariant} className="text-xs">
            {triggerLabel}
          </Badge>
          {pixel.multiplier > 1 && (
            <Badge variant="outline" className="text-xs">
              ×{pixel.multiplier}
            </Badge>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="icon" onClick={onEdit} title="Editar">
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onDelete} title="Eliminar">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Pixel Form Dialog ───────────────────────────────────────────────────────

interface PixelFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  defaultValues?: PixelFormValues;
  onSubmit: (data: TrackingPixelInput) => void;
  isSubmitting: boolean;
}

function PixelFormDialog({
  open,
  onOpenChange,
  title,
  description,
  defaultValues,
  onSubmit,
  isSubmitting,
}: PixelFormDialogProps) {
  const form = useForm<PixelFormValues>({
    values: defaultValues ?? {
      url: '',
      trigger_type: 'impression',
      multiplier: '1',
    },
  });

  function handleSubmit(values: PixelFormValues) {
    const multiplier = parseInt(values.multiplier, 10);
    if (isNaN(multiplier) || multiplier < 1) {
      form.setError('multiplier', { message: 'El multiplicador debe ser al menos 1' });
      return;
    }
    try {
      new URL(values.url);
    } catch {
      form.setError('url', { message: 'La URL no es válida' });
      return;
    }
    onSubmit({
      url: values.url,
      trigger_type: values.trigger_type,
      multiplier,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pixel-url">URL del pixel</Label>
            <Input
              id="pixel-url"
              type="url"
              placeholder="https://tracking.example.com/pixel?id=..."
              {...form.register('url', { required: 'La URL es requerida' })}
            />
            {form.formState.errors.url && (
              <p className="text-sm text-destructive">{form.formState.errors.url.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pixel-trigger">Tipo de disparo</Label>
            <Select
              value={form.watch('trigger_type')}
              onValueChange={(val) => form.setValue('trigger_type', val as TriggerType)}
            >
              <SelectTrigger id="pixel-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="impression">Impression</SelectItem>
                <SelectItem value="play">Play</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              &quot;Impression&quot; se dispara al registrar la impresión. &quot;Play&quot; se dispara al iniciar la reproducción.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pixel-multiplier">Multiplicador</Label>
            <Input
              id="pixel-multiplier"
              type="number"
              min={1}
              {...form.register('multiplier', { required: 'El multiplicador es requerido' })}
            />
            {form.formState.errors.multiplier && (
              <p className="text-sm text-destructive">{form.formState.errors.multiplier.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Cantidad de veces que se dispara el pixel por cada impresión.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Guardando...' : 'Guardar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
