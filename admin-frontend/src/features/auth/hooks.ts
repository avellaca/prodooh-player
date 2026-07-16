import { useMutation } from '@tanstack/react-query';
import { TOKEN_KEY } from '@/lib/axios';
import { queryClient } from '@/lib/query-client';
import {
  loginRequest,
  logoutRequest,
  forgotPasswordRequest,
  resetPasswordRequest,
  registerRequest,
} from './api';
import type {
  ForgotPasswordRequest,
  ResetPasswordRequest,
  RegisterRequest,
} from './api';
import type { LoginCredentials, LoginResponse } from '@/types/auth';

export function useLogin() {
  return useMutation<LoginResponse, Error, LoginCredentials>({
    mutationFn: loginRequest,
    onSuccess: (data) => {
      localStorage.setItem(TOKEN_KEY, data.token);
      queryClient.setQueryData(['currentUser'], data.user);
    },
  });
}

export function useLogout() {
  return useMutation<void, Error, void>({
    mutationFn: logoutRequest,
    onSuccess: () => {
      localStorage.removeItem(TOKEN_KEY);
      queryClient.clear();
      window.location.href = '/login';
    },
  });
}

export function useForgotPassword() {
  return useMutation<{ message: string }, Error, ForgotPasswordRequest>({
    mutationFn: forgotPasswordRequest,
  });
}

export function useResetPassword() {
  return useMutation<{ message: string }, Error, ResetPasswordRequest>({
    mutationFn: resetPasswordRequest,
  });
}

export function useRegister() {
  return useMutation<LoginResponse, Error, RegisterRequest>({
    mutationFn: registerRequest,
    onSuccess: (data) => {
      localStorage.setItem(TOKEN_KEY, data.token);
      queryClient.setQueryData(['currentUser'], data.user);
    },
  });
}
