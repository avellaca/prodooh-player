import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/use-auth';
import { useTenantContext } from '@/contexts/TenantContext';
import { LoopConfigPanel } from '../LoopConfigPanel';
import { NetworkSettingsPanel } from '../NetworkSettingsPanel';
import { settingsApi } from '../api';
import { LoadingState } from '@/components/shared/LoadingState';

export default function SettingsPage() {
  const { user } = useAuth();
  const { selectedTenantId } = useTenantContext();

  const tenantId = user?.role === 'super_admin' ? selectedTenantId : user?.tenant_id;

  const { data: config, isLoading } = useQuery({
    queryKey: ['loop-config', tenantId],
    queryFn: () => settingsApi.getLoopConfig(tenantId!),
    enabled: !!tenantId,
  });

  if (!tenantId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Configuración</h1>
        <p className="text-muted-foreground">
          Selecciona un Network para ver y editar la configuración.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Configuración</h1>
        <LoadingState rows={2} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Configuración</h1>
      <div className="grid gap-6">
        <LoopConfigPanel
          key={`loop-${config?.num_slots}-${config?.ssp_slots}-${config?.playlist_slots}`}
          tenantId={tenantId}
          defaultValues={config ? {
            num_slots: config.num_slots,
            ssp_slots: config.ssp_slots,
            playlist_slots: config.playlist_slots,
          } : undefined}
        />
        {config && config.ssp_slots > 0 && (
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="text-sm text-muted-foreground">
              Configura las conexiones y prioridades a plataformas SSP desde el menú{' '}
              <Link to="/ssp" className="text-primary font-medium hover:underline">SSP</Link>.
            </p>
          </div>
        )}
        <NetworkSettingsPanel tenantId={tenantId} />
      </div>
    </div>
  );
}
