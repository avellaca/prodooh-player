import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { usersApi } from './api';
import { toast } from 'sonner';
import type { InviteUserInput, UpdateUserInput } from './types';

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
    onError: (error: any) => {
      toast.error(error.response?.data?.message ?? 'Error al enviar invitación');
    },
  });
}

export function useUpdateUser() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserInput }) => usersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Usuario actualizado');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message ?? 'Error al actualizar');
    },
  });
}

export function useToggleUserActive() {
  return useMutation({
    mutationFn: (id: string) => usersApi.toggleActive(id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(data.is_active ? 'Usuario activado' : 'Usuario desactivado');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error ?? 'Error');
    },
  });
}

export function useDeleteUser() {
  return useMutation({
    mutationFn: (id: string) => usersApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Usuario eliminado');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error ?? 'Error al eliminar');
    },
  });
}

export function useResendInvite() {
  return useMutation({
    mutationFn: (id: string) => usersApi.resendInvite(id),
    onSuccess: () => {
      toast.success('Invitación reenviada');
    },
    onError: () => {
      toast.error('Error al reenviar invitación');
    },
  });
}

export function useSendReset() {
  return useMutation({
    mutationFn: (id: string) => usersApi.sendReset(id),
    onSuccess: () => {
      toast.success('Email de restablecimiento enviado');
    },
    onError: () => {
      toast.error('Error al enviar email de restablecimiento');
    },
  });
}
