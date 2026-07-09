import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryClient } from '@/lib/query-client';
import { screensApi } from './api';
import type { Screen, LoopSlot, SourcesConfig } from '@/types/models';
import type { CreateScreenInput, UpdateScreenInput } from '@/schemas/screen.schema';

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

export function useUpdateLoop(id: string) {
  return useMutation({
    mutationFn: (slots: LoopSlot[]) => screensApi.updateLoop(id, slots),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['screens', id] });
      toast.success('Loop actualizado exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al actualizar loop');
    },
  });
}

export function useUpdateSources(id: string) {
  return useMutation({
    mutationFn: (sources: SourcesConfig) => screensApi.updateSources(id, sources),
    onMutate: async (newSources) => {
      await queryClient.cancelQueries({ queryKey: ['screens', id] });

      const previousScreen = queryClient.getQueryData<Screen>(['screens', id]);

      queryClient.setQueryData<Screen>(['screens', id], (old) => {
        if (!old) return old;
        return { ...old, sources_config: newSources };
      });

      return { previousScreen };
    },
    onSuccess: () => {
      toast.success('Fuentes actualizadas exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }, _variables, context) => {
      if (context?.previousScreen) {
        queryClient.setQueryData(['screens', id], context.previousScreen);
      }
      toast.error(error.response?.data?.message ?? 'Error al actualizar fuentes');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['screens', id] });
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
