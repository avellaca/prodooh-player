import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useUsers, useInviteUser } from '../hooks';
import { UserList } from './UserList';
import { InviteUserForm } from './InviteUserForm';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { UserPlus } from 'lucide-react';
import type { InviteUserFormValues } from '../schemas';

export function UserManagementPage() {
  const { user: currentUser } = useAuth();
  const { data: users, isLoading } = useUsers();
  const inviteMutation = useInviteUser();
  const [dialogOpen, setDialogOpen] = useState(false);

  const isSuperAdmin = currentUser?.role === 'super_admin';

  function handleInvite(data: InviteUserFormValues) {
    inviteMutation.mutate(data, {
      onSuccess: () => {
        setDialogOpen(false);
      },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Usuarios</h1>
          <p className="text-muted-foreground">
            {isSuperAdmin
              ? 'Gestiona los usuarios de todos los tenants.'
              : 'Gestiona los usuarios de tu tenant.'}
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="mr-2 h-4 w-4" />
              Invitar usuario
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invitar usuario</DialogTitle>
              <DialogDescription>
                Envía una invitación por email para que un nuevo usuario se registre en el sistema.
              </DialogDescription>
            </DialogHeader>
            <InviteUserForm
              onSubmit={handleInvite}
              isSubmitting={inviteMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      <UserList
        users={users}
        isLoading={isLoading}
        showTenant={isSuperAdmin}
      />
    </div>
  );
}
