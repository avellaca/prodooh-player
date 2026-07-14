import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AxiosError } from 'axios';
import { queryClient } from '@/lib/query-client';
import { contentApi } from './api';
import type { UploadOptions } from './api';

interface ApiError {
  message: string;
  errors?: Record<string, string[]>;
}

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
    onError: (error: AxiosError<ApiError>) => {
      const data = error.response?.data;
      // If there are detailed validation errors, show them
      if (data?.errors) {
        const firstError = Object.values(data.errors).flat()[0];
        toast.error(firstError ?? data.message ?? 'Error al subir contenido');
      } else {
        toast.error(data?.message ?? 'Error al subir contenido');
      }
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
    onError: (error: AxiosError<ApiError>) => {
      if (error.response?.status === 409) {
        toast.error(error.response.data?.message ?? 'No se puede eliminar este contenido porque está en uso.');
      } else {
        toast.error(error.response?.data?.message ?? 'Error al eliminar contenido');
      }
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
    onError: (error: AxiosError<ApiError>) => {
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
