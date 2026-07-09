import { useQuery } from '@tanstack/react-query';
import { getCurrentUser } from '@/features/auth/api';
import { useLogin, useLogout } from '@/features/auth/hooks';
import type { AuthUser } from '@/types/auth';

export function useAuth() {
  const { data: user, isLoading } = useQuery<AuthUser>({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
    retry: false,
  });

  const loginMutation = useLogin();
  const logoutMutation = useLogout();

  return {
    user: user ?? null,
    isLoading,
    login: loginMutation.mutateAsync,
    logout: logoutMutation.mutate,
  };
}
