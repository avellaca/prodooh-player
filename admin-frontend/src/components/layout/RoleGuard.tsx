import { useRef } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AuthUser } from '@/types/auth';

interface RoleGuardProps {
  roles: AuthUser['role'][];
}

export default function RoleGuard({ roles }: RoleGuardProps) {
  const queryClient = useQueryClient();
  const user = queryClient.getQueryData<AuthUser>(['currentUser']);
  const toastShown = useRef(false);

  if (!user || !roles.includes(user.role)) {
    if (!toastShown.current) {
      toastShown.current = true;
      toast.error('Acceso denegado');
    }
    return <Navigate to="/orders" replace />;
  }

  return <Outlet />;
}
