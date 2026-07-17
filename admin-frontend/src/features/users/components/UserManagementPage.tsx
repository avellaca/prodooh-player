import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useUsers, useInviteUser, useUpdateUser, useToggleUserActive, useDeleteUser, useResendInvite, useSendReset } from '../hooks';
import { InviteUserForm } from './InviteUserForm';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { UserPlus, Pencil, Trash2, Mail, KeyRound, Power } from 'lucide-react';
import type { User } from '../types';
import type { InviteUserFormValues } from '../schemas';

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  tenant_admin: 'Admin',
  trafficker: 'Trafficker',
};

export function UserManagementPage() {
  const { user: currentUser } = useAuth();
  const { data: users, isLoading } = useUsers();
  const inviteMutation = useInviteUser();
  const updateMutation = useUpdateUser();
  const toggleMutation = useToggleUserActive();
  const deleteMutation = useDeleteUser();
  const resendMutation = useResendInvite();
  const resetMutation = useSendReset();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  const isSuperAdmin = currentUser?.role === 'super_admin';

  function handleInvite(data: InviteUserFormValues) {
    inviteMutation.mutate(data, { onSuccess: () => setInviteOpen(false) });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Usuarios</h1>
          <p className="text-muted-foreground">
            {isSuperAdmin ? 'Gestiona los usuarios de todos los networks.' : 'Gestiona los usuarios de tu network.'}
          </p>
        </div>

        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="mr-2 h-4 w-4" />
              Invitar usuario
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invitar usuario</DialogTitle>
              <DialogDescription>Envía una invitación por email.</DialogDescription>
            </DialogHeader>
            <InviteUserForm onSubmit={handleInvite} isSubmitting={inviteMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : !users || users.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No hay usuarios registrados.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Rol</TableHead>
              {isSuperAdmin && <TableHead>Network</TableHead>}
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name ?? '—'}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  <Badge variant={u.role === 'super_admin' ? 'default' : u.role === 'tenant_admin' ? 'secondary' : 'outline'}>
                    {ROLE_LABELS[u.role] ?? u.role}
                  </Badge>
                </TableCell>
                {isSuperAdmin && <TableCell>{u.tenant?.name ?? '—'}</TableCell>}
                <TableCell>
                  <Badge variant={u.status === 'active' ? 'success' : u.status === 'pending' ? 'warning' : 'destructive'}>
                    {u.status === 'active' ? 'Activo' : u.status === 'pending' ? 'Pendiente' : 'Inactivo'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {/* Edit */}
                    <span className="relative group">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingUser(u)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-gray-900 text-white text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap z-50">Editar</span>
                    </span>

                    {/* Toggle active */}
                    <span className="relative group">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleMutation.mutate(u.id)} disabled={u.id === currentUser?.id}>
                        <Power className="h-3.5 w-3.5" />
                      </Button>
                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-gray-900 text-white text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap z-50">{u.is_active ? 'Desactivar' : 'Activar'}</span>
                    </span>

                    {/* Resend invite — only for pending users */}
                    {u.status === 'pending' && (
                      <span className="relative group">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => resendMutation.mutate(u.id)}>
                          <Mail className="h-3.5 w-3.5" />
                        </Button>
                        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-gray-900 text-white text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap z-50">Reenviar invitación</span>
                      </span>
                    )}

                    {/* Send reset */}
                    <span className="relative group">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => resetMutation.mutate(u.id)}>
                        <KeyRound className="h-3.5 w-3.5" />
                      </Button>
                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-gray-900 text-white text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap z-50">Enviar reset</span>
                    </span>

                    {/* Delete */}
                    <span className="relative group">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(u.id)} disabled={u.id === currentUser?.id}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-gray-900 text-white text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap z-50">Eliminar</span>
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Edit User Dialog */}
      {editingUser && (
        <EditUserDialog
          user={editingUser}
          open={true}
          onOpenChange={(open) => { if (!open) setEditingUser(null); }}
          onSubmit={(data) => {
            updateMutation.mutate({ id: editingUser.id, data }, { onSuccess: () => setEditingUser(null) });
          }}
          isSubmitting={updateMutation.isPending}
        />
      )}
    </div>
  );
}

// ─── Edit User Dialog ────────────────────────────────────────────────────────

function EditUserDialog({
  user,
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
}: {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { name?: string; email?: string; role?: string }) => void;
  isSubmitting: boolean;
}) {
  const [name, setName] = useState(user.name ?? '');
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState(user.role);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Editar usuario</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre completo" />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
          </div>
          <div className="space-y-2">
            <Label>Rol</Label>
            <Select value={role} onValueChange={(v) => setRole(v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tenant_admin">Administrador</SelectItem>
                <SelectItem value="trafficker">Trafficker</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => onSubmit({ name, email, role })} disabled={isSubmitting}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
