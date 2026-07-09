import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryClient } from '@/lib/query-client';
import { playlistsApi } from './api';
import type { CreatePlaylistInput, UpdatePlaylistInput, AssignPlaylistInput } from '@/schemas/playlist.schema';

export function usePlaylists() {
  return useQuery({
    queryKey: ['playlists'],
    queryFn: playlistsApi.list,
  });
}

export function usePlaylist(id: string | undefined) {
  return useQuery({
    queryKey: ['playlists', id],
    queryFn: () => playlistsApi.get(id!),
    enabled: !!id,
  });
}

export function useCreatePlaylist() {
  return useMutation({
    mutationFn: (data: CreatePlaylistInput) => playlistsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast.success('Playlist creada exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al crear playlist');
    },
  });
}

export function useUpdatePlaylist() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePlaylistInput }) => playlistsApi.update(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      queryClient.invalidateQueries({ queryKey: ['playlists', variables.id] });
      toast.success('Playlist actualizada exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al actualizar playlist');
    },
  });
}

export function useDeletePlaylist() {
  return useMutation({
    mutationFn: (id: string) => playlistsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast.success('Playlist eliminada exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al eliminar playlist');
    },
  });
}

export function useAssignPlaylist() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: AssignPlaylistInput }) => playlistsApi.assign(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['playlists', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['screens'] });
      toast.success('Playlist asignada exitosamente');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      toast.error(error.response?.data?.message ?? 'Error al asignar playlist');
    },
  });
}
