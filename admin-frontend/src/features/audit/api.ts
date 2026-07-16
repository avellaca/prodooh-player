import { api } from '@/lib/axios';
import type { AuditableType, AuditLogPaginatedResponse } from './types';

export const auditApi = {
  list: (auditableType: AuditableType, id: string, page = 1) =>
    api
      .get<AuditLogPaginatedResponse>(`/admin/${auditableType}/${id}/audit-logs`, {
        params: { page },
      })
      .then((r) => r.data),
};
