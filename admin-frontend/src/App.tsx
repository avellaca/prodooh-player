import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { queryClient } from '@/lib/query-client';
import { TenantProvider } from '@/contexts/TenantContext';
import AppRoutes from '@/routes';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <BrowserRouter>
          <AppRoutes />
          <Toaster position="top-right" richColors visibleToasts={5} expand />
        </BrowserRouter>
      </TenantProvider>
    </QueryClientProvider>
  );
}
