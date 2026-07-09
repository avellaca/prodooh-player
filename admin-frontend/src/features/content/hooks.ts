import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryClient } from '@/lib/query-client';
import { contentApi } from './api';
import type { UploadOptions } from './api';

export function useContent() {
  return useQuery({
    queryKey: ['content'],
    queryFn: contentApi.list,
  });
}

export function useUploadContent() {
  return useMutation({
    mutationFn: ({ file, options }: { file: File; options?: UploadOptions }) =>
      contentApi.upload(file, options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content'] });
      toast.success('Contenido subido exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al subir contenido');
    },
  });
}

export function useDeleteContent() {
  return useMutation({
    mutationFn: (id: string) => contentApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content'] });
      toast.success('Contenido eliminado exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al eliminar contenido');
    },
  });
}

export function useRotateContent() {
  return useMutation({
    mutationFn: ({ id, rotation }: { id: string; rotation: number }) =>
      contentApi.rotate(id, rotation),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content'] });
      toast.success('Contenido rotado exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al rotar contenido');
    },
  });
}

export function useContentPreviewUrl(id: string | undefined) {
  return useQuery({
    queryKey: ['content', id, 'preview'],
    queryFn: () => contentApi.getPreviewUrl(id!),
    enabled: !!id,
  });
}
