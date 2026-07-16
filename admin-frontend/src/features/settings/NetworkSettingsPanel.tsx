import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { networkSettingsSchema, type NetworkSettingsFormValues } from './schemas';
import { useNetworkSettings, useUpdateNetworkSettings } from './hooks';
import { FormField } from '@/components/forms/FormField';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2 } from 'lucide-react';

interface NetworkSettingsPanelProps {
  tenantId: string;
}

export function NetworkSettingsPanel({ tenantId }: NetworkSettingsPanelProps) {
  const { data: settings, isLoading } = useNetworkSettings(tenantId);
  const updateMutation = useUpdateNetworkSettings();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Ajustes de Red</CardTitle>
          <CardDescription>Configuración de sincronización y caché del player</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ajustes de Red</CardTitle>
        <CardDescription>Configuración de sincronización y caché del player</CardDescription>
      </CardHeader>
      <CardContent>
        <NetworkSettingsForm
          key={`${settings?.sync_interval_seconds}-${settings?.cache_flush_interval_hours}`}
          defaultValues={settings}
          onSubmit={(data) => updateMutation.mutate({ tenantId, data })}
          isSubmitting={updateMutation.isPending}
        />
      </CardContent>
    </Card>
  );
}

interface NetworkSettingsFormProps {
  defaultValues?: NetworkSettingsFormValues;
  onSubmit: (data: NetworkSettingsFormValues) => void;
  isSubmitting?: boolean;
}

function NetworkSettingsForm({
  defaultValues,
  onSubmit,
  isSubmitting = false,
}: NetworkSettingsFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<NetworkSettingsFormValues>({
    resolver: zodResolver(networkSettingsSchema),
    defaultValues: {
      sync_interval_seconds: defaultValues?.sync_interval_seconds ?? 240,
      cache_flush_interval_hours: defaultValues?.cache_flush_interval_hours ?? 24,
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <FormField
        label="Intervalo de sincronización (segundos)"
        name="sync_interval_seconds"
        type="number"
        register={register}
        errors={errors}
        placeholder="240"
        disabled={isSubmitting}
      />

      <FormField
        label="Intervalo de limpieza de caché (horas)"
        name="cache_flush_interval_hours"
        type="number"
        register={register}
        errors={errors}
        placeholder="24"
        disabled={isSubmitting}
      />

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar ajustes
        </Button>
      </div>
    </form>
  );
}
