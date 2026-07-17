import { api } from '@/lib/axios';
import type { User, InviteUserInput, UpdateUserInput } from './types';

export const usersApi = {
  list: () =>
    api.get<{ data: User[] }>('/admin/users').then((r) => r.data.data),

  invite: (data: InviteUserInput) =>
    api.post('/admin/users/invite', data).then((r) => r.data),

  update: (id: string, data: UpdateUserInput) =>
    api.put<{ data: User }>(`/admin/users/${id}`, data).then((r) => r.data.data),

  toggleActive: (id: string) =>
    api.patch<{ data: User }>(`/admin/users/${id}/toggle-active`).then((r) => r.data.data),

  delete: (id: string) =>
    api.delete(`/admin/users/${id}`),

  resendInvite: (id: string) =>
    api.post(`/admin/users/${id}/resend-invite`).then((r) => r.data),

  sendReset: (id: string) =>
    api.post(`/admin/users/${id}/send-reset`).then((r) => r.data),
};
