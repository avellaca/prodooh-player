import { api } from '@/lib/axios';

export interface CredentialField {
  key: string;
  label: string;
  type: 'text' | 'password';
}

export interface SspDefinition {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  base_url: string;
  description: string | null;
  credential_fields: CredentialField[];
  active: boolean;
}

export interface SspConnectionStatus {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  description: string | null;
  credential_fields: CredentialField[];
  active: boolean; // Whether super admin has enabled this SSP
  connected: boolean;
  connection_id: string | null;
  connection_active: boolean;
}

export const sspApi = {
  // Super admin: definitions
  listDefinitions: () =>
    api.get<{ data: SspDefinition[] }>('/admin/ssp-definitions').then((r) => r.data.data),

  createDefinition: (data: Partial<SspDefinition>) =>
    api.post<{ data: SspDefinition }>('/admin/ssp-definitions', data).then((r) => r.data.data),

  updateDefinition: (id: string, data: Partial<SspDefinition>) =>
    api.put<{ data: SspDefinition }>(`/admin/ssp-definitions/${id}`, data).then((r) => r.data.data),

  deleteDefinition: (id: string) =>
    api.delete(`/admin/ssp-definitions/${id}`),

  // Tenant admin: connections
  listConnections: () =>
    api.get<{ data: SspConnectionStatus[] }>('/admin/ssp-connections').then((r) => r.data.data),

  connect: (data: { ssp_definition_id: string; credentials: Record<string, string> }) =>
    api.post('/admin/ssp-connections', data).then((r) => r.data),

  disconnect: (id: string) =>
    api.delete(`/admin/ssp-connections/${id}`),
};
