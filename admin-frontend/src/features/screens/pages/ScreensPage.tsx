import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import { differenceInMinutes } from 'date-fns';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DataTable } from '@/components/shared/DataTable';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorState } from '@/components/shared/ErrorState';
import { ScreenForm } from '../components/ScreenForm';
import { useScreens } from '../hooks';
import { useAuth } from '@/hooks/use-auth';
import type { Screen } from '@/types/models';

export default function ScreensPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const { data: screens, isLoading, isError, refetch } = useScreens();

  const columns: ColumnDef<Screen, unknown>[] = [
    {
      accessorKey: 'name',
      header: 'Nombre',
    },
    ...(isSuperAdmin
      ? [
          {
            accessorKey: 'tenant.name',
            header: 'Tenant',
            cell: ({ row }: { row: { original: Screen } }) =>
              row.original.tenant?.name ?? '—',
          } as ColumnDef<Screen, unknown>,
        ]
      : []),
    {
      accessorKey: 'screen_group.name',
      header: 'Grupo',
      cell: ({ row }) => row.original.screen_group?.name ?? '—',
    },
    {
      id: 'status',
      header: 'Estado',
      cell: ({ row }) => {
        const isOnline = row.original.last_heartbeat
          ? differenceInMinutes(new Date(), new Date(row.original.last_heartbeat)) <= 2
          : false;
        return (
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`}
            />
            <span className="text-sm">{isOnline ? 'Online' : 'Offline'}</span>
          </div>
        );
      },
    },
    {
      accessorKey: 'orientation',
      header: 'Orientación',
      cell: ({ row }) => (
        <span className="capitalize">{row.original.orientation}</span>
      ),
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
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Crear pantalla
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={screens ?? []}
        onRowClick={(screen) => navigate(`/screens/${screen.id}`)}
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
