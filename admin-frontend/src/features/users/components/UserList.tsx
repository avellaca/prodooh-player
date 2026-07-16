import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { User } from '../types';

interface UserListProps {
  users: User[] | undefined;
  isLoading: boolean;
  showTenant?: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  tenant_admin: 'Admin Tenant',
  trafficker: 'Trafficker',
};

function RoleBadge({ role }: { role: string }) {
  const variant = role === 'super_admin'
    ? 'default'
    : role === 'tenant_admin'
      ? 'secondary'
      : 'outline';

  return <Badge variant={variant}>{ROLE_LABELS[role] ?? role}</Badge>;
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <Badge variant={isActive ? 'success' : 'destructive'}>
      {isActive ? 'Activo' : 'Inactivo'}
    </Badge>
  );
}

export function UserList({ users, isLoading, showTenant = false }: UserListProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!users || users.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No hay usuarios registrados.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Email</TableHead>
          <TableHead>Rol</TableHead>
          {showTenant && <TableHead>Tenant</TableHead>}
          <TableHead>Estado</TableHead>
          <TableHead>Creado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <TableRow key={user.id}>
            <TableCell className="font-medium">{user.email}</TableCell>
            <TableCell>
              <RoleBadge role={user.role} />
            </TableCell>
            {showTenant && (
              <TableCell>{user.tenant?.name ?? '—'}</TableCell>
            )}
            <TableCell>
              <StatusBadge isActive={user.is_active} />
            </TableCell>
            <TableCell className="text-muted-foreground">
              {new Date(user.created_at).toLocaleDateString()}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
