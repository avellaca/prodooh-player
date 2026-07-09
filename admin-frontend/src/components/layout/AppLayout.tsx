import { Outlet, useLocation } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import Header from './Header';
import { useAuth } from '@/hooks/use-auth';
import { useTenantContext } from '@/contexts/TenantContext';

const EXEMPT_PATHS = ['/tenants'];

function TenantSelectionPrompt() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
      <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
      <h2 className="text-lg font-semibold mb-2">Selecciona un tenant</h2>
      <p className="text-sm text-muted-foreground max-w-md">
        Selecciona un tenant en el selector del encabezado para ver sus datos.
      </p>
    </div>
  );
}

export default function AppLayout() {
  const { user } = useAuth();
  const { selectedTenantId } = useTenantContext();
  const { pathname } = useLocation();

  const isSuperAdmin = user?.role === 'super_admin';
  const needsTenantSelection = isSuperAdmin && !selectedTenantId;
  const isExemptPath = EXEMPT_PATHS.some((path) => pathname.startsWith(path));

  const showGate = needsTenantSelection && !isExemptPath;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 p-6">
        {showGate ? <TenantSelectionPrompt /> : <Outlet />}
      </main>
    </div>
  );
}
