import { api } from '@/lib/axios';
import type { User, InviteUserInput } from './types';

export const usersApi = {
  list: () =>
    api.get<{ data: User[] }>('/admin/users').then((r) => r.data.data),

  invite: (data: InviteUserInput) =>
    api.post<{ data: { message: string } }>('/admin/users/invite', data).then((r) => r.data.data),
};
