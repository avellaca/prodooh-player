import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { tenantsApi } from './api';
import { toast } from 'sonner';
import type { AxiosError } from 'axios';
import type { CreateTenantInput, UpdateTenantInput } from '@/schemas/tenant.schema';

interface ApiError {
  message: string;
  errors?: Record<string, string[]>;
}

export function useTenants() {
  return useQuery({
    queryKey: ['tenants'],
    queryFn: tenantsApi.list,
  });
}

export function useTenant(id: string | undefined) {
  return useQuery({
    queryKey: ['tenants', id],
    queryFn: () => tenantsApi.getConfig(id!),
    enabled: !!id,
  });
}

export function useCreateTenant() {
  return useMutation({
    mutationFn: (data: CreateTenantInput) => tenantsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      toast.success('Tenant creado exitosamente');
    },
    onError: (error: AxiosError<ApiError>) => {
      toast.error(error.response?.data?.message ?? 'Error al crear tenant');
    },
  });
}

export function useUpdateTenant() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTenantInput }) =>
      tenantsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      toast.success('Tenant actualizado exitosamente');
    },
    onError: (error: AxiosError<ApiError>) => {
      toast.error(error.response?.data?.message ?? 'Error al actualizar tenant');
    },
  });
}

export function useDeleteTenant() {
  return useMutation({
    mutationFn: (id: string) => tenantsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      toast.success('Tenant eliminado exitosamente');
    },
    onError: (error: AxiosError<ApiError>) => {
      toast.error(error.response?.data?.message ?? 'Error al eliminar tenant');
    },
  });
}
