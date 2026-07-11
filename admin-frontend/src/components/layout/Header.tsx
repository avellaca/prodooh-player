import { NavLink } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { useTenantContext } from '@/contexts/TenantContext';
import { tenantsApi } from '@/features/tenants/api';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const superAdminLinks = [
  { to: '/tenants', label: 'Tenants' },
  { to: '/screens', label: 'Pantallas' },
  { to: '/groups', label: 'Grupos' },
  { to: '/playlists', label: 'Playlists' },
  { to: '/content', label: 'Contenido' },
  { to: '/analytics', label: 'Analytics' },
];

const tenantAdminLinks = [
  { to: '/screens', label: 'Pantallas' },
  { to: '/groups', label: 'Grupos' },
  { to: '/playlists', label: 'Playlists' },
  { to: '/content', label: 'Contenido' },
  { to: '/analytics', label: 'Analytics' },
];

export default function Header() {
  const { user, logout } = useAuth();
  const { selectedTenantId, setSelectedTenantId } = useTenantContext();

  const isSuperAdmin = user?.role === 'super_admin';

  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: tenantsApi.list,
    enabled: isSuperAdmin,
  });

  const navLinks = isSuperAdmin ? superAdminLinks : tenantAdminLinks;

  return (
    <header className="bg-navy text-white">
      <div className="flex h-14 items-center px-6">
        <span className="text-lg font-semibold mr-8">Prodooh Player</span>

        <nav className="flex items-center gap-1">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                cn(
                  'px-3 py-1.5 rounded text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-white/15 text-white'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                )
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {isSuperAdmin && (
            <Select
              value={selectedTenantId ?? ''}
              onValueChange={(value) => setSelectedTenantId(value || null)}
            >
              <SelectTrigger className="w-[180px] bg-white/10 border-white/20 text-white text-sm">
                <SelectValue placeholder="Seleccionar tenant" />
              </SelectTrigger>
              <SelectContent>
                {tenants?.map((tenant) => (
                  <SelectItem key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => logout()}
            className="text-white/70 hover:text-white hover:bg-white/10"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Cerrar sesión
          </Button>
        </div>
      </div>
    </header>
  );
}
