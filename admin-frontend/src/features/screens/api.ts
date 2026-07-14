import { api } from '@/lib/axios';
import type { Screen, Screenshot } from '@/types/models';
import type { CreateScreenInput, UpdateScreenInput } from '@/schemas/screen.schema';
import type { ScreenManifest } from './types';
import type { OrderLine } from '@/features/orders/types';

export const screensApi = {
  list: () => api.get<{ data: Screen[] }>('/admin/screens').then((r) => r.data.data),

  get: (id: string) => api.get<{ data: Screen }>(`/admin/screens/${id}`).then((r) => r.data.data),

  create: (data: CreateScreenInput) =>
    api.post<{ data: Screen; device_token?: string }>('/admin/screens', data).then((r) => r.data),

  update: (id: string, data: UpdateScreenInput) =>
    api.put<{ data: Screen }>(`/admin/screens/${id}`, data).then((r) => r.data.data),

  regenerateToken: (id: string) =>
    api.post<{ data: Screen; device_token: string }>(`/admin/screens/${id}/regenerate-token`).then((r) => r.data),

  getScreenshots: (id: string) =>
    api.get<{ data: Screenshot[] }>(`/admin/screens/${id}/screenshots`).then((r) => r.data.data),

  getManifest: (id: string) =>
    api.get<{ data: ScreenManifest }>(`/admin/screens/${id}/manifest`).then((r) => r.data.data),

  getActiveOrderLines: (id: string) =>
    api.get<{ data: OrderLine[] }>(`/admin/screens/${id}/active-order-lines`).then((r) => r.data.data),

  delete: (id: string) =>
    api.delete(`/admin/screens/${id}`).then((r) => r.data),
};
