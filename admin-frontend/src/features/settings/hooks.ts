import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { settingsApi } from './api';
import { toast } from 'sonner';
import type { AxiosError } from 'axios';
import type { LoopConfigInput } from './api';
import type { NetworkSettingsFormValues } from './schemas';

interface ApiError {
  message: string;
  errors?: Record<string, string[]>;
}

// --- Loop Config hooks ---

export function useUpdateLoopConfig() {
  return useMutation({
    mutationFn: ({ tenantId, data }: { tenantId: string; data: LoopConfigInput }) =>
      settingsApi.updateLoopConfig(tenantId, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      queryClient.invalidateQueries({ queryKey: ['loop-config', variables.tenantId] });
      toast.success('Configuración de loop actualizada');
    },
    onError: (error: AxiosError<ApiError>) => {
      const message = error.response?.data?.errors
        ? Object.values(error.response.data.errors).flat().join(', ')
        : error.response?.data?.message ?? 'Error al actualizar configuración de loop';
      toast.error(message);
    },
  });
}

export function usePropagateLoopConfig() {
  return useMutation({
    mutationFn: (tenantId: string) => settingsApi.propagateLoopConfig(tenantId),
    onSuccess: (data, tenantId) => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      queryClient.invalidateQueries({ queryKey: ['loop-config', tenantId] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['screens'] });
      toast.success(
        `Propagación completada: ${data.affected_screen_groups} grupos y ${data.affected_screens} pantallas actualizados`
      );
    },
    onError: (error: AxiosError<ApiError>) => {
      toast.error(error.response?.data?.message ?? 'Error al propagar configuración');
    },
  });
}

// --- Network Settings hooks ---

export function useNetworkSettings(tenantId: string) {
  return useQuery({
    queryKey: ['network-settings', tenantId],
    queryFn: () => settingsApi.getNetworkSettings(tenantId),
    enabled: !!tenantId,
  });
}

export function useUpdateNetworkSettings() {
  return useMutation({
    mutationFn: ({ tenantId, data }: { tenantId: string; data: NetworkSettingsFormValues }) =>
      settingsApi.updateNetworkSettings(tenantId, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      queryClient.invalidateQueries({ queryKey: ['network-settings', variables.tenantId] });
      queryClient.invalidateQueries({ queryKey: ['loop-config', variables.tenantId] });
      toast.success('Ajustes de red actualizados');
    },
    onError: (error: AxiosError<ApiError>) => {
      const message = error.response?.data?.errors
        ? Object.values(error.response.data.errors).flat().join(', ')
        : error.response?.data?.message ?? 'Error al actualizar ajustes de red';
      toast.error(message);
    },
  });
}
