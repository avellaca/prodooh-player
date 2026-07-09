import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';

import { createScreenSchema, type CreateScreenInput } from '@/schemas/screen.schema';
import { useCreateScreen } from '../hooks';
import { useAuth } from '@/hooks/use-auth';
import { useTenantContext } from '@/contexts/TenantContext';
import { TokenRevealDialog } from '@/components/shared/TokenRevealDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ScreenFormProps {
  onSuccess?: () => void;
}

export function ScreenForm({ onSuccess }: ScreenFormProps) {
  const { user } = useAuth();
  const { selectedTenantId } = useTenantContext();
  const isSuperAdmin = user?.role === 'super_admin';
  const createScreen = useCreateScreen();

  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [deviceToken, setDeviceToken] = useState('');

  // For super_admin, use the globally selected tenant; for tenant_admin, use their own
  const effectiveTenantId = isSuperAdmin ? (selectedTenantId ?? '') : (user?.tenant_id ?? '');

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<CreateScreenInput>({
    resolver: zodResolver(createScreenSchema),
    defaultValues: {
      name: '',
      tenant_id: effectiveTenantId,
      venue_id: '',
      orientation: 'landscape',
      resolution_width: 1920,
      resolution_height: 1080,
    },
  });

  function onSubmit(data: CreateScreenInput) {
    createScreen.mutate(data, {
      onSuccess: (response) => {
        if (response.device_token) {
          setDeviceToken(response.device_token);
          setTokenDialogOpen(true);
          // Don't call onSuccess here — wait until user closes the token dialog
        } else {
          onSuccess?.();
        }
      },
    });
  }

  return (
    <>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Nombre</Label>
          <Input id="name" placeholder="Pantalla lobby" {...register('name')} />
          {errors.name && (
            <p className="text-sm text-destructive">{errors.name.message}</p>
          )}
        </div>

        {isSuperAdmin && (
          <input type="hidden" value={effectiveTenantId} {...register('tenant_id')} />
        )}

        <div className="space-y-2">
          <Label htmlFor="venue_id">Venue ID</Label>
          <Input id="venue_id" placeholder="venue-001" {...register('venue_id')} />
          {errors.venue_id && (
            <p className="text-sm text-destructive">{errors.venue_id.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="orientation">Orientación</Label>
          <Select
            defaultValue="landscape"
            onValueChange={(value) =>
              setValue('orientation', value as 'landscape' | 'portrait', { shouldValidate: true })
            }
          >
            <SelectTrigger id="orientation">
              <SelectValue placeholder="Seleccionar orientación" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="landscape">Landscape</SelectItem>
              <SelectItem value="portrait">Portrait</SelectItem>
            </SelectContent>
          </Select>
          {errors.orientation && (
            <p className="text-sm text-destructive">{errors.orientation.message}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="resolution_width">Ancho (px)</Label>
            <Input
              id="resolution_width"
              type="number"
              placeholder="1920"
              {...register('resolution_width', { valueAsNumber: true })}
            />
            {errors.resolution_width && (
              <p className="text-sm text-destructive">{errors.resolution_width.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="resolution_height">Alto (px)</Label>
            <Input
              id="resolution_height"
              type="number"
              placeholder="1080"
              {...register('resolution_height', { valueAsNumber: true })}
            />
            {errors.resolution_height && (
              <p className="text-sm text-destructive">{errors.resolution_height.message}</p>
            )}
          </div>
        </div>

        <Button type="submit" className="w-full" disabled={createScreen.isPending}>
          {createScreen.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Crear pantalla
        </Button>
      </form>

      <TokenRevealDialog
        open={tokenDialogOpen}
        onOpenChange={(open) => {
          setTokenDialogOpen(open);
          if (!open) {
            // User closed the token dialog — now close the parent create dialog
            onSuccess?.();
          }
        }}
        token={deviceToken}
        title="Token de dispositivo"
      />
    </>
  );
}
