import { useMutation } from '@tanstack/react-query';
import { TOKEN_KEY } from '@/lib/axios';
import { queryClient } from '@/lib/query-client';
import { loginRequest, logoutRequest } from './api';
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
