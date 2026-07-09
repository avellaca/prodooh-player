import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { groupsApi } from './api';
import { toast } from 'sonner';
import type { AxiosError } from 'axios';
import type { CreateGroupInput, UpdateGroupInput, AssignScreensInput } from '@/schemas/group.schema';

interface ApiError {
  message: string;
  errors?: Record<string, string[]>;
}

export function useGroups() {
  return useQuery({
    queryKey: ['groups'],
    queryFn: groupsApi.list,
  });
}

export function useGroup(id: string | undefined) {
  return useQuery({
    queryKey: ['groups', id],
    queryFn: () => groupsApi.get(id!),
    enabled: !!id,
  });
}

export function useCreateGroup() {
  return useMutation({
    mutationFn: (data: CreateGroupInput) => groupsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      toast.success('Grupo creado exitosamente');
    },
    onError: (error: AxiosError<ApiError>) => {
      toast.error(error.response?.data?.message ?? 'Error al crear grupo');
    },
  });
}

export function useUpdateGroup() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateGroupInput }) =>
      groupsApi.update(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['groups', variables.id] });
      toast.success('Grupo actualizado exitosamente');
    },
    onError: (error: AxiosError<ApiError>) => {
      toast.error(error.response?.data?.message ?? 'Error al actualizar grupo');
    },
  });
}

export function useDeleteGroup() {
  return useMutation({
    mutationFn: (id: string) => groupsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      toast.success('Grupo eliminado exitosamente');
    },
    onError: (error: AxiosError<ApiError>) => {
      toast.error(error.response?.data?.message ?? 'Error al eliminar grupo');
    },
  });
}

export function useAssignScreens() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: AssignScreensInput }) =>
      groupsApi.assignScreens(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['groups', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['screens'] });
      toast.success('Pantallas asignadas exitosamente');
    },
    onError: (error: AxiosError<ApiError>) => {
      toast.error(error.response?.data?.message ?? 'Error al asignar pantallas');
    },
  });
}
