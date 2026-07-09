import { createContext, useCallback, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { getCurrentUser } from '@/features/auth/api';
import { TOKEN_KEY } from '@/lib/axios';

const STORAGE_KEY = 'selected_tenant_id';

interface TenantContextValue {
  selectedTenantId: string | null;
  setSelectedTenantId: (tenantId: string | null) => void;
}

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

export function TenantProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const token = localStorage.getItem(TOKEN_KEY);

  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
    retry: false,
    enabled: !!token,
  });

  const isSuperAdmin = user?.role === 'super_admin';

  // Initialize from localStorage directly — the guard is at the consumption point (value)
  const [selectedTenantId, setSelectedTenantIdState] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY);
  });

  // Sync to localStorage when selectedTenantId changes (external system sync — legitimate useEffect)
  useEffect(() => {
    if (selectedTenantId) {
      localStorage.setItem(STORAGE_KEY, selectedTenantId);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [selectedTenantId]);

  const setSelectedTenantId = useCallback(
    (tenantId: string | null) => {
      // Write to localStorage BEFORE refetching so the interceptor reads the new value
      if (tenantId) {
        localStorage.setItem(STORAGE_KEY, tenantId);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
      setSelectedTenantIdState(tenantId);
      // Refetch all active queries except currentUser so views get new tenant data
      queryClient.refetchQueries({
        predicate: (query) => query.queryKey[0] !== 'currentUser',
      });
    },
    [queryClient],
  );

  // For non-super_admin users, always return null regardless of localStorage
  const value: TenantContextValue = {
    selectedTenantId: isSuperAdmin ? selectedTenantId : null,
    setSelectedTenantId,
  };

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenantContext(): TenantContextValue {
  const context = useContext(TenantContext);
  if (context === undefined) {
    throw new Error('useTenantContext must be used within a TenantProvider');
  }
  return context;
}
