import { api } from '@/lib/axios';
import type { Tenant } from '@/types/models';
import type { CreateTenantInput, UpdateTenantInput } from '@/schemas/tenant.schema';

export const tenantsApi = {
  list: () => api.get<{ data: Tenant[] }>('/admin/tenants').then((r) => r.data.data),

  get: (id: string) => api.get<Tenant>(`/admin/tenants/${id}`).then((r) => r.data),

  /** Get tenant config (accessible by tenant_admin and super_admin) */
  getConfig: (id: string) => api.get<Tenant>(`/admin/tenants/${id}/loop-config`).then((r) => r.data as Tenant),

  create: (data: CreateTenantInput) =>
    api.post<Tenant>('/admin/tenants', data).then((r) => r.data),

  update: (id: string, data: UpdateTenantInput) =>
    api.put<Tenant>(`/admin/tenants/${id}`, data).then((r) => r.data),

  delete: (id: string) => api.delete(`/admin/tenants/${id}`).then((r) => r.data),
};
