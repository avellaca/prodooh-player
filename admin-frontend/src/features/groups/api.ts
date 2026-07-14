import { api } from '@/lib/axios';
import type { ScreenGroup } from '@/types/models';
import type { CreateGroupInput, UpdateGroupInput, AssignScreensInput } from '@/schemas/group.schema';

export const groupsApi = {
  list: () => api.get<ScreenGroup[]>('/admin/groups').then((r) => r.data),

  get: (id: string) => api.get<ScreenGroup>(`/admin/groups/${id}`).then((r) => r.data),

  create: (data: CreateGroupInput) =>
    api.post<ScreenGroup>('/admin/groups', data).then((r) => r.data),

  update: (id: string, data: UpdateGroupInput) =>
    api.put<ScreenGroup>(`/admin/groups/${id}`, data).then((r) => r.data),

  delete: (id: string) => api.delete(`/admin/groups/${id}`).then((r) => r.data),

  assignScreens: (id: string, data: AssignScreensInput) =>
    api.post(`/admin/groups/${id}/screens`, data).then((r) => r.data),

  applySchedule: (id: string) =>
    api.post<{ message: string; screens_updated: number }>(`/admin/groups/${id}/apply-schedule`).then((r) => r.data),
};
