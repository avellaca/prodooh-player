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

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
  password_confirmation: string;
}

export interface RegisterRequest {
  token: string;
  password: string;
  password_confirmation: string;
  name: string;
}

export async function forgotPasswordRequest(data: ForgotPasswordRequest): Promise<{ message: string }> {
  const response = await api.post<{ message: string }>('/auth/forgot-password', data);
  return response.data;
}

export async function resetPasswordRequest(data: ResetPasswordRequest): Promise<{ message: string }> {
  const response = await api.post<{ message: string }>('/auth/reset-password', data);
  return response.data;
}

export async function registerRequest(data: RegisterRequest): Promise<LoginResponse> {
  const response = await api.post<LoginResponse>('/auth/register', data);
  return response.data;
}
