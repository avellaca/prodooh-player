import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryClient } from '@/lib/query-client';
import { screensApi } from './api';
import type { CreateScreenInput, UpdateScreenInput } from '@/schemas/screen.schema';
import type { ScreenManifest } from './types';

export function useScreens() {
  return useQuery({
    queryKey: ['screens'],
    queryFn: screensApi.list,
  });
}

export function useScreen(id: string | undefined) {
  return useQuery({
    queryKey: ['screens', id],
    queryFn: () => screensApi.get(id!),
    enabled: !!id,
  });
}

export function useCreateScreen() {
  return useMutation({
    mutationFn: (data: CreateScreenInput) => screensApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['screens'] });
      toast.success('Pantalla creada exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al crear pantalla');
    },
  });
}

export function useUpdateScreen() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateScreenInput }) => screensApi.update(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['screens'] });
      queryClient.invalidateQueries({ queryKey: ['screens', variables.id] });
      toast.success('Pantalla actualizada exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al actualizar pantalla');
    },
  });
}

export function useDeleteScreen() {
  return useMutation({
    mutationFn: (id: string) => screensApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['screens'] });
      toast.success('Pantalla eliminada exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al eliminar pantalla');
    },
  });
}

export function useRegenerateToken() {
  return useMutation({
    mutationFn: (id: string) => screensApi.regenerateToken(id),
    onSuccess: () => {
      toast.success('Token regenerado exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al regenerar token');
    },
  });
}

export function useScreenshots(id: string | undefined) {
  return useQuery({
    queryKey: ['screens', id, 'screenshots'],
    queryFn: () => screensApi.getScreenshots(id!),
    enabled: !!id,
  });
}

export function useScreenManifest(screenId: string | undefined) {
  return useQuery<ScreenManifest | null>({
    queryKey: ['screens', screenId, 'manifest'],
    queryFn: () => screensApi.getManifest(screenId!),
    enabled: !!screenId,
  });
}

export function useActiveOrderLines(screenId: string | undefined) {
  return useQuery({
    queryKey: ['screens', screenId, 'active-order-lines'],
    queryFn: () => screensApi.getActiveOrderLines(screenId!),
    enabled: !!screenId,
  });
}
