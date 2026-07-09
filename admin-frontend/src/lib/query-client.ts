import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,          // 30s antes de considerar stale
      retry: 1,                   // Max 1 reintento automático (Req 13.5)
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,                   // Sin reintentos en mutaciones (Req 13.5)
    },
  },
});
