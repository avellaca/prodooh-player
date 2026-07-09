import { api } from '@/lib/axios';
import type { Screen, LoopSlot, SourcesConfig, Screenshot } from '@/types/models';
import type { CreateScreenInput, UpdateScreenInput } from '@/schemas/screen.schema';

/** Transform backend screen data to match frontend interfaces */
function transformScreen(raw: Record<string, unknown>): Screen {
  const screen = raw as unknown as Screen;

  // Backend returns loop_config as { slots: [...] }, frontend expects LoopSlot[]
  if (raw.loop_config && typeof raw.loop_config === 'object' && 'slots' in (raw.loop_config as object)) {
    (screen as unknown as Record<string, unknown>).loop_config = (raw.loop_config as { slots: LoopSlot[] }).slots;
  }

  // Backend returns sources_config as { source: { enabled: bool, ... } }, frontend expects { source: bool }
  if (raw.sources_config && typeof raw.sources_config === 'object') {
    const rawSources = raw.sources_config as Record<string, { enabled?: boolean } | boolean>;
    const transformed: SourcesConfig = {
      prodooh: typeof rawSources.prodooh === 'object' ? (rawSources.prodooh?.enabled ?? false) : !!rawSources.prodooh,
      gam: typeof rawSources.gam === 'object' ? (rawSources.gam?.enabled ?? false) : !!rawSources.gam,
      url: typeof rawSources.url === 'object' ? (rawSources.url?.enabled ?? false) : !!rawSources.url,
      playlist: typeof rawSources.playlist === 'object' ? (rawSources.playlist?.enabled ?? false) : !!rawSources.playlist,
    };
    (screen as unknown as Record<string, unknown>).sources_config = transformed;
  }

  return screen;
}

export const screensApi = {
  list: () => api.get<{ data: unknown[] }>('/admin/screens').then((r) => r.data.data.map(s => transformScreen(s as Record<string, unknown>))),

  get: (id: string) => api.get<{ data: unknown }>(`/admin/screens/${id}`).then((r) => transformScreen(r.data.data as Record<string, unknown>)),

  create: (data: CreateScreenInput) =>
    api.post<{ data: unknown; device_token?: string }>('/admin/screens', data).then((r) => ({
      ...r.data,
      data: transformScreen(r.data.data as Record<string, unknown>),
    })),

  update: (id: string, data: UpdateScreenInput) =>
    api.put<{ data: unknown }>(`/admin/screens/${id}`, data).then((r) => transformScreen(r.data.data as Record<string, unknown>)),

  regenerateToken: (id: string) =>
    api.post<{ data: unknown; device_token: string }>(`/admin/screens/${id}/regenerate-token`).then((r) => r.data),

  updateLoop: (id: string, slots: LoopSlot[]) =>
    api.put(`/admin/screens/${id}/loop`, { slots }).then((r) => r.data),

  updateSources: (id: string, sources: SourcesConfig) => {
    const payload = {
      sources: Object.fromEntries(
        Object.entries(sources).map(([key, enabled]) => [key, { enabled }])
      ),
    };
    return api.put(`/admin/screens/${id}/sources`, payload).then((r) => r.data);
  },

  getScreenshots: (id: string) =>
    api.get<{ data: Screenshot[] }>(`/admin/screens/${id}/screenshots`).then((r) => r.data.data),

  delete: (id: string) =>
    api.delete(`/admin/screens/${id}`).then((r) => r.data),
};
