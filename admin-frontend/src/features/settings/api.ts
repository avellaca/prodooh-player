import { api } from '@/lib/axios';
import type { Tenant } from '@/types/models';
import type { NetworkSettingsFormValues } from './schemas';

export interface LoopConfigInput {
  num_slots: number;
  ssp_slots: number;
  playlist_slots: number;
}

export interface PropagateResponse {
  message: string;
  affected_screen_groups: number;
  affected_screens: number;
  num_slots: number;
}

export interface NetworkSettingsResponse {
  sync_interval_seconds: number;
  cache_flush_interval_hours: number;
}

export const settingsApi = {
  getLoopConfig: (tenantId: string) =>
    api.get<{ num_slots: number; ssp_slots: number; playlist_slots: number; sync_interval_seconds: number; cache_flush_interval_hours: number }>(
      `/admin/tenants/${tenantId}/loop-config`
    ).then((r) => r.data),

  updateLoopConfig: (tenantId: string, data: LoopConfigInput) =>
    api.put<Tenant>(`/admin/tenants/${tenantId}/loop-config`, data).then((r) => r.data),

  propagateLoopConfig: (tenantId: string) =>
    api.post<PropagateResponse>(`/admin/tenants/${tenantId}/loop-config/propagate`).then((r) => r.data),

  getNetworkSettings: (tenantId: string) =>
    api.get<{ num_slots: number; ssp_slots: number; playlist_slots: number; sync_interval_seconds: number; cache_flush_interval_hours: number }>(
      `/admin/tenants/${tenantId}/loop-config`
    ).then((r) => ({
      sync_interval_seconds: r.data.sync_interval_seconds ?? 240,
      cache_flush_interval_hours: r.data.cache_flush_interval_hours ?? 24,
    })),

  updateNetworkSettings: (tenantId: string, data: NetworkSettingsFormValues) =>
    api.put<Tenant>(`/admin/tenants/${tenantId}/network-settings`, data).then((r) => r.data),
};
