import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { usersApi } from './api';
import { toast } from 'sonner';
import type { AxiosError } from 'axios';
import type { InviteUserInput } from './types';

interface ApiError {
  message: string;
  errors?: Record<string, string[]>;
}

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
  });
}

export function useInviteUser() {
  return useMutation({
    mutationFn: (data: InviteUserInput) => usersApi.invite(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Invitación enviada exitosamente');
    },
    onError: (error: AxiosError<ApiError>) => {
      toast.error(error.response?.data?.message ?? 'Error al enviar invitación');
    },
  });
}
