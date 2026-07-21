import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AxiosError } from 'axios';
import { queryClient } from '@/lib/query-client';
import { contentApi, tagsApi } from './api';
import type { UploadOptions, BulkUploadResult } from './api';

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

// --- Tags hooks ---

export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: tagsApi.list,
  });
}

export function useCreateTag() {
  return useMutation({
    mutationFn: (name: string) => tagsApi.create(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      toast.success('Tag creado exitosamente');
    },
    onError: (error: AxiosError<ApiError>) => {
      const msg = error.response?.data?.errors?.name?.[0]
        ?? error.response?.data?.message
        ?? 'Error al crear tag';
      toast.error(msg);
    },
  });
}

export function useAssignTags() {
  return useMutation({
    mutationFn: ({ contentId, tagIds }: { contentId: string; tagIds: string[] }) =>
      tagsApi.assignToContent(contentId, tagIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content'] });
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
    onError: (error: AxiosError<ApiError>) => {
      toast.error(error.response?.data?.message ?? 'Error al asignar tags');
    },
  });
}

export function useRemoveTagFromContent() {
  return useMutation({
    mutationFn: ({ contentId, tagId }: { contentId: string; tagId: string }) =>
      tagsApi.removeFromContent(contentId, tagId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content'] });
    },
    onError: (error: AxiosError<ApiError>) => {
      toast.error(error.response?.data?.message ?? 'Error al remover tag');
    },
  });
}

// --- Bulk upload hook ---

export function useBulkUpload() {
  return useMutation({
    mutationFn: ({
      files,
      tagIds,
      onUploadProgress,
    }: {
      files: File[];
      tagIds: string[];
      onUploadProgress?: (progress: number) => void;
    }): Promise<BulkUploadResult> =>
      contentApi.bulkUpload(files, tagIds, { onUploadProgress }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['content'] });
      if (result.summary.failed === 0) {
        toast.success(`${result.summary.successful} archivo(s) subido(s) exitosamente`);
      } else {
        toast.warning(
          `${result.summary.successful} exitoso(s), ${result.summary.failed} fallido(s)`,
        );
      }
    },
    onError: (error: AxiosError<ApiError>) => {
      toast.error(error.response?.data?.message ?? 'Error en la carga masiva');
    },
  });
}
