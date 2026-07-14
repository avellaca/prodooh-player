import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import { differenceInMinutes } from 'date-fns';
import { Plus, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DataTable } from '@/components/shared/DataTable';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorState } from '@/components/shared/ErrorState';
import { ScreenForm } from '../components/ScreenForm';
import { useScreens } from '../hooks';
import { useAuth } from '@/hooks/use-auth';
import { useTenantContext } from '@/contexts/TenantContext';
import type { Screen } from '@/types/models';

function getConnectionStatus(screen: Screen): 'online' | 'offline' {
  if (!screen.last_heartbeat) return 'offline';
  return differenceInMinutes(new Date(), new Date(screen.last_heartbeat)) <= 2
    ? 'online'
    : 'offline';
}

export default function ScreensPage() {
  const navigate = useNavigate();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [enabledFilter, setEnabledFilter] = useState<string>('all');

  const { user } = useAuth();
  const { selectedTenantId } = useTenantContext();
  const isSuperAdmin = user?.role === 'super_admin';
  const needsTenant = isSuperAdmin && !selectedTenantId;

  const { data: screens, isLoading, isError, refetch } = useScreens();

  // Filter screens based on search and status
  const filteredScreens = useMemo(() => {
    if (!screens) return [];
    let result = screens;

    // Text search (name, venue_id, resolution)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((s) => {
        const resolution = `${s.resolution_width}x${s.resolution_height}`;
        return (
          s.name.toLowerCase().includes(q) ||
          s.venue_id.toLowerCase().includes(q) ||
          resolution.includes(q) ||
          (s.screen_group?.name?.toLowerCase().includes(q) ?? false)
        );
      });
    }

    // Connection filter
    if (statusFilter === 'online') {
      result = result.filter((s) => getConnectionStatus(s) === 'online');
    } else if (statusFilter === 'offline') {
      result = result.filter((s) => getConnectionStatus(s) === 'offline');
    }

    // Enabled filter
    if (enabledFilter === 'enabled') {
      result = result.filter((s) => s.enabled !== false);
    } else if (enabledFilter === 'disabled') {
      result = result.filter((s) => s.enabled === false);
    }

    return result;
  }, [screens, searchQuery, statusFilter, enabledFilter]);

  const columns: ColumnDef<Screen, unknown>[] = [
    {
      accessorKey: 'name',
      header: 'Nombre',
      sortingFn: (rowA, rowB) => {
        const a = rowA.getValue<string>('name');
        const b = rowB.getValue<string>('name');
        return a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
      },
    },
    {
      accessorKey: 'venue_id',
      header: 'Venue ID',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground font-mono">{row.original.venue_id}</span>
      ),
    },
    {
      accessorKey: 'screen_group.name',
      header: 'Grupo',
      cell: ({ row }) => row.original.screen_group?.name ?? '—',
    },
    {
      id: 'connection',
      header: 'Conexión',
      cell: ({ row }) => {
        const conn = getConnectionStatus(row.original);
        return (
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${conn === 'online' ? 'bg-green-500' : 'bg-red-500'}`}
            />
            <span className="text-sm">{conn === 'online' ? 'Online' : 'Offline'}</span>
          </div>
        );
      },
    },
    {
      id: 'enabled',
      header: 'Operativa',
      cell: ({ row }) => {
        const enabled = row.original.enabled !== false;
        return (
          <Badge variant={enabled ? 'success' : 'secondary'}>
            {enabled ? 'Activa' : 'Desactivada'}
          </Badge>
        );
      },
    },
    {
      id: 'resolution',
      header: 'Resolución',
      cell: ({ row }) =>
        `${row.original.resolution_width}×${row.original.resolution_height}`,
    },
  ];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Pantallas</h1>
        <LoadingState />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Pantallas</h1>
        <ErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Pantallas</h1>
        <Button onClick={() => setCreateDialogOpen(true)} disabled={needsTenant} title={needsTenant ? "Selecciona un Network para crear pantallas" : undefined}>
          <Plus className="mr-2 h-4 w-4" />
          Crear pantalla
        </Button>
      </div>

      {/* Search and filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, venue ID, resolución..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Conexión" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="online">Online</SelectItem>
            <SelectItem value="offline">Offline</SelectItem>
          </SelectContent>
        </Select>
        <Select value={enabledFilter} onValueChange={setEnabledFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Operativa" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="enabled">Activas</SelectItem>
            <SelectItem value="disabled">Desactivadas</SelectItem>
          </SelectContent>
        </Select>
        {(searchQuery || statusFilter !== 'all' || enabledFilter !== 'all') && (
          <span className="text-sm text-muted-foreground">
            {filteredScreens.length} de {screens?.length ?? 0}
          </span>
        )}
      </div>

      <DataTable
        columns={columns}
        data={filteredScreens}
        onRowClick={(screen) => navigate(`/screens/${screen.id}`)}
        initialSorting={[{ id: 'name', desc: false }]}
      />

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear pantalla</DialogTitle>
          </DialogHeader>
          <ScreenForm onSuccess={() => setCreateDialogOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
