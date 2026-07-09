import { api } from '@/lib/axios';
import type { Playlist } from '@/types/models';
import type { CreatePlaylistInput, UpdatePlaylistInput, AssignPlaylistInput } from '@/schemas/playlist.schema';

export const playlistsApi = {
  list: () => api.get<{ data: Playlist[] }>('/admin/playlists').then((r) => r.data.data),

  get: (id: string) => api.get<{ data: Playlist }>(`/admin/playlists/${id}`).then((r) => r.data.data),

  create: (data: CreatePlaylistInput) =>
    api.post<{ data: Playlist }>('/admin/playlists', data).then((r) => r.data.data),

  update: (id: string, data: UpdatePlaylistInput) =>
    api.put<{ data: Playlist }>(`/admin/playlists/${id}`, data).then((r) => r.data.data),

  delete: (id: string) => api.delete(`/admin/playlists/${id}`).then((r) => r.data),

  assign: (id: string, data: AssignPlaylistInput) =>
    api.post(`/admin/playlists/${id}/assign`, data).then((r) => r.data),
};
