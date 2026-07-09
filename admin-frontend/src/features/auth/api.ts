import { api, TOKEN_KEY } from '@/lib/axios';
import type { AuthUser, LoginCredentials, LoginResponse } from '@/types/auth';

export async function loginRequest(credentials: LoginCredentials): Promise<LoginResponse> {
  const response = await api.post<LoginResponse>('/admin/login', credentials);
  return response.data;
}

export async function logoutRequest(): Promise<void> {
  await api.post('/admin/logout');
}

export async function getCurrentUser(): Promise<AuthUser> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    return Promise.reject(new Error('No token'));
  }
  const response = await api.get<AuthUser>('/admin/user');
  return response.data;
}
